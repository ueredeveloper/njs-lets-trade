'use strict';

const RSI = require('technicalindicators').RSI;
const { closedCandlesOnly, intervalMs } = require('../ma-cross/strategyEngine');
const { computeStopLossFloor } = require('../shared/stopLossFloor');
const { bollingerCycleOccurrences } = require('../../utils/indicatorGrowthEngines');
const { averageWithoutOutliers } = require('../../utils/removeOutliersIQR');

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
// Intervalo do filtro entry.prevDayCloud — '1d' (padrão) ou '3d', mesmo seletor do gráfico e do
// backtest (ver prevDayCloudInterval em CandlestickChart.jsx). 5 candles bastam pra sempre ter
// pelo menos 2 fechados (o "de ontem"/"dos últimos 3 dias" e o anterior a ele) mesmo com algum
// atraso/gap pontual do candle. Bot RSI Momentum só opera Binance — sem a limitação de 3d que a
// Gate.io tem no backtest/gráfico.
const PREV_DAY_CLOUD_INTERVAL = '1d';
const PREV_DAY_CLOUD_LIMIT = 5;

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

    if (entry.prevDayCloud?.enabled) {
        const pdcCandleCount = Math.max(1, Math.round(Number(entry.prevDayCloud.candleCount ?? 1)));
        add(entry.prevDayCloud.interval ?? PREV_DAY_CLOUD_INTERVAL, Math.max(PREV_DAY_CLOUD_LIMIT, pdcCandleCount + 3));
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
 * Ligado por padrão — recusa o sinal se o PRÓPRIO candle do cruzamento (abertura→fechamento) já
 * subiu mais que maxMovePct%. Sem isso, um candle-pico (ex.: STORJUSDT 24/08/2026, +11% sozinho
 * num candle de 15m) passa no cruzamento de RSI normalmente, e o pullback de belowPct% (tipicamente
 * <1%) só protege do fechamento já inflado — a compra sai perto do topo do próprio candle do sinal,
 * não do preço de antes do pump. Filtra pelo candle em si, não pela série — barato, sem lookback.
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
 * Filtro opcional (desligado por padrão — ver comentário em tradeConfigSchema.js): exige que o
 * preço do sinal esteja DENTRO da nuvem D-1 — envelope [menor open/close, maior open/close] dos
 * últimos `candleCount` candles NATIVOS (no interval acima, padrão 4h) anteriores ao sinal, mesmo
 * indicador do gráfico (ver buildPrevDayCloudSegments em
 * frontend-react/src/components/CandlestickChart.jsx) e do backtest (ver checkPrevDayCloudFilter
 * em backend/utils/analyseRsiThresholdBacktest.js). candleCount=1 (padrão) é só o candle anterior
 * sozinho. A faixa aceita é [lower, lower + maxPct% × (upper-lower)] — não importa se o(s)
 * candle(s) anterior(es) fecharam em alta ou baixa. maxPct=100 exige só estar dentro da nuvem
 * inteira; valores menores restringem à parte de baixo dela. Sem candle(s) anterior(es)
 * suficiente(s) ainda (favorito recém-criado), libera — fail-open, como os demais filtros
 * baseados em série própria.
 */
function checkPrevDayCloudFilter(config, cMap, signalCandle) {
    const pdc = config.entry?.prevDayCloud;
    if (!pdc?.enabled) return { allowed: true };

    // closedCandlesOnly já descarta o candle de HOJE (ainda em formação) — diferente do backtest
    // (que busca um histórico com vários sinais passados e por isso precisa achar os candles
    // "anteriores ao do sinal" dentro do array inteiro), aqui o sinal é sempre "agora": os últimos
    // candles FECHADOS já SÃO a referência, sem precisar de nenhum índice-1.
    const closed = closedCandlesOnly(cMap[pdc.interval ?? PREV_DAY_CLOUD_INTERVAL] ?? []);
    const n = Math.max(1, Math.round(Number(pdc.candleCount ?? 1)));
    if (closed.length < n) return { allowed: true };

    const window = closed.slice(closed.length - n);
    let lower = Infinity, upper = -Infinity;
    for (const c of window) {
        const open = parseFloat(c.open);
        const close = parseFloat(c.close);
        if (open > 0) { lower = Math.min(lower, open); upper = Math.max(upper, open); }
        if (close > 0) { lower = Math.min(lower, close); upper = Math.max(upper, close); }
    }
    if (!(upper > 0) || !Number.isFinite(lower)) return { allowed: true };
    if (upper <= lower) return { allowed: true }; // nuvem "achatada" — sem restrição possível

    const price = parseFloat(signalCandle.close);
    const limit = lower + (pdc.maxPct / 100) * (upper - lower);
    if (price < lower || price > limit) {
        return { allowed: false, reason: 'PREVDAY_CLOUD_OUT_OF_RANGE', price, lower, upper, limit, maxPct: pdc.maxPct };
    }
    return { allowed: true, price, lower, upper, limit, maxPct: pdc.maxPct };
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
 * de earlyConfirm.interval, ex. 5m) como preço provisório do candle ainda em formação — se isso já
 * cruza o threshold, o sinal dispara ali (2-3 checkpoints antes do fechamento cheio), sem esperar
 * o candle inteiro fechar. O threshold e o intervalo do RSI continuam os mesmos (entry.interval);
 * só o MOMENTO em que a confirmação é aceita muda. Sem checkpoint disponível ainda (início da
 * janela) ou com earlyConfirm desligado, cai no comportamento original (só candle FECHADO).
 *
 * Caso real que motivou isso: STORJUSDT 24/08/2026, candle de 15m que só terminou de cruzar no
 * próprio fechamento, já tendo subido +11% sozinho — adiantar pro 1º/2º checkpoint de 5m dentro
 * da janela pega o cruzamento mais cedo, antes do candle de 15m ter subido tudo que subiu (ver
 * também checkSpikeGuardFilter, que passa a comparar contra esse preço de confirmação adiantada).
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
    if (!crossed) {
        const forming = raw[raw.length - 1];
        const checkpoint = findEarlyConfirmCheckpoint(entry, cMap, forming);
        if (checkpoint && lastClosedRsi < threshold) {
            const closesWithCheckpoint = [...closed.map(c => parseFloat(c.close)), parseFloat(checkpoint.close)];
            const rsiWithCheckpoint = RSI.calculate({ values: closesWithCheckpoint, period: RSI_PERIOD });
            const earlyRsi = rsiWithCheckpoint[rsiWithCheckpoint.length - 1];
            if (earlyRsi != null && earlyRsi >= threshold) {
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

    const prevDayCloudCheck = checkPrevDayCloudFilter(config, cMap, signalCandle);
    if (!prevDayCloudCheck.allowed) {
        return { allowed: false, reason: prevDayCloudCheck.reason, rsi: last, threshold, prevDayCloud: prevDayCloudCheck };
    }

    const signalPrice = parseFloat(signalCandle.close);
    const signalOpenTime = Number(signalCandle.openTime);
    const pullbackPct = entry.pullback?.enabled ? Math.max(0.01, entry.pullback.belowPct) : 0;
    const limitPrice = pullbackPct > 0 ? signalPrice * (1 - pullbackPct / 100) : null;

    const confirmNote = earlyCheckpoint ? ` — confirmação adiantada (checkpoint ${entry.earlyConfirm.interval})` : '';
    const entryDesc = pullbackPct > 0
        ? `RSI(${RSI_PERIOD}) ${iv} cruzou ${threshold} (${last.toFixed(2)})${confirmNote} — pullback -${pullbackPct}%`
        : `RSI(${RSI_PERIOD}) ${iv} cruzou ${threshold} (${last.toFixed(2)})${confirmNote}`;

    return {
        allowed: true,
        close: signalPrice,
        limitPrice,
        rsi: last,
        threshold,
        bandWidth: bandWidthCheck,
        rsi5m: rsi5mCheck,
        spikeGuard: spikeGuardCheck,
        prevDayCloud: prevDayCloudCheck,
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
 * Alvo/stop FIXOS a partir do preço de entrada — entryPrice*(1+targetPct%) /
 * entryPrice*(1-maxLossPct%). Sem trailing, sem ancorar em EMA/banda (diferente do
 * bollinger-bands): não há "nível" nenhum que se mova a cada candle novo pra perseguir, então
 * a bracket colocada na corretora nunca precisa ser recriada por deriva.
 */
function computeBracketPrices(config, entryPrice) {
    if (!(entryPrice > 0)) return { targetPrice: null, stopPrice: null };
    const targetPct = Math.max(0.1, Number(config.exit?.restingBracket?.targetPct ?? 5));
    const targetPrice = entryPrice * (1 + targetPct / 100);
    const stopPrice = config.stopLoss?.enabled
        ? computeStopLossFloor(entryPrice, entryPrice, { ...config.stopLoss, trailing: false })
        : null;
    return { targetPrice, stopPrice };
}

/** Saída via candle — fallback usado só quando não há bracket resting (desligada ou falhou ao
 *  colocar): máxima do candle em formação alcança o alvo, ou mínima rompe o stop. No empate
 *  (mesmo candle) assume o pior caso (stop primeiro), mesmo critério do backtest. */
function evaluateExit(config, cMap, entryPrice) {
    const iv = config.entry.interval;
    const raw = cMap[iv] ?? [];
    if (!raw.length) return { exit: false };

    const live = raw[raw.length - 1];
    const close = parseFloat(live.close);
    const high = parseFloat(live.high ?? live.close);
    const low = parseFloat(live.low ?? live.close);

    const { targetPrice, stopPrice } = computeBracketPrices(config, entryPrice);

    if (stopPrice != null && low <= stopPrice) {
        return {
            exit: true, reason: 'STOP_LOSS', close,
            dropPct: entryPrice ? ((close - entryPrice) / entryPrice) * 100 : null,
            stopFloor: stopPrice,
        };
    }
    if (targetPrice != null && high >= targetPrice) {
        return {
            exit: true, reason: 'RSI_TARGET', close,
            targetLevelValue: targetPrice,
            exitDesc: `Alvo fixo +${config.exit.restingBracket.targetPct}% de lucro`,
        };
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
    checkPrevDayCloudFilter,
    evaluateEntrySignal,
    evaluateExit,
    checkEntryLimitExpired,
    checkReentryCooldown,
    computeBracketPrices,
    computeStopLossFloor,
};
