'use strict';

const { RSI, MACD, ATR } = require('technicalindicators');
const { closedCandlesOnly, intervalMs } = require('../ma-cross/strategyEngine');
const { computeStopLossFloor } = require('../shared/stopLossFloor');
const { bollingerCycleOccurrences } = require('../../utils/indicatorGrowthEngines');
const { averageWithoutOutliers } = require('../../utils/removeOutliersIQR');
const { detectSupportResistance } = require('../../utils/supportResistance');

const RSI_PERIOD = 14;
// Pullback e expiração da ordem limite de entrada são avaliados minuto a minuto, SEMPRE em
// candles de 1m — independente do entry.interval do sinal (15m, 1h etc.). Uma ordem limite
// resting na corretora já preenche em tempo real por conta própria; o que muda aqui é de
// quantos em quantos "candles fechados" contamos o prazo de expiração (checkEntryLimitExpired)
// e a granularidade mínima que o bot considera pra notar/expirar o pedido.
const PULLBACK_INTERVAL = '1m';
const BB_MIN_CANDLES_PADDING = 5;
// Intervalo fixo do filtro entry.rsi5mFilter — sempre 5m independente do entry.interval do
// sinal (diferente do bandWidth, que deixa o intervalo configurável).
const RSI5M_INTERVAL = '5m';
const RSI5M_WARMUP_PADDING = 10;
// entry.earlyConfirm só precisa dos últimos candles fechados do intervalo curto pra achar o
// checkpoint dentro da janela do candle de entry.interval ainda em formação — não calcula RSI
// nesse intervalo, só lê o preço de fechamento, então o limite pode ser pequeno.
const EARLY_CONFIRM_WARMUP_PADDING = 10;
// MACD (12/26/9 padrão) — mesmos períodos fixos do backtest (ver analyseRsiThresholdBacktest.js),
// só o intervalo é configurável (entry.macdFilter.interval). Warmup generoso o bastante pro
// primeiro valor de histograma ficar disponível bem antes do candle mais recente.
const MACD_FAST_PERIOD = 12;
const MACD_SLOW_PERIOD = 26;
const MACD_SIGNAL_PERIOD = 9;
const MACD_WARMUP_BARS = MACD_SLOW_PERIOD + MACD_SIGNAL_PERIOD + 10;
// Filtro RSI 1h (entry.higherRsiFilter) — intervalo FIXO, o mesmo da coluna "RSI 1h" das
// Estatísticas (REF_RSI_INTERVAL em analyseRsiThresholdBacktest.js).
const HIGHER_RSI_INTERVAL = '1h';
// ATR de Wilder (período 14, padrão) — usado só pelo stop contínuo modo 'atrTrail', calculado no
// entry.interval no momento da compra (ver computeAtrPct / rsi-momentum-bot.js).
const ATR_PERIOD = 14;
// Suporte/Resistência (entry.supportResistance) — folga de candles além da janela (candleCount)
// pra o detectSupportResistance ter leftBars+rightBars de contexto (defaults 5/5).
const SR_WINDOW_PADDING = 12;

function computeRsiSeries(closedCandles) {
    const closes = closedCandles.map(c => parseFloat(c.close));
    return RSI.calculate({ values: closes, period: RSI_PERIOD });
}

function getRequiredSpecs(config) {
    const entry = config.entry;
    const cooldown = Math.max(0, Math.round(Number(entry.reentryCooldownCandles ?? 0)));
    const limit = RSI_PERIOD * 3 + cooldown + 30;
    const specs = new Map([[entry.interval, limit]]);

    const add = (iv, lim) => specs.set(iv, Math.max(specs.get(iv) ?? 0, lim));

    if (entry.pullback?.enabled) {
        const waitCandles = Math.max(0, Math.round(Number(entry.limitWaitCandles ?? 0)));
        add(PULLBACK_INTERVAL, waitCandles + 10);
    }

    const bw = entry.bandWidth;
    if (bw?.enabled) {
        add(bw.interval, bw.lookback + bw.period + BB_MIN_CANDLES_PADDING);
    }

    if (entry.rsi5mFilter?.enabled) {
        add(RSI5M_INTERVAL, RSI_PERIOD + RSI5M_WARMUP_PADDING);
    }

    if (entry.earlyConfirm?.enabled) {
        add(entry.earlyConfirm.interval, EARLY_CONFIRM_WARMUP_PADDING);
    }

    if (entry.macdFilter?.enabled) {
        add(entry.macdFilter.interval ?? '1h', MACD_WARMUP_BARS);
    }

    if (entry.higherRsiFilter?.enabled) {
        add(HIGHER_RSI_INTERVAL, RSI_PERIOD * 3 + 20);
    }

    if (entry.supportResistance?.enabled) {
        const cc = Math.max(20, Math.round(Number(entry.supportResistance.candleCount ?? 50)));
        add(entry.supportResistance.interval ?? '4h', cc + SR_WINDOW_PADDING);
    }

    return [...specs.entries()].map(([interval, lim]) => ({ interval, limit: lim }));
}

/**
 * Filtro opcional de largura de banda (mesmo motor do filtro de mercado "Larg%" — ver
 * backend/services/fetchBollingerBandWidthFilter.js e o backtest analyseRsiThresholdBacktest.js):
 * % médio de valorização de cada ciclo fundo→topo BB(period,stdDev), sem outliers. É uma
 * propriedade da moeda no período, não do candle do momento — não muda a cada tick, mas é
 * barato o bastante pra recalcular sempre (poucos candles fechados). Desligado → sempre libera.
 */
function checkBandWidthFilter(config, cMap) {
    const bw = config.entry?.bandWidth;
    if (!bw?.enabled) return { allowed: true };

    const closed = closedCandlesOnly(cMap[bw.interval] ?? []);
    const occurrences = bollingerCycleOccurrences(closed, { period: bw.period, stdDev: bw.stdDev });
    if (!occurrences?.length) {
        return { allowed: false, reason: 'BANDWIDTH_NO_DATA' };
    }

    const avgWidthPct = Math.round(averageWithoutOutliers(occurrences) * 100) / 100;
    if (avgWidthPct < bw.minPct) {
        return { allowed: false, reason: 'BANDWIDTH_TOO_LOW', avgWidthPct, minPct: bw.minPct };
    }
    return { allowed: true, avgWidthPct, minPct: bw.minPct };
}

/**
 * Filtro opcional (desligado por padrão — ver comentário em tradeConfigSchema.js): exige RSI(14)
 * do candle 5m FECHADO mais recente no momento do sinal > threshold, além do cruzamento no
 * entry.interval. Mesmo padrão do checkBandWidthFilter acima, mas sempre no intervalo fixo 5m.
 */
function checkRsi5mFilter(config, cMap) {
    const f = config.entry?.rsi5mFilter;
    if (!f?.enabled) return { allowed: true };

    const closed = closedCandlesOnly(cMap[RSI5M_INTERVAL] ?? []);
    if (closed.length < RSI_PERIOD + 2) return { allowed: false, reason: 'RSI5M_NO_DATA' };

    const rsiValues = computeRsiSeries(closed);
    if (!rsiValues.length) return { allowed: false, reason: 'RSI5M_NO_DATA' };

    const rsi5m = rsiValues[rsiValues.length - 1];
    if (rsi5m <= f.threshold) {
        return { allowed: false, reason: 'RSI5M_TOO_LOW', rsi5m, threshold: f.threshold };
    }
    return { allowed: true, rsi5m, threshold: f.threshold };
}

/**
 * Recusa o sinal se o PRÓPRIO candle do cruzamento (abertura→fechamento) já subiu mais que
 * maxMovePct%. Desligado por padrão e sem seletor no painel — só via config salva. Filtra pelo
 * candle em si, não pela série — barato, sem lookback.
 */
function checkSpikeGuardFilter(config, signalCandle) {
    const sg = config.entry?.spikeGuard;
    if (!sg?.enabled) return { allowed: true };

    const open = parseFloat(signalCandle.open);
    if (!(open > 0)) return { allowed: true };

    const movePct = Math.round(((parseFloat(signalCandle.close) - open) / open) * 10000) / 100;
    if (movePct > sg.maxMovePct) {
        return { allowed: false, reason: 'SPIKE_TOO_LARGE', movePct, maxMovePct: sg.maxMovePct };
    }
    return { allowed: true, movePct, maxMovePct: sg.maxMovePct };
}

/**
 * Filtro opcional de confirmação por MACD (12/26/9, mesmos períodos do backtest — ver
 * analyseRsiThresholdBacktest.js) — só libera o sinal se o histograma (MACD − linha de sinal),
 * no intervalo próprio escolhido (entry.macdFilter.interval, ex.: 1h — não precisa ser o mesmo
 * intervalo do RSI de entrada), estiver POSITIVO no candle FECHADO mais recente. Segunda
 * confirmação independente do RSI: reduz repiques onde o RSI cruzou no entry.interval mas o
 * momentum de fundo (timeframe maior) ainda não virou. Sem candles suficientes pro warmup do
 * MACD ainda, libera — fail-open, como os demais filtros baseados em série própria.
 */
function checkMacdFilter(config, cMap) {
    const f = config.entry?.macdFilter;
    if (!f?.enabled) return { allowed: true };

    const closed = closedCandlesOnly(cMap[f.interval ?? '1h'] ?? []);
    if (closed.length < MACD_WARMUP_BARS) return { allowed: true };

    const closes = closed.map(c => parseFloat(c.close));
    const series = MACD.calculate({
        values: closes,
        fastPeriod: MACD_FAST_PERIOD,
        slowPeriod: MACD_SLOW_PERIOD,
        signalPeriod: MACD_SIGNAL_PERIOD,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });
    if (!series.length) return { allowed: true };

    const histogram = series[series.length - 1]?.histogram;
    if (!Number.isFinite(histogram)) return { allowed: true };
    if (histogram <= 0) {
        return { allowed: false, reason: 'MACD_HISTOGRAM_NEGATIVE', histogram, interval: f.interval };
    }
    return { allowed: true, histogram, interval: f.interval };
}

/**
 * Filtro opcional de confirmação multi-timeframe pelo RSI de 1h (intervalo FIXO — o mesmo da
 * coluna "RSI 1h" e do gráfico "Resultado por faixa de RSI 1h" em Estatísticas): só libera o
 * sinal se o RSI(14) do candle de 1h FECHADO mais recente estiver >= entry.higherRsiFilter.minRsi.
 * O gatilho de entrada é de um intervalo menor (entry.interval, ex. 15m) — este filtro evita
 * comprar o rompimento enquanto o timeframe maior ainda está fraco. Mesma regra do backtest
 * (options.higherRsiFilter em analyseRsiThresholdBacktest.js). Sem candles de 1h suficientes ainda,
 * libera (fail-open, como o MACD).
 */
function checkHigherRsiFilter(config, cMap) {
    const f = config.entry?.higherRsiFilter;
    if (!f?.enabled) return { allowed: true };

    const closed = closedCandlesOnly(cMap[HIGHER_RSI_INTERVAL] ?? []);
    if (closed.length < RSI_PERIOD + 2) return { allowed: true };

    const rsiValues = computeRsiSeries(closed);
    const rsi1h = rsiValues[rsiValues.length - 1];
    if (!Number.isFinite(rsi1h)) return { allowed: true };

    const minRsi = Math.max(1, Math.min(99, Number(f.minRsi ?? 50)));
    if (rsi1h < minRsi) {
        return { allowed: false, reason: 'HIGHER_RSI_TOO_LOW', rsi1h: Math.round(rsi1h * 100) / 100, minRsi, interval: HIGHER_RSI_INTERVAL };
    }
    return { allowed: true, rsi1h: Math.round(rsi1h * 100) / 100, minRsi, interval: HIGHER_RSI_INTERVAL };
}

// ── Suporte/Resistência (entry.supportResistance) ────────────────────────────────────────────
//
// No bot só importa o "agora": as zonas saem dos últimos `candleCount` candles FECHADOS do
// intervalo escolhido (sem look-ahead — o backtest precisa de janela móvel por sinal histórico,
// aqui o sinal é sempre "agora"). Mesmo detectSupportResistance do gráfico e do backtest.

/** { supports: [desc por preço], resistances: [asc por preço] } no instante atual, ou null se
 *  não houver janela completa ainda. Mesma forma de resolveSupportResistanceAt do backtest. */
function resolveSrZonesNow(cMap, srCfg) {
    const cc = Math.max(20, Math.round(Number(srCfg?.candleCount ?? 50)));
    const closed = closedCandlesOnly(cMap[srCfg?.interval ?? '4h'] ?? []);
    if (closed.length < cc) return null;
    const window = closed.slice(closed.length - cc).map(c => ({
        openTime: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const levels = detectSupportResistance(window, {});
    if (!levels.length) return null;
    return {
        supports: levels.filter(l => l.type === 'support').sort((a, b) => b.price - a.price),
        resistances: levels.filter(l => l.type === 'resistance').sort((a, b) => a.price - b.price),
    };
}

/** A `rank`-ésima linha de suporte ABAIXO de `price` (1 = a mais próxima). null se faltar. */
function pickSupport(zones, price, rank) {
    if (!zones) return null;
    const below = zones.supports.filter(l => l.price < price * 0.999); // já vem desc
    return below[Math.max(1, Math.round(rank)) - 1] ?? null;
}

/** A `rank`-ésima linha de resistência ACIMA de `price` (1 = a mais próxima). null se faltar. */
function pickResistance(zones, price, rank) {
    if (!zones) return null;
    const above = zones.resistances.filter(l => l.price > price * 1.001); // já vem asc
    return above[Math.max(1, Math.round(rank)) - 1] ?? null;
}

/**
 * Filtro de entrada por S/R + alvo por resistência. Mesma regra do backtest
 * (checkSupportResistanceFilter / targetPriceOverride em analyseRsiThresholdBacktest.js):
 *  - ENTRADA: só libera se o preço do sinal estiver no máximo `entryMaxPct`% ACIMA da linha de
 *    suporte escolhida (preço abaixo do suporte também libera). Sem zonas / sem suporte de
 *    referência → não bloqueia (fail-open, igual MACD/RSI 1h).
 *  - SAÍDA: `srTargetPrice` = a `exitResistanceRank`-ésima resistência acima do preço do sinal
 *    (null se não houver) — o chamador usa como alvo fixo da bracket no lugar do targetMode.
 */
function checkSupportResistanceEntry(config, cMap, signalPrice) {
    const sr = config.entry?.supportResistance;
    if (!sr?.enabled) return { allowed: true, srTargetPrice: null };

    const zones = resolveSrZonesNow(cMap, sr);
    if (!zones) return { allowed: true, srTargetPrice: null, warmup: true };

    const entryRank = Math.max(1, Math.min(3, Math.round(Number(sr.entrySupportRank ?? 1))));
    const exitRank = Math.max(1, Math.min(3, Math.round(Number(sr.exitResistanceRank ?? 1))));
    const maxPct = Math.max(1, Math.min(100, Number(sr.entryMaxPct ?? 10)));

    const support = pickSupport(zones, signalPrice, entryRank);
    if (support && signalPrice > support.price * (1 + maxPct / 100)) {
        return {
            allowed: false, reason: 'SR_NO_DISCOUNT',
            supportPrice: support.price, maxPct,
            distPct: Math.round(((signalPrice - support.price) / support.price) * 10000) / 100,
        };
    }

    const resistance = pickResistance(zones, signalPrice, exitRank);
    return {
        allowed: true,
        srTargetPrice: resistance?.price ?? null,
        supportPrice: support?.price ?? null,
        resistanceRank: exitRank,
        entryMaxPct: maxPct,
    };
}

/**
 * "Reforço no stop" (escada de averaging-down / martingale) — decisão pura por candle, mesma
 * mecânica do backtest (runReinforcementLadder em analyseRsiThresholdBacktest.js): a partir do
 * ÚLTIMO aporte da pilha (`lastEntryPrice`), o 1º candle cujo `low` cai `addDropPct`% abaixo dele
 * adiciona mais uma compra; o 1º cujo `high` sobe `exitRisePct`% acima dele encerra TODA a pilha.
 * Empate no mesmo candle: `addRung` antes de `exit` (pior caso, igual evaluateExit/resolveFromSignal).
 * `forming` = candle do entry.interval em formação ({ high, low }).
 */
function evaluateReinforceLadder(reinforceState, forming) {
    const last = Number(reinforceState?.lastEntryPrice);
    const drop = Math.max(0.5, Number(reinforceState?.addDropPct ?? 10)) / 100;
    const rise = Math.max(0.5, Number(reinforceState?.exitRisePct ?? 15)) / 100;
    const addLevel = last * (1 - drop);
    const tpPrice = last * (1 + rise);
    if (!(last > 0) || !forming) return { action: 'hold', addLevel, tpPrice };

    const low = parseFloat(forming.low ?? forming.close);
    const high = parseFloat(forming.high ?? forming.close);
    if (Number.isFinite(low) && low <= addLevel) return { action: 'addRung', addLevel, tpPrice };
    if (Number.isFinite(high) && high >= tpPrice) return { action: 'exit', addLevel, tpPrice };
    return { action: 'hold', addLevel, tpPrice };
}

/** ATR de Wilder (período 14) em % do último fechamento — usado pelo stop contínuo modo
 *  'atrTrail'. Calculado uma vez, no momento da compra, a partir dos candles FECHADOS do
 *  entry.interval (ver rsi-momentum-bot.js, guardado em rules_state.stopAtrPct). null sem candles
 *  suficientes. */
function computeAtrPct(closedCandles) {
    const closed = closedCandlesOnly(closedCandles ?? []);
    if (closed.length < ATR_PERIOD + 2) return null;
    const series = ATR.calculate({
        high: closed.map(c => parseFloat(c.high)),
        low: closed.map(c => parseFloat(c.low)),
        close: closed.map(c => parseFloat(c.close)),
        period: ATR_PERIOD,
    });
    const atr = series[series.length - 1];
    const lastClose = parseFloat(closed[closed.length - 1].close);
    if (!Number.isFinite(atr) || !(lastClose > 0)) return null;
    return (atr / lastClose) * 100;
}

/**
 * Checkpoint de confirmação adiantada: procura, dentro do intervalo curto (entry.earlyConfirm.
 * interval, ex.: 5m), o candle já FECHADO mais recente cujo openTime cai dentro da janela do
 * candle de entry.interval que ainda está se formando (openTime >= forming.openTime). Devolve
 * null se nenhum candle curto fechou ainda dentro dessa janela (início da janela, sem dado novo
 * pra adiantar nada). É sempre o fechamento de um candle real — nunca um preço em movimento.
 */
function findEarlyConfirmCheckpoint(entry, cMap, forming) {
    if (!entry.earlyConfirm?.enabled || !forming) return null;
    const confirmIv = entry.earlyConfirm.interval;
    if (intervalMs(confirmIv) >= intervalMs(entry.interval)) return null;

    const confirmClosed = closedCandlesOnly(cMap[confirmIv] ?? []);
    const checkpoints = confirmClosed.filter(c => Number(c.openTime) >= Number(forming.openTime));
    const checkpoint = checkpoints[checkpoints.length - 1];
    return checkpoint ?? null;
}

/**
 * Sinal de entrada: RSI(14) do entry.interval cruza para CIMA de entry.rsiThreshold — mesma
 * detecção do backtest (ver analyseRsiThresholdBacktest.js), com uma confirmação ADIANTADA
 * opcional (entry.earlyConfirm, ligado por padrão): em vez de só reavaliar o RSI quando o candle
 * de entry.interval fecha (podendo levar até `interval` inteiro, ex. 15min), recalcula o mesmo
 * RSI de entry.interval usando o fechamento do candle mais recente do intervalo curto (checkpoint
 * de earlyConfirm.interval, ex. 5m) como preço provisório do candle ainda em formação — se esse
 * RSI provisório já atinge `earlyConfirm.rsiThreshold` (padrão 70, e nunca abaixo do
 * entry.rsiThreshold), o sinal dispara ali (2-3 checkpoints antes do fechamento cheio), sem
 * esperar o candle inteiro fechar. O intervalo do RSI continua o mesmo (entry.interval); só o
 * MOMENTO em que a confirmação é aceita muda, e o limiar do RSI provisório pode ser um pouco mais
 * alto que o da entrada. Sem checkpoint disponível ainda (início da janela) ou com earlyConfirm
 * desligado, cai no comportamento original (só candle FECHADO, no entry.rsiThreshold).
 *
 * Sem pullback (desligado), a entrada é a mercado no preço de confirmação (limitPrice: null). Com
 * pullback (padrão), `limitPrice` é o preço-limite (signalPrice × (1 − belowPct/100)) — o
 * chamador arma uma ordem GTC nesse preço e espera reteste minuto a minuto (ver
 * checkEntryLimitExpired).
 */
function evaluateEntrySignal(config, cMap) {
    const entry = config.entry;
    if (entry.enabled === false) return { allowed: false, reason: 'ENTRY_OFF' };

    const iv = entry.interval;
    const raw = cMap[iv] ?? [];
    const closed = closedCandlesOnly(raw);
    if (closed.length < RSI_PERIOD + 2) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

    const priorCount = entry.priorRsiFilter?.enabled
        ? Math.max(1, Math.round(Number(entry.priorRsiFilter.count ?? 3)))
        : 0;
    const rsiClosed = computeRsiSeries(closed);
    if (rsiClosed.length < Math.max(2, priorCount + 1)) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

    const threshold = entry.rsiThreshold;
    const lastClosedRsi = rsiClosed[rsiClosed.length - 1];
    const prevClosedRsi = rsiClosed[rsiClosed.length - 2];

    // Caso 1 (original): o candle de entry.interval JÁ fechou com o cruzamento confirmado.
    let crossed = prevClosedRsi < threshold && lastClosedRsi >= threshold;
    let last = lastClosedRsi;
    let signalCandle = closed[closed.length - 1];
    let priorWindow = rsiClosed.slice(rsiClosed.length - 1 - priorCount, rsiClosed.length - 1);
    let earlyCheckpoint = null;

    // Caso 2 (adiantado): candle de entry.interval ainda se formando, mas já tem checkpoint de
    // earlyConfirm.interval fechado dentro da janela — só tenta se o Caso 1 ainda não confirmou.
    // O RSI provisório precisa atingir earlyConfirm.rsiThreshold (padrão 70), NUNCA menos que o
    // limiar de entrada — max() blinda contra uma config incoerente afrouxar o sinal adiantado.
    const earlyThreshold = Math.max(threshold, Number(entry.earlyConfirm?.rsiThreshold ?? threshold));
    if (!crossed) {
        const forming = raw[raw.length - 1];
        const checkpoint = findEarlyConfirmCheckpoint(entry, cMap, forming);
        if (checkpoint && lastClosedRsi < earlyThreshold) {
            const closesWithCheckpoint = [...closed.map(c => parseFloat(c.close)), parseFloat(checkpoint.close)];
            const rsiWithCheckpoint = RSI.calculate({ values: closesWithCheckpoint, period: RSI_PERIOD });
            const earlyRsi = rsiWithCheckpoint[rsiWithCheckpoint.length - 1];
            if (earlyRsi != null && earlyRsi >= earlyThreshold) {
                crossed = true;
                last = earlyRsi;
                signalCandle = { open: forming.open, close: checkpoint.close, openTime: forming.openTime };
                priorWindow = rsiClosed.slice(rsiClosed.length - priorCount, rsiClosed.length);
                earlyCheckpoint = { openTime: Number(checkpoint.openTime), price: parseFloat(checkpoint.close) };
            }
        }
    }

    if (!crossed) {
        return { allowed: false, reason: 'RSI_NOT_CROSSING', rsi: last, threshold };
    }

    // Confirma que não é apenas um repique de volatilidade: os `priorCount` VALORES de RSI
    // anteriores ao cruzamento (não candles) precisam ter ficado <= threshold. Evita entrar
    // quando o RSI já estava oscilando em torno do limiar (cruza, recua, cruza de novo) —
    // desligável em entry.priorRsiFilter.
    if (priorCount > 0) {
        if (!priorWindow.every(v => v <= threshold)) {
            return { allowed: false, reason: 'RSI_VOLATILE_NEAR_THRESHOLD', rsi: last, threshold, priorWindow };
        }
    }

    const spikeGuardCheck = checkSpikeGuardFilter(config, signalCandle);
    if (!spikeGuardCheck.allowed) {
        return { allowed: false, reason: spikeGuardCheck.reason, rsi: last, threshold, spikeGuard: spikeGuardCheck };
    }

    const bandWidthCheck = checkBandWidthFilter(config, cMap);
    if (!bandWidthCheck.allowed) {
        return { allowed: false, reason: bandWidthCheck.reason, rsi: last, threshold, bandWidth: bandWidthCheck };
    }

    const rsi5mCheck = checkRsi5mFilter(config, cMap);
    if (!rsi5mCheck.allowed) {
        return { allowed: false, reason: rsi5mCheck.reason, rsi: last, threshold, rsi5m: rsi5mCheck };
    }

    const macdCheck = checkMacdFilter(config, cMap);
    if (!macdCheck.allowed) {
        return { allowed: false, reason: macdCheck.reason, rsi: last, threshold, macd: macdCheck };
    }

    const higherRsiCheck = checkHigherRsiFilter(config, cMap);
    if (!higherRsiCheck.allowed) {
        return { allowed: false, reason: higherRsiCheck.reason, rsi: last, threshold, higherRsi: higherRsiCheck };
    }

    const signalClose = parseFloat(signalCandle.close);
    const srCheck = checkSupportResistanceEntry(config, cMap, signalClose);
    if (!srCheck.allowed) {
        return { allowed: false, reason: srCheck.reason, rsi: last, threshold, sr: srCheck };
    }

    const signalPrice = signalClose;
    const signalOpenTime = Number(signalCandle.openTime);
    const pullbackPct = entry.pullback?.enabled ? Math.max(0.01, entry.pullback.belowPct) : 0;
    const limitPrice = pullbackPct > 0 ? signalPrice * (1 - pullbackPct / 100) : null;

    const confirmNote = earlyCheckpoint
        ? ` — confirmação adiantada (checkpoint ${entry.earlyConfirm.interval}, RSI ≥ ${earlyThreshold})`
        : '';
    const crossedValue = earlyCheckpoint ? earlyThreshold : threshold;
    const entryDesc = pullbackPct > 0
        ? `RSI(${RSI_PERIOD}) ${iv} cruzou ${crossedValue} (${last.toFixed(2)})${confirmNote} — pullback -${pullbackPct}%`
        : `RSI(${RSI_PERIOD}) ${iv} cruzou ${crossedValue} (${last.toFixed(2)})${confirmNote}`;

    return {
        allowed: true,
        close: signalPrice,
        limitPrice,
        rsi: last,
        threshold,
        bandWidth: bandWidthCheck,
        rsi5m: rsi5mCheck,
        spikeGuard: spikeGuardCheck,
        macd: macdCheck,
        higherRsi: higherRsiCheck,
        sr: srCheck,
        srTargetPrice: srCheck.srTargetPrice ?? null,
        earlyCheckpoint,
        signalOpenTime,
        signalPrice,
        entryDesc,
    };
}

/**
 * Ordem limite resting (armada no sinal): expirou depois de entry.limitWaitCandles candles de
 * 1 MINUTO fechados com openTime >= signalOpenTime? Diferente do bollinger-bands (que conta no
 * candle do entry.interval) — aqui a contagem é sempre em 1m, por isso getRequiredSpecs busca
 * um cMap['1m'] à parte quando o pullback está ligado.
 */
function checkEntryLimitExpired(config, cMap, entryLimit) {
    const need = Math.max(1, Math.round(Number(config.entry?.limitWaitCandles ?? 20)));
    const sinceMs = Number(entryLimit?.signalOpenTime)
        || (entryLimit?.placedAt ? new Date(entryLimit.placedAt).getTime() : NaN);
    if (!Number.isFinite(sinceMs)) {
        return { expired: false, need, have: 0, remain: need, interval: PULLBACK_INTERVAL };
    }
    const closed = closedCandlesOnly(cMap[PULLBACK_INTERVAL] ?? []);
    const have = closed.filter(c => Number(c.openTime) >= sinceMs).length;
    const remain = Math.max(0, need - have);
    return { expired: remain <= 0, need, have, remain, interval: PULLBACK_INTERVAL };
}

/**
 * Cooldown pós-venda (qualquer motivo — alvo, stop, manual) em candles do entry.interval.
 * Diferente do bollinger-bands (que só aplica após STOP_LOSS, ver checkReentryCooldown em
 * backend/bot/bollinger-bands/strategyEngine.js): no RSI Momentum um take-profit rápido pode
 * disparar um novo cruzamento de RSI poucos minutos depois (RSI ainda alto) e reentrar sem
 * pausa, então a moeda fica sempre `reentryCooldownCandles` candles em standby após qualquer
 * saída, não só após stop-loss.
 *
 * Nota: o "reforço no stop" (martingale) NÃO passa por aqui — a recompra ao bater o stop é feita
 * direto no ramo BOUGHT (ver startReinforceLadder em rsi-momentum-bot.js), sem sinal de entrada
 * nem cooldown. O cooldown só volta a valer quando a escada inteira encerra (alvo ou venda
 * forçada) e a moeda volta pra WATCHING.
 */
function checkReentryCooldown(config, cMap, lastExitTime, lastExitReason) {
    const need = Math.max(0, Math.round(Number(config.entry?.reentryCooldownCandles ?? 0)));
    if (need <= 0 || !lastExitTime) {
        return { waiting: false, need, have: 0, remain: 0 };
    }
    const exitMs = new Date(lastExitTime).getTime();
    if (!Number.isFinite(exitMs)) {
        return { waiting: false, need, have: 0, remain: 0 };
    }

    const iv = config.entry.interval;
    const closed = closedCandlesOnly(cMap[iv] ?? []);
    const have = closed.filter(c => Number(c.openTime) >= exitMs).length;
    const remain = Math.max(0, need - have);
    return {
        waiting: remain > 0,
        need,
        have,
        remain,
        interval: iv,
        reason: remain > 0 ? 'REENTRY_COOLDOWN' : null,
    };
}

/**
 * Preço do stop contínuo — mesma matemática do backtest (ver trailingStopCandidate em
 * backend/utils/analyseRsiThresholdBacktest.js#resolveFromSignal), função pura do PICO de preço
 * desde a entrada. `trailingStop.mode` escolhe a mecânica (ver TRAILING_STOP_MODES em
 * tradeConfigSchema.js). Todas as fórmulas são MONOTÔNICAS aqui por construção (o `peak` só
 * cresce e, nas trilhas de 2 fases, a fase B nunca fica acima do stop travado no fim da fase A) —
 * o stop na corretora nunca é afrouxado (ver maybeReplaceTrailingStop, que só recria pra cima).
 *
 * 'atrTrail': precisa do ATR% do momento da compra em `trailingStop.atrPct` (injetado pelo
 * rsi-momentum-bot.js a partir de rules_state.stopAtrPct). Sem ele, a fase B usa `wNearPct` (cai
 * no comportamento da Trilha do Topo com largura única).
 */
function computeTrailingStopPrice(entryPrice, peakPrice, trailingStop) {
    if (!(entryPrice > 0)) return null;
    const num = (v, lo, dflt) => Math.max(lo, Number(v ?? dflt));
    const mode = ['continuous', 'twoPhase', 'peakTrail', 'atrTrail'].includes(trailingStop?.mode)
        ? trailingStop.mode : 'continuous';
    const startPct = num(trailingStop?.startPct, 0.1, 5);
    const peak = Math.max(entryPrice, Number(peakPrice) || entryPrice);
    const gainPct = ((peak / entryPrice) - 1) * 100;
    const baseStop = entryPrice * (1 - startPct / 100);

    if (mode === 'twoPhase') {
        // Distância do stop à entrada, em p.p. (positiva = abaixo/prejuízo). O pivô (lucro travado
        // pivotPct%) fica na distância -pivotPct.
        const pivotPct = Math.max(-5, Math.min(20, Number(trailingStop?.pivotPct ?? 1)));
        const aCoin = num(trailingStop?.aCoinStepPct, 0.1, 3);
        const aStop = num(trailingStop?.aStopStepPct, 0.1, 2.5);
        const bCoin = num(trailingStop?.bCoinStepPct, 0.1, 3);
        const bStop = num(trailingStop?.bStopStepPct, 0.1, 1);
        const pivotDistPct = -pivotPct;
        const stepsA = Math.floor(gainPct / aCoin);
        const stopPctA = startPct - stepsA * aStop;
        if (stopPctA > pivotDistPct) return entryPrice * (1 - stopPctA / 100);
        const gainAtPivot = ((startPct - pivotDistPct) / aStop) * aCoin;
        const stepsB = Math.floor(Math.max(0, gainPct - gainAtPivot) / bCoin);
        return entryPrice * (1 - (pivotDistPct - stepsB * bStop) / 100);
    }

    if (mode === 'peakTrail' || mode === 'atrTrail') {
        const pivotGainPct = num(trailingStop?.pivotGainPct, 0.1, 5);
        const wNear = num(trailingStop?.wNearPct, 0.1, 4);
        let wFar;
        if (mode === 'atrTrail') {
            const atrPct = Number(trailingStop?.atrPct);
            const atrMult = num(trailingStop?.atrMult, 0.1, 2);
            const atrMaxPct = num(trailingStop?.atrMaxPct, 0.5, 12);
            wFar = Number.isFinite(atrPct) ? Math.min(atrMaxPct, atrMult * atrPct) : wNear;
        } else {
            wFar = num(trailingStop?.wFarPct, 0.1, 9);
        }
        if (gainPct < pivotGainPct) {
            return Math.max(baseStop, peak * (1 - wNear / 100));
        }
        // Fase B: piso = stop que a fase A teria travado no limite do pivô (mantém a monotonia
        // quando wFar > wNear afrouxaria o stop no cruzamento de fase).
        const floorAtPivot = entryPrice * (1 + pivotGainPct / 100) * (1 - wNear / 100);
        return Math.max(baseStop, floorAtPivot, peak * (1 - wFar / 100));
    }

    // 'continuous' — rampa linear única ancorada na entrada.
    const coinStepPct = num(trailingStop?.coinStepPct, 0.1, 1);
    const stopStepPct = num(trailingStop?.stopStepPct, 0.1, 1);
    const steps = Math.floor(gainPct / coinStepPct);
    return entryPrice * (1 - (startPct - steps * stopStepPct) / 100);
}

/**
 * Modo do ALVO — independente do stop. 'fixed' (padrão) | 'continuous' | 'off'. Sem
 * `exit.targetMode` salvo (config antiga), deriva do `exit.trailingTarget.enabled` legado.
 */
function resolveTargetMode(config) {
    const m = config?.exit?.targetMode;
    if (m === 'fixed' || m === 'continuous' || m === 'off') return m;
    return config?.exit?.trailingTarget?.enabled ? 'continuous' : 'fixed';
}

/**
 * Alvo contínuo (exit.targetMode === 'continuous') — tem o PRÓPRIO contador de degraus
 * (`exit.trailingTarget.coinStepPct`), independente do stop. A cada `coinStepPct`% de novo pico
 * de preço desde a entrada, o alvo (originalmente `baseTargetPct`% acima da entrada — o mesmo
 * `restingBracket.targetPct`) sobe `stepPct` pontos percentuais — ex.: base +5%, coinStepPct=4,
 * stepPct=3: pico +4% → alvo vira +8%; pico +8% → +11%. Como a Binance limita o quão longe do
 * preço médio atual uma ordem SELL pode ficar (PERCENT_PRICE_BY_SIDE), um alvo que sobe muito
 * acaba PRESO (clamp) na borda permitida por binancePlaceOcoSell — ver ocoClient.js.
 */
function computeTrailingTargetPrice(entryPrice, peakPrice, trailingTarget, baseTargetPct) {
    if (!(entryPrice > 0)) return null;
    const coinStepPct = Math.max(0.1, Number(trailingTarget?.coinStepPct ?? 3));
    const stepPct = Math.max(0.1, Number(trailingTarget?.stepPct ?? 3));
    const base = Math.max(0.1, Number(baseTargetPct ?? 5));
    const peak = Math.max(entryPrice, Number(peakPrice) || entryPrice);
    const gainPct = ((peak / entryPrice) - 1) * 100;
    const steps = Math.floor(gainPct / coinStepPct);
    return entryPrice * (1 + (base + steps * stepPct) / 100);
}

/**
 * Alvo e stop a partir do preço de entrada — os dois modos são INDEPENDENTES.
 *
 * STOP:
 *  - Fixo (`exit.trailingStop.enabled === false`): stop = entryPrice*(1-maxLossPct%), constante.
 *  - Contínuo (`exit.trailingStop.enabled`): sobe em degraus com o `peakPrice`, ver
 *    computeTrailingStopPrice (contador próprio `trailingStop.coinStepPct`).
 *
 * ALVO (`exit.targetMode`):
 *  - 'fixed' (padrão): entryPrice*(1+targetPct%), constante desde a entrada.
 *  - 'continuous': sobe em degraus com o `peakPrice`, contador PRÓPRIO
 *    (`trailingTarget.coinStepPct`), base = `restingBracket.targetPct` — ver computeTrailingTargetPrice.
 *  - 'off': sem alvo — a posição só sai pelo stop (targetPrice === null, salvo pelo teto abaixo).
 *
 * TETO DE LUCRO (`exit.hardTakeProfit`) — venda FORÇADA, independente do targetMode: se ligado, o
 * alvo efetivo é `min(alvo, entryPrice*(1+pct%))`. Com alvo 'off' ou contínuo (que persegue o
 * pico e pode nunca preencher numa alta que reverte — ver EDENUSDT 28/08), o teto garante a
 * saída ao tocar +pct%. `targetCapped` = true quando é o teto que está valendo.
 *
 * `srTargetPrice` (opcional) — alvo por linha de resistência do S/R (ver checkSupportResistanceEntry):
 * quando informado e ACIMA da entrada, o ALVO vira esse preço fixo, no lugar do targetMode (o teto
 * de lucro continua valendo como `min(srTarget, cap)`). Stop não muda. Mesmo comportamento de
 * targetPriceOverride em resolveFromSignal no backtest.
 *
 * `peakPrice` é opcional — sem ele usa entryPrice como pico inicial. Quando alvo ou stop sobe de
 * degrau, essa perna da bracket é recriada na corretora (ver maybeReplaceTrailingStop).
 */
function computeBracketPrices(config, entryPrice, peakPrice, srTargetPrice = null) {
    if (!(entryPrice > 0)) return { targetPrice: null, stopPrice: null, targetCapped: false };
    const baseTargetPct = Math.max(0.1, Number(config.exit?.restingBracket?.targetPct ?? 5));
    const trailingStop = config.exit?.trailingStop;
    const trailingTarget = config.exit?.trailingTarget;
    const targetMode = resolveTargetMode(config);
    const useSrTarget = Number.isFinite(Number(srTargetPrice)) && Number(srTargetPrice) > entryPrice;

    let targetPrice;
    if (useSrTarget) targetPrice = Number(srTargetPrice);
    else if (targetMode === 'off') targetPrice = null;
    else if (targetMode === 'continuous') {
        targetPrice = computeTrailingTargetPrice(entryPrice, peakPrice ?? entryPrice, trailingTarget, baseTargetPct);
    } else targetPrice = entryPrice * (1 + baseTargetPct / 100);

    // Teto de lucro — clampa o alvo (ou cria um se targetMode='off').
    let targetCapped = false;
    const htp = config.exit?.hardTakeProfit;
    if (htp?.enabled) {
        const cap = entryPrice * (1 + Math.max(1, Math.min(200, Number(htp.pct ?? 15))) / 100);
        if (targetPrice == null || cap < targetPrice) {
            targetPrice = cap;
            targetCapped = true;
        }
    }

    const stopPrice = trailingStop?.enabled
        ? computeTrailingStopPrice(entryPrice, peakPrice ?? entryPrice, trailingStop)
        : (config.stopLoss?.enabled
            ? computeStopLossFloor(entryPrice, entryPrice, { ...config.stopLoss, trailing: false })
            : null);
    return { targetPrice, stopPrice, targetCapped };
}

/** Saída via candle — fallback usado só quando não há bracket resting (desligada ou falhou ao
 *  colocar): máxima do candle em formação alcança o alvo, ou mínima rompe o stop. No empate
 *  (mesmo candle) assume o pior caso (stop primeiro), mesmo critério do backtest.
 *  opts.peakPrice: maior preço visto desde a compra — só relevante com exit.trailingStop
 *  ligado (ver computeBracketPrices); ignorado no modo fixo.
 *  opts.srTargetPrice: alvo por resistência do S/R travado na compra (ver computeBracketPrices). */
function evaluateExit(config, cMap, entryPrice, opts = {}) {
    const iv = config.entry.interval;
    const raw = cMap[iv] ?? [];
    if (!raw.length) return { exit: false };

    const live = raw[raw.length - 1];
    const close = parseFloat(live.close);
    const high = parseFloat(live.high ?? live.close);
    const low = parseFloat(live.low ?? live.close);

    const { targetPrice, stopPrice, targetCapped } = computeBracketPrices(config, entryPrice, opts.peakPrice, opts.srTargetPrice ?? null);

    if (stopPrice != null && low <= stopPrice) {
        return {
            exit: true, reason: 'STOP_LOSS', close,
            dropPct: entryPrice ? ((close - entryPrice) / entryPrice) * 100 : null,
            stopFloor: stopPrice,
        };
    }
    if (targetPrice != null && high >= targetPrice) {
        const hitPct = entryPrice ? ((targetPrice - entryPrice) / entryPrice) * 100 : null;
        const usedSrTarget = Number.isFinite(Number(opts.srTargetPrice))
            && Number(opts.srTargetPrice) > entryPrice
            && Math.abs(targetPrice - Number(opts.srTargetPrice)) < targetPrice * 1e-6;
        const exitDesc = targetCapped
            ? `Teto de lucro +${config.exit.hardTakeProfit.pct}% (venda forçada)`
            : usedSrTarget
                ? `Alvo na resistência S/R (+${hitPct != null ? hitPct.toFixed(1) : '?'}%)`
                : resolveTargetMode(config) === 'continuous'
                    ? `Alvo contínuo +${hitPct != null ? hitPct.toFixed(1) : '?'}% de lucro`
                    : `Alvo fixo +${config.exit.restingBracket.targetPct}% de lucro`;
        return { exit: true, reason: 'RSI_TARGET', close, targetLevelValue: targetPrice, exitDesc };
    }
    return { exit: false, close };
}

module.exports = {
    RSI_PERIOD,
    PULLBACK_INTERVAL,
    intervalMs,
    closedCandlesOnly,
    computeRsiSeries,
    getRequiredSpecs,
    checkBandWidthFilter,
    checkRsi5mFilter,
    checkMacdFilter,
    checkHigherRsiFilter,
    resolveSrZonesNow,
    pickSupport,
    pickResistance,
    checkSupportResistanceEntry,
    evaluateReinforceLadder,
    computeAtrPct,
    evaluateEntrySignal,
    evaluateExit,
    checkEntryLimitExpired,
    checkReentryCooldown,
    computeBracketPrices,
    computeStopLossFloor,
    computeTrailingStopPrice,
    computeTrailingTargetPrice,
    resolveTargetMode,
};
