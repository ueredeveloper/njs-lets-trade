'use strict';

const { RSI, ADX, MACD, ATR } = require('technicalindicators');
const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { bollingerCycleOccurrences } = require('./indicatorGrowthEngines');
const { averageWithoutOutliers } = require('./removeOutliersIQR');
const getTickers = require('../binance/cachedTicker24hr');
const { computeDailyEntryStats } = require('./dailyEntryStats');
const { computeAvgTradeDurationMs } = require('./tradeDurationStats');
const { detectSupportResistance } = require('./supportResistance');
const { detectPivotPointsHighLow } = require('./pivotPointsHighLow');

const RSI_PERIOD = 14;
const DEFAULT_CANDLE_COUNT = 1000;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const BB_MIN_CANDLES_PADDING = 5;
// Intervalos aceitos pelo seletor da nuvem D-1 (options.prevDayCloud.interval) — mesmo leque do
// gráfico (ver PREV_DAY_CLOUD_INTERVAL_OPTIONS em frontend-react/src/utils/uiPreferences.js).
const PREV_DAY_CLOUD_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
// Subconjunto com candle nativo na Gate.io (ver CLAUDE.md) — com source='gate' e um interval fora
// dessa lista, cai pra '1d'.
const GATE_PREV_DAY_CLOUD_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
// ADX/MACD: períodos fixos, sem seletor próprio — só o intervalo é configurável (mesmo padrão
// "1 detalhe configurável por filtro" dos demais). 14 (ADX) e 12/26/9 (MACD) são os valores
// padrão de mercado, os mesmos usados na literatura consultada (Wilder pro ADX, Appel pro MACD).
const ADX_PERIOD = 14;
// ATR de Wilder — usado só pelo stop contínuo modo 'atrTrail' (largura da fase B = atrMult × ATR%).
// Período fixo 14 (padrão Wilder, mesmo do ADX), calculado no PRÓPRIO intervalo do sinal.
const ATR_PERIOD = 14;
const MACD_FAST_PERIOD = 12;
const MACD_SLOW_PERIOD = 26;
const MACD_SIGNAL_PERIOD = 9;
// Warmup mínimo de cada indicador (candles perdidos até o 1º valor válido da série) — usado só
// pra dimensionar o fetch (computeOwnIntervalFetchLimit), com folga generosa.
const ADX_WARMUP_BARS = ADX_PERIOD * 2 + 10;
const MACD_WARMUP_BARS = MACD_SLOW_PERIOD + MACD_SIGNAL_PERIOD + 10;
const RSI_WARMUP_BARS = RSI_PERIOD * 3 + 10;
// RSI de referência num intervalo FIXO (1h), só INFORMATIVO — não filtra nada. Serve pra
// conferir o RSI num timeframe maior que o do sinal de entrada (ex.: sinal em 15m, leitura de
// apoio em 1h) direto na tabela de ocorrências. Mesma mecânica "intervalo próprio" de ADX/MACD
// (computeOwnIntervalFetchLimit + resolveOwnIntervalValueAt). Com o intervalo do sinal já em
// 1h, reaproveita a série de RSI principal em vez de buscar candles de novo.
const REF_RSI_INTERVAL = '1h';
// Mesmo teto de retenção do cache de candles de 1m (ver backend/utils/candleRetentionLimits.js)
// — não faz sentido pedir mais 1m do que o resto do sistema mantém aquecido. Sinais mais
// antigos que essa janela (~50h) caem no fallback de resolução pelo candle do intervalo
// principal (ver resolveFromSignal / needsCoarseFallback abaixo).
const MAX_ONE_MINUTE_CANDLES = 3000;

/**
 * A partir do preço/instante do sinal, resolve o preenchimento do pullback (se houver) e o
 * resultado do bracket alvo/stop — "OCO" (One-Cancels-the-Other), mesma mecânica de saída do
 * bot Bollinger Bands (ver backend/bot/bollinger-bands/strategyEngine.js, exit.restingBracket):
 * assim que a posição entra, arma alvo E stop simultaneamente; o que for tocado primeiro
 * encerra a operação. `scanCandles` deve conter só candles com openTime > signalCloseMs.
 */
function resolveFromSignal(scanCandles, signalPrice, { pullbackPct, targetPct, stopLossPct, stopPriceOverride, targetPriceOverride, trailingStop, trailingTarget, targetMode, hardTakeProfitPct }) {
    let filled = pullbackPct === 0;
    let entryTime = null;
    let entryPrice = signalPrice;
    let startScanIdx = 0;

    if (pullbackPct !== 0) {
        const limitPrice = signalPrice * (1 + pullbackPct / 100);
        filled = false;
        for (let j = 0; j < scanCandles.length; j++) {
            if (parseFloat(scanCandles[j].low) <= limitPrice) {
                filled = true;
                entryTime = scanCandles[j].openTime;
                entryPrice = limitPrice;
                startScanIdx = j + 1;
                break;
            }
        }
        if (!filled) return { filled: false };
    }

    // ALVO e STOP são INDEPENDENTES.
    //   Stop: 'trailing' (trailingStop.enabled) sobe em degraus com o pico (contador próprio
    //         trailingStop.coinStepPct); senão é fixo (stopLossPct / stopPriceOverride 4h).
    //   Alvo (targetMode): 'fixed' = entry*(1+targetPct%); 'continuous' = base targetPct% subindo
    //         em degraus com contador PRÓPRIO (trailingTarget.coinStepPct), `stepPct` p.p. por
    //         degrau; 'off' = sem alvo, só sai pelo stop. Sem targetMode explícito → 'fixed'
    //         (compat: 'continuous' se veio trailingTarget.enabled do formato antigo).
    const stopTrailingOn = !!trailingStop?.enabled;
    // Alvo = linha de resistência de saída do S/R (preço absoluto, no lugar do targetPct% fixo).
    // Só vale pra uma compra se estiver acima da entrada; quando ativo, o ALVO vira 'fixed' nesse
    // preço (o modo contínuo/off do targetMode passa a valer só quando não há resistência).
    const useSrTarget = targetPriceOverride != null && targetPriceOverride > entryPrice;
    const tMode = useSrTarget
        ? 'fixed'
        : (targetMode === 'fixed' || targetMode === 'continuous' || targetMode === 'off')
            ? targetMode
            : (trailingTarget?.enabled ? 'continuous' : 'fixed');
    const ttCoinStepPct = Math.max(0.1, Number(trailingTarget?.coinStepPct ?? 3));
    const ttStepPct = Math.max(0.1, Number(trailingTarget?.stepPct ?? 3));
    // Teto de lucro (venda forçada) — mesmo do bot (exit.hardTakeProfit em tradeConfigSchema.js):
    // o alvo efetivo é min(alvo, cap). Com alvo 'off' ou contínuo (que persegue o pico e pode
    // nunca casar), o cap garante a saída ao tocar +hardTakeProfitPct%.
    const capPrice = hardTakeProfitPct > 0 ? entryPrice * (1 + hardTakeProfitPct / 100) : null;
    const clampTarget = (tp) => capPrice == null ? tp : (tp == null ? capPrice : Math.min(tp, capPrice));
    let targetPrice = clampTarget(
        useSrTarget ? targetPriceOverride
            : tMode === 'off' ? null
                : entryPrice * (1 + targetPct / 100),
    );

    // Stop pelo candle 4h anterior (ver resolvePrevCandleStopPrice): preço absoluto, não %. Só
    // usa o override se fizer sentido pra uma compra (abaixo do preço de entrada). Sem override
    // válido, cai no stop fixo (stopLossPct ou trailingStop.startPct no modo contínuo).
    const startStopPct = stopTrailingOn ? Number(trailingStop.startPct ?? stopLossPct) : stopLossPct;
    let stopPrice = (!stopTrailingOn && Number.isFinite(stopPriceOverride) && stopPriceOverride > 0 && stopPriceOverride < entryPrice)
        ? stopPriceOverride
        : entryPrice * (1 - startStopPct / 100);

    let outcome = 'open';
    let exitTime = null;
    let exitPrice = null;
    let peakPrice = entryPrice;
    const stopCoinStepPct = stopTrailingOn ? Math.max(0.1, Number(trailingStop.coinStepPct ?? 1)) : null;
    const stopStepPct = stopTrailingOn ? Math.max(0.1, Number(trailingStop.stopStepPct ?? 1)) : null;
    const anyTrailing = stopTrailingOn || tMode === 'continuous';

    // Modo do stop contínuo (todos INDEPENDENTES do alvo) — ver JSDoc de options.trailingStop:
    //   'continuous' (padrão): rampa linear única, ancorada na ENTRADA — stop sobe `stopStepPct` p.p.
    //       a cada `stopCoinStepPct`% de alta do pico.
    //   'twoPhase' (Escada Dupla): ancorada na ENTRADA, DUAS inclinações — fase A (agressiva,
    //       aStopStepPct/aCoinStepPct) até o stop travar `pivotPct`% de lucro; depois fase B (suave,
    //       bStopStepPct/bCoinStepPct) contando a partir desse ponto.
    //   'peakTrail' (Trilha do Topo): ancorada no PICO — stop a `wNearPct`% abaixo do topo enquanto
    //       o ganho do pico < `pivotGainPct`%, e a `wFarPct`% abaixo depois. Chandelier de % em 2 fases.
    //   'atrTrail' (Trilha ATR): igual à Trilha do Topo, mas a largura da fase B = `atrMult` × ATR%
    //       (ATR de Wilder no instante do sinal, em `trailingStop.atrPct`), limitada a `atrMaxPct`%.
    //       Sem ATR disponível (warmup) usa `wNearPct` o tempo todo.
    // Todos MONOTÔNICOS: stopPrice = max(stopPrice, candidato) — o stop nunca desce.
    const tsMode = ['continuous', 'twoPhase', 'peakTrail', 'atrTrail'].includes(trailingStop?.mode)
        ? trailingStop.mode : 'continuous';
    // pivotPct = LUCRO travado no fim da fase A (positivo = acima da entrada; 0 = breakeven).
    const tsPivotPct     = Math.max(-5, Math.min(20, Number(trailingStop?.pivotPct ?? 1)));
    const tsACoinStepPct = Math.max(0.1, Number(trailingStop?.aCoinStepPct ?? 3));
    const tsAStopStepPct = Math.max(0.1, Number(trailingStop?.aStopStepPct ?? 2.5));
    const tsBCoinStepPct = Math.max(0.1, Number(trailingStop?.bCoinStepPct ?? 3));
    const tsBStopStepPct = Math.max(0.1, Number(trailingStop?.bStopStepPct ?? 1));
    const tsPivotGainPct = Math.max(0.1, Number(trailingStop?.pivotGainPct ?? 5));
    const tsWNearPct     = Math.max(0.1, Number(trailingStop?.wNearPct ?? 4));
    const tsWFarPct      = Math.max(0.1, Number(trailingStop?.wFarPct ?? 9));
    const tsAtrMult      = Math.max(0.1, Number(trailingStop?.atrMult ?? 2));
    const tsAtrMaxPct    = Math.max(0.5, Number(trailingStop?.atrMaxPct ?? 12));
    const tsAtrPct       = Number(trailingStop?.atrPct);

    // Preço candidato do stop dado o ganho % do pico corrente — aplicado sempre como max() (monotônico).
    function trailingStopCandidate(gainPct) {
        if (tsMode === 'twoPhase') {
            // Distância do stop à entrada em p.p. (positiva = abaixo/prejuízo). O pivô, em lucro
            // travado `tsPivotPct`%, corresponde à distância -tsPivotPct.
            const pivotDistPct = -tsPivotPct;
            const stepsA = Math.floor(gainPct / tsACoinStepPct);
            const stopPctA = startStopPct - stepsA * tsAStopStepPct;
            if (stopPctA > pivotDistPct) return entryPrice * (1 - stopPctA / 100);
            // ganho (aprox., contínuo) em que a fase A cruza o pivô — a fase B conta a partir dele
            const gainAtPivot = ((startStopPct - pivotDistPct) / tsAStopStepPct) * tsACoinStepPct;
            const stepsB = Math.floor(Math.max(0, gainPct - gainAtPivot) / tsBCoinStepPct);
            return entryPrice * (1 - (pivotDistPct - stepsB * tsBStopStepPct) / 100);
        }
        if (tsMode === 'peakTrail') {
            const w = gainPct < tsPivotGainPct ? tsWNearPct : tsWFarPct;
            return peakPrice * (1 - w / 100);
        }
        if (tsMode === 'atrTrail') {
            if (gainPct < tsPivotGainPct || !Number.isFinite(tsAtrPct)) {
                return peakPrice * (1 - tsWNearPct / 100);
            }
            return peakPrice * (1 - Math.min(tsAtrMaxPct, tsAtrMult * tsAtrPct) / 100);
        }
        // 'continuous'
        const steps = Math.floor(gainPct / stopCoinStepPct);
        return entryPrice * (1 - (startStopPct - steps * stopStepPct) / 100);
    }

    for (let j = startScanIdx; j < scanCandles.length; j++) {
        const low = parseFloat(scanCandles[j].low);
        const high = parseFloat(scanCandles[j].high);

        // Alvo contínuo: a ordem resting reflete o pico ATÉ o candle anterior. Checa o nível
        // VIGENTE antes de subir o degrau com o high DESTE candle — pra o alvo subir o preço
        // precisa ter passado pelo nível antigo, que já teria enchido a ordem lá (um alvo que
        // sobe rápido demais nunca preenche). Fica antes do stop no empate: o alvo é uma ordem
        // limite que casa na subida; o stop só sobe DEPOIS.
        if (tMode === 'continuous' && targetPrice != null && high >= targetPrice) {
            outcome = 'target';
            exitTime = scanCandles[j].openTime;
            exitPrice = targetPrice;
            break;
        }

        // A cada novo topo: stop contínuo sobe `stopStepPct` p.p. por `stopCoinStepPct`% de alta;
        // alvo contínuo sobe `ttStepPct` p.p. por `ttCoinStepPct`% de alta (contadores separados).
        // Atualiza ANTES de checar o candle — critério conservador de sempre (subida antes da queda).
        if (anyTrailing && high > peakPrice) {
            peakPrice = high;
            const gainPct = ((peakPrice / entryPrice) - 1) * 100;
            if (stopTrailingOn) {
                stopPrice = Math.max(stopPrice, trailingStopCandidate(gainPct));
            }
            if (tMode === 'continuous') {
                const steps = Math.floor(gainPct / ttCoinStepPct);
                targetPrice = clampTarget(entryPrice * (1 + (targetPct + steps * ttStepPct) / 100));
            }
        } else if (stopTrailingOn && (tsMode === 'peakTrail' || tsMode === 'atrTrail')) {
            // Trilha ancorada no pico: mesmo sem novo topo, a largura da fase A (`wNearPct`) pode já
            // ser mais apertada que o stop base — aplica na 1ª passada (max() garante a monotonia).
            stopPrice = Math.max(stopPrice, trailingStopCandidate(((peakPrice / entryPrice) - 1) * 100));
        }

        // Ordem intra-candle desconhecida (só OHLC) — no empate assume o pior caso (stop primeiro).
        if (low <= stopPrice) {
            outcome = 'stop';
            exitTime = scanCandles[j].openTime;
            exitPrice = stopPrice;
            break;
        }
        // 'fixed' e também 'off'-com-teto (targetPrice = capPrice) — continuous já foi checado no topo.
        if (tMode !== 'continuous' && targetPrice != null && high >= targetPrice) {
            outcome = 'target';
            exitTime = scanCandles[j].openTime;
            exitPrice = targetPrice;
            break;
        }
    }

    if (outcome === 'open') {
        exitPrice = scanCandles.length
            ? parseFloat(scanCandles[scanCandles.length - 1].close)
            : entryPrice;
    }

    // Quantos degraus o stop / o alvo tinham subido no momento da saída (0 = ainda na base —
    // stop no -startPct%, alvo no +targetPct%). Serve pra separar "stop base / não evoluiu" de
    // "stop que já tinha subido" nas estatísticas.
    const peakGainPct = ((peakPrice / entryPrice) - 1) * 100;
    // Nos modos ancorados no pico (peakTrail/atrTrail) não há degrau discreto: 0 = stop ainda no
    // piso inicial, 1 = já subiu. twoPhase reaproveita o contador da fase A; continuous, o de sempre.
    let stopSteps = 0;
    if (stopTrailingOn) {
        if (tsMode === 'twoPhase') {
            stopSteps = Math.max(0, Math.floor(peakGainPct / tsACoinStepPct));
        } else if (tsMode === 'peakTrail' || tsMode === 'atrTrail') {
            stopSteps = stopPrice > entryPrice * (1 - startStopPct / 100) * (1 + 1e-9) ? 1 : 0;
        } else {
            stopSteps = Math.max(0, Math.floor(peakGainPct / stopCoinStepPct));
        }
    }
    const targetSteps = tMode === 'continuous' ? Math.max(0, Math.floor(peakGainPct / ttCoinStepPct)) : 0;

    return {
        filled: true, entryTime, entryPrice, targetPrice, stopPrice, outcome, exitTime, exitPrice,
        stopSteps, targetSteps, peakGainPct: parseFloat(peakGainPct.toFixed(2)),
    };
}

/** Maior índice i tal que candles[i].openTime <= timeMs (busca binária — candles vem ordenado
 *  ascendente de getCandles/getGateCandles). -1 se nenhum candle é anterior/igual a timeMs.
 *  Reaproveitado por todos os filtros/stops que usam um candle de um intervalo PRÓPRIO
 *  (D-1/stop 4h/ADX/MACD) pra achar o candle relevante no instante de cada sinal. */
function findCandleIndexAtOrBefore(dailyCandles, timeMs) {
    let lo = 0, hi = dailyCandles.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dailyCandles[mid].openTime <= timeMs) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return best;
}

/** Candles necessários num intervalo PRÓPRIO (ownInterval) pra cobrir a janela do intervalo
 *  principal (mainLimit candles) + warmup do indicador — mesma ideia de pdcDayLimit/pcsFourHLimit,
 *  generalizada. Usado pelos filtros ADX/MACD (cada um no seu próprio intervalo escolhido). */
function computeOwnIntervalFetchLimit(mainInterval, mainLimit, ownInterval, warmupBars, maxLimit = 3000) {
    const mainMs = mainInterval === '1m' ? 60_000 : intervalMs(mainInterval);
    const ownMs = intervalMs(ownInterval) ?? mainMs;
    const spanBars = Math.ceil((mainLimit * mainMs) / ownMs);
    return Math.min(maxLimit, Math.max(warmupBars + 20, spanBars + warmupBars + 20));
}

/**
 * Valor de uma série de indicador (ADX, MACD…) calculada num intervalo PRÓPRIO, no candle mais
 * recente já fechado ATÉ o instante do sinal (não o candle ANTERIOR a ele — diferente da nuvem
 * D-1/stop 4h, aqui queremos a leitura VIGENTE do indicador no momento da compra, pra confirmar
 * força/tendência ali mesmo). `pick(seriesEntry)` extrai o número desejado (ex.: `.adx`,
 * `.histogram`). null se não houver candle/warmup suficiente ainda.
 */
function resolveOwnIntervalValueAt(ownCandles, ownSeries, ownOffset, timeMs, pick) {
    if (!ownSeries.length) return null;
    const idx = findCandleIndexAtOrBefore(ownCandles, timeMs);
    const seriesIdx = idx - ownOffset;
    if (seriesIdx < 0 || seriesIdx >= ownSeries.length) return null;
    const value = pick(ownSeries[seriesIdx]);
    return Number.isFinite(value) ? value : null;
}

/**
 * Nuvem D-1 válida no instante do sinal — agrupada em degraus de EXATAMENTE 1 candle (mesmo
 * passo do desenho do gráfico, ver buildPrevDayCloudSegments em CandlestickChart.jsx), contados
 * de trás pra frente a partir do candle mais recente da amostra (`dailyCandles` inteiro, não só
 * até o sinal) — o valor que um sinal específico "vê" é o mesmo que aparece desenhado no gráfico
 * pra aquele período.
 *
 * IMPORTANTE: o passo tem que ser 1 candle, nunca `windowSize - 1` — usar `windowSize - 1` aqui
 * (como antes) desalinha o passo do degrau (que anda N-1 candles) do passo do VALOR (que anda 1
 * candle por sinal mais antigo), causando um sinal alguns degraus pra trás "ver" a nuvem de
 * candles que na verdade ainda estão NO FUTURO dele (caso real: ZRO, sinal perto de 18/08
 * enxergando candles de 22/08 — ver conversa). null se não houver candle suficiente antes do
 * sinal (início da amostra).
 */
function resolvePrevDayCloud(dailyCandles, signalTimeMs, candleCount = 1, useHighLow = false) {
    const n = Math.max(1, Math.round(Number(candleCount) || 1));
    const lastIndex = dailyCandles.length - 1;
    const lastClosedIndex = dailyCandles.length - 2;
    if (lastClosedIndex < 0) return null;
    const curIdx = findCandleIndexAtOrBefore(dailyCandles, signalTimeMs);
    if (curIdx < 0) return null;
    const k = Math.max(0, lastIndex - curIdx);
    const valueEnd = lastClosedIndex - k;
    const valueStart = valueEnd - n + 1;
    if (valueStart < 0) return null;
    const window = dailyCandles.slice(valueStart, valueEnd + 1);
    if (!window.length) return null;
    let lower = Infinity, upper = -Infinity;
    for (const c of window) {
        if (useHighLow) {
            const high = parseFloat(c.high);
            const low = parseFloat(c.low);
            if (low > 0) lower = Math.min(lower, low);
            if (high > 0) upper = Math.max(upper, high);
        } else {
            const open = parseFloat(c.open);
            const close = parseFloat(c.close);
            if (open > 0) { lower = Math.min(lower, open); upper = Math.max(upper, open); }
            if (close > 0) { lower = Math.min(lower, close); upper = Math.max(upper, close); }
        }
    }
    if (!(upper > 0) || !Number.isFinite(lower)) return null;
    return { lower, upper };
}

/**
 * Preço do sinal precisa estar ATÉ a faixa [-∞, lower + maxPct% × altura] da nuvem D-1 — não
 * importa se o(s) candle(s) anterior(es) fecharam em alta ou baixa (ver JSDoc de
 * analyseRsiThresholdBacktest, options.prevDayCloud). Preço ABAIXO da nuvem inteira também libera
 * (desconto maior ainda que a própria nuvem); só bloqueia acima do limite (preço caro demais). Sem
 * nuvem de referência disponível (início da amostra), não bloqueia.
 */
function checkPrevDayCloudFilter(dailyCandles, signalTimeMs, price, maxPct, candleCount = 1, useHighLow = false) {
    const cloud = resolvePrevDayCloud(dailyCandles, signalTimeMs, candleCount, useHighLow);
    if (!cloud) return true;
    const { lower, upper } = cloud;
    if (upper <= lower) return true; // nuvem "achatada" (abertura == fechamento) — sem restrição possível
    const limit = lower + (maxPct / 100) * (upper - lower);
    return price <= limit;
}

/**
 * Em qual das 5 faixas verticais de MESMA altura da nuvem D-1 o preço do sinal cai — faixa 1 = a
 * mais BAIXA (fundo da nuvem), faixa 5 = a mais alta (topo). Preço abaixo do fundo inteiro cai na
 * faixa 1; acima do topo inteiro, na faixa 5 (clamp). null quando não há nuvem de referência
 * (início da amostra) ou ela está achatada (upper == lower) — sem faixas possíveis.
 */
function classifyCloudZone(cloud, price) {
    if (!cloud) return null;
    const { lower, upper } = cloud;
    if (!(upper > lower)) return null;
    const zone = Math.floor(((price - lower) / (upper - lower)) * 5) + 1;
    return Math.max(1, Math.min(5, zone));
}

/**
 * Distribuição dos sinais pelas 5 faixas verticais da nuvem D-1 (ver classifyCloudZone) — quantos
 * sinais caíram em cada faixa e, dos preenchidos, taxa de acerto / P&L médio por faixa. Conta
 * TODOS os sinais com faixa resolvida (preenchidos ou não). null se nenhum sinal tem faixa.
 */
function computeZoneStats(occurrences, key) {
    const withZone = occurrences.filter(o => o[key] >= 1 && o[key] <= 5);
    if (!withZone.length) return null;
    const zones = [1, 2, 3, 4, 5].map((zone) => {
        const list = withZone.filter(o => o[key] === zone);
        const filled = list.filter(o => o.filled);
        const target = filled.filter(o => o.outcome === 'target').length;
        const stop = filled.filter(o => o.outcome === 'stop').length;
        const open = filled.filter(o => o.outcome === 'open').length;
        const closed = target + stop;
        const pnlPctSum = filled.reduce((s, o) => s + o.pnlPct, 0);
        return {
            zone,
            signals: list.length,
            sharePct: parseFloat(((list.length / withZone.length) * 100).toFixed(1)),
            filled: filled.length,
            target,
            stop,
            open,
            notFilled: list.length - filled.length,
            winRatePct: closed > 0 ? parseFloat(((target / closed) * 100).toFixed(1)) : null,
            avgPnlPct: filled.length ? parseFloat((pnlPctSum / filled.length).toFixed(2)) : null,
        };
    });
    return { total: withZone.length, zones };
}

/** Compat: mesma assinatura de antes, agrupando por `cloudZone`. Ver computeZoneStats. */
function computeCloudZoneStats(occurrences) {
    return computeZoneStats(occurrences, 'cloudZone');
}

/**
 * Distribuição dos sinais pelas 5 faixas do canal Suporte→Resistência escolhido
 * (faixa 1 = colado no suporte de entrada / mais "barato", faixa 5 = colado na resistência de
 * saída / mais "caro") — ver classifySrZone. Mesma forma de computeCloudZoneStats.
 */
function computeSupportResistanceZoneStats(occurrences) {
    return computeZoneStats(occurrences, 'srZone');
}

// ── Suporte/Resistência no instante do sinal (mesmo detectSupportResistance do gráfico) ──────

/**
 * Zonas de S/R válidas no instante do sinal — recalculadas a partir da janela móvel dos últimos
 * `candleCount` candles do intervalo próprio do S/R que JÁ FECHARAM antes de `signalTimeMs`
 * (sem look-ahead: os `rightBars` candles finais da janela nunca viram pivô confirmado, que é o
 * comportamento correto em tempo real). Cache por índice-fim da janela (o S/R só muda quando um
 * candle novo do intervalo do S/R fecha). null se não houver janela completa ainda.
 * Retorna { supports: [desc por preço], resistances: [asc por preço] }.
 */
function resolveSupportResistanceAt(srCandles, signalTimeMs, candleCount, cache) {
    if (!srCandles || srCandles.length < candleCount) return null;
    // Último candle do intervalo do S/R FECHADO antes do sinal (openTime + duração <= signalTime).
    // srCandles vem ascendente; o candle [k] fecha em srCandles[k+1].openTime (ou +duração no fim).
    let endIdx = -1;
    for (let k = srCandles.length - 1; k >= 0; k--) {
        const nextOpen = k + 1 < srCandles.length ? srCandles[k + 1].openTime : Infinity;
        if (nextOpen <= signalTimeMs) { endIdx = k; break; }
    }
    if (endIdx < candleCount - 1) return null;
    if (cache.has(endIdx)) return cache.get(endIdx);
    const window = srCandles.slice(endIdx - candleCount + 1, endIdx + 1).map(c => ({
        openTime: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const levels = detectSupportResistance(window, {});
    const zones = {
        supports: levels.filter(l => l.type === 'support').sort((a, b) => b.price - a.price),
        resistances: levels.filter(l => l.type === 'resistance').sort((a, b) => a.price - b.price),
    };
    cache.set(endIdx, zones);
    return zones;
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
 * Filtro de desconto por S/R: só libera o sinal se o preço estiver no MÁXIMO `maxPct`% ACIMA da
 * linha de suporte escolhida (distância absoluta ao suporte, NÃO % do canal até a resistência —
 * a resistência de saída pode estar longe e tornaria o filtro inútil). Preço abaixo do suporte
 * sempre passa. Sem suporte de referência → não bloqueia (fail-open, igual ao warmup da nuvem D-1).
 */
function checkSupportResistanceFilter(zones, signalPrice, entryRank, exitRank, maxPct) {
    const s = pickSupport(zones, signalPrice, entryRank);
    if (!s) return true;
    return signalPrice <= s.price * (1 + maxPct / 100);
}

// Faixas de distância % do preço do sinal ACIMA da linha de suporte escolhida — pro breakdown
// "Sinais por faixa do canal S/R" (SrZoneChart). Faixa 1 = colado no suporte; faixa 5 = longe.
const SR_DISTANCE_BANDS = [3, 6, 10, 20]; // fronteiras em % acima do suporte

// Limite de desconto ADAPT (entryMaxPct='adapt'): mediana de quão acima do suporte anterior a
// moeda faz um FUNDO MAIS ALTO (pullback de alta) antes de retomar, com clamp [min, max] e default
// se poucos episódios. Mesma filosofia do analyzeAdaptiveDip do amap-bot.
const SR_ADAPTIVE_ENTRY_DEFAULT_PCT = 3;
const SR_ADAPTIVE_ENTRY_MIN_PCT = 2;
const SR_ADAPTIVE_ENTRY_MAX_PCT = 8;

/**
 * "Quando essa moeda faz um fundo mais alto (higher low) apoiada no suporte anterior, quantos %
 * acima do suporte ela costuma fundear antes de virar pra cima?" — os fundos de swing (fractais
 * de 3 candles) do srCandles; pra cada par consecutivo em que o fundo é MAIS ALTO que o anterior
 * (estrutura de alta), mede `(fundo − fundoAnterior) / fundoAnterior * 100`, ignorando outliers
 * (>20%). Mediana, clamp [SR_ADAPTIVE_ENTRY_MIN_PCT, SR_ADAPTIVE_ENTRY_MAX_PCT]; default se < 4
 * episódios (comum em moedas travadas em range, onde "entrar no suporte" quase nunca ocorre).
 */
function computeAdaptiveSupportEntryPct(srCandles) {
    if (!Array.isArray(srCandles) || srCandles.length < 30) return SR_ADAPTIVE_ENTRY_DEFAULT_PCT;
    const lows = detectPivotPointsHighLow(srCandles, { leftBars: 3, rightBars: 3 })
        .filter(p => p.type === 'low')
        .map(p => p.price);
    if (lows.length < 5) return SR_ADAPTIVE_ENTRY_DEFAULT_PCT;
    const dists = [];
    for (let i = 1; i < lows.length; i++) {
        if (!(lows[i] > lows[i - 1]) || lows[i - 1] <= 0) continue; // só fundos mais altos
        const dist = (lows[i] - lows[i - 1]) / lows[i - 1] * 100;
        if (dist > 0 && dist <= 20) dists.push(dist);
    }
    if (dists.length < 4) return SR_ADAPTIVE_ENTRY_DEFAULT_PCT;
    dists.sort((a, b) => a - b);
    const mid = Math.floor(dists.length / 2);
    const median = dists.length % 2 ? dists[mid] : (dists[mid - 1] + dists[mid]) / 2;
    return Math.max(SR_ADAPTIVE_ENTRY_MIN_PCT, Math.min(SR_ADAPTIVE_ENTRY_MAX_PCT, parseFloat(median.toFixed(2))));
}

/**
 * Faixa 1–5 pela distância % do preço do sinal ACIMA da linha de suporte escolhida
 * (1 = ≤3%, 2 = ≤6%, 3 = ≤10%, 4 = ≤20%, 5 = >20% ou abaixo do suporte → faixa 1). null sem
 * suporte de referência.
 */
function classifySrZone(zones, price, entryRank) {
    const s = pickSupport(zones, price, entryRank);
    if (!s) return null;
    const distPct = ((price - s.price) / s.price) * 100;
    if (distPct <= 0) return 1;
    for (let i = 0; i < SR_DISTANCE_BANDS.length; i++) {
        if (distPct <= SR_DISTANCE_BANDS[i]) return i + 1;
    }
    return 5;
}

// Faixas de RSI 1h (REF_RSI_INTERVAL) pro breakdown "RSI 1h × resultado" — mesma ideia do
// volumeBreakdown/cloudZone, só que agrupando pelo RSI de um timeframe MAIOR que o do sinal.
// Faixa 0 = RSI 1h mais BAIXO; faixa 4 = mais ALTO (sobrecompra também no 1h).
const RSI_1H_BANDS = [
    { label: '< 40',   min: -Infinity, max: 40 },
    { label: '40 – 50', min: 40, max: 50 },
    { label: '50 – 60', min: 50, max: 60 },
    { label: '60 – 70', min: 60, max: 70 },
    { label: '≥ 70',   min: 70, max: Infinity },
];

/**
 * Distribuição dos sinais pelas faixas de RSI 1h (RSI_1H_BANDS) no instante do sinal — quantos
 * caíram em cada faixa e, dos preenchidos, alvo/stop, taxa de acerto e P&L médio por faixa.
 * Responde "quantos stops tiveram RSI 1h baixo? quantos alvos tiveram RSI 1h alto?". Conta só os
 * sinais com signalRsi1h numérico (warmup do 1h resolvido). null se nenhum tem valor.
 */
function computeRsi1hBreakdown(occurrences) {
    const withRsi = occurrences.filter(o => Number.isFinite(o.signalRsi1h));
    if (!withRsi.length) return null;
    const bands = RSI_1H_BANDS.map((b, i) => {
        const list = withRsi.filter(o => o.signalRsi1h >= b.min && o.signalRsi1h < b.max);
        const filled = list.filter(o => o.filled);
        const target = filled.filter(o => o.outcome === 'target').length;
        const stop = filled.filter(o => o.outcome === 'stop').length;
        const open = filled.filter(o => o.outcome === 'open').length;
        const closed = target + stop;
        const pnlPctSum = filled.reduce((s, o) => s + o.pnlPct, 0);
        const pnlUsdSum = filled.reduce((s, o) => s + o.pnlUsd, 0);
        return {
            band: i,
            label: b.label,
            signals: list.length,
            sharePct: parseFloat(((list.length / withRsi.length) * 100).toFixed(1)),
            filled: filled.length,
            target,
            stop,
            open,
            notFilled: list.length - filled.length,
            winRatePct: closed > 0 ? parseFloat(((target / closed) * 100).toFixed(1)) : null,
            avgPnlPct: filled.length ? parseFloat((pnlPctSum / filled.length).toFixed(2)) : null,
            totalPnlUsd: parseFloat(pnlUsdSum.toFixed(2)),
        };
    });
    const avgRsi1h = parseFloat((withRsi.reduce((s, o) => s + o.signalRsi1h, 0) / withRsi.length).toFixed(1));
    return { total: withRsi.length, interval: REF_RSI_INTERVAL, avgRsi1h, bands };
}

/**
 * Stop pelo candle de 4h ANTERIOR ao instante do sinal (mesmo critério de "candle anterior" do
 * findCandleIndexAtOrBefore acima, só que em 4h em vez de 1d): se aquele candle fechou em alta, o
 * stop é a abertura dele; se fechou em baixa, o stop é o fechamento. Nos dois casos isso é
 * exatamente Math.min(open, close) — o "fundo do corpo" do candle, não o pavio (low). null se
 * não houver candle de 4h suficiente antes do sinal (início da amostra).
 */
function resolvePrevCandleStopPrice(fourHCandles, signalTimeMs) {
    const curIdx = findCandleIndexAtOrBefore(fourHCandles, signalTimeMs);
    if (curIdx < 1) return null;
    const prev = fourHCandles[curIdx - 1];
    const open = parseFloat(prev.open);
    const close = parseFloat(prev.close);
    if (!(open > 0) || !(close > 0)) return null;
    return close >= open ? open : close;
}

function buildOccurrence(signalCandle, signalPrice, signalRsi, resolved, positionSizeUsd, cloudZone = null, signalRsi1h = null, srZone = null, sr = null) {
    if (!resolved.filled) {
        return {
            signalDate: new Date(signalCandle.openTime).toISOString(),
            signalPrice,
            signalRsi,
            signalRsi1h,
            cloudZone,
            srZone,
            sr,
            filled: false,
            entryDate: null,
            entryPrice: null,
            targetPrice: null,
            stopPrice: null,
            outcome: 'not_filled',
            exitDate: null,
            exitPrice: null,
            pnlPct: null,
            pnlUsd: null,
        };
    }

    const { entryTime, entryPrice, targetPrice, stopPrice, outcome, exitTime, exitPrice } = resolved;
    const pnlPct = parseFloat((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2));
    const pnlUsd = parseFloat((positionSizeUsd * (pnlPct / 100)).toFixed(2));

    return {
        signalDate: new Date(signalCandle.openTime).toISOString(),
        signalPrice,
        signalRsi,
        signalRsi1h,
        cloudZone,
        srZone,
        sr,
        filled: true,
        entryDate: new Date(entryTime ?? signalCandle.openTime).toISOString(),
        entryPrice,
        targetPrice,
        stopPrice,
        outcome,
        exitDate: exitTime != null ? new Date(exitTime).toISOString() : null,
        exitPrice,
        pnlPct,
        pnlUsd,
        stopSteps: resolved.stopSteps ?? 0,
        targetSteps: resolved.targetSteps ?? 0,
        peakGainPct: resolved.peakGainPct ?? null,
    };
}

/** Contagem "base × evoluiu" das saídas: stops que saíram no -startPct% (stopSteps 0, o stop
 *  nunca subiu) vs stops que já tinham subido de degrau; idem pros alvos contínuos. */
function countBaseVsEvolvedExits(filledOccurrences) {
    const stopBase = filledOccurrences.filter(o => o.outcome === 'stop' && (o.stopSteps ?? 0) === 0).length;
    const stopEvolved = filledOccurrences.filter(o => o.outcome === 'stop' && (o.stopSteps ?? 0) > 0).length;
    const targetBase = filledOccurrences.filter(o => o.outcome === 'target' && (o.targetSteps ?? 0) === 0).length;
    const targetEvolved = filledOccurrences.filter(o => o.outcome === 'target' && (o.targetSteps ?? 0) > 0).length;
    return { stopBase, stopEvolved, targetBase, targetEvolved };
}

/**
 * Backtest de momentum por limiar de RSI: entra COMPRADO quando o RSI cruza para cima de
 * `rsiThreshold` (ex.: 70 — o oposto do ciclo clássico de sobrevenda/sobrecompra de
 * analyseRsiOversoldRecovery.js). O SINAL é detectado no `interval` escolhido (ex.: 15m), mas a
 * partir dele o pullback e o bracket alvo/stop são avaliados minuto a minuto (candles de 1m) —
 * mesma granularidade com que o bot Bollinger Bands realmente preenche ordem limite e resolve o
 * OCO (ver resolveFromSignal acima), em vez de só nos fechamentos do candle de 15m. Sinais mais
 * antigos que a janela de 1m disponível (ver MAX_ONE_MINUTE_CANDLES) caem de volta pra resolução
 * no candle do `interval` principal.
 *
 * Cada sinal é avaliado de forma independente (não é uma posição sequencial exclusiva) — mostra
 * o resultado hipotético de CADA cruzamento, mesmo que vários ocorram antes do anterior
 * "fechar", pois o objetivo é medir a taxa de acerto do sinal, não simular uma carteira com uma
 * posição por vez.
 *
 * @param {string} symbol
 * @param {string} interval                    Intervalo do RSI/sinal de entrada (ex.: '15m').
 * @param {object} [options]
 * @param {number} [options.rsiThreshold=70]   RSI cruza para cima deste valor = sinal de entrada.
 * @param {number} [options.pullbackPct=0]     0 = compra no close do candle do sinal. Negativo
 *   (ex.: -2) = só entra se o preço cair esse % abaixo do preço do sinal depois dele (ordem
 *   limite, avaliada minuto a minuto); se nunca cair o suficiente, fica "não preenchido".
 * @param {number} [options.targetPct=5]       Alvo de lucro (%) a partir do preço de entrada.
 * @param {number} [options.stopLossPct=5]     Stop-loss (%) a partir do preço de entrada.
 * @param {number} [options.positionSizeUsd=40] Aporte hipotético (US$) por sinal preenchido.
 * @param {number} [options.candleCount]       Candles buscados no intervalo principal.
 * @param {number} [options.lookbackHours=0]   Restringe os SINAIS às últimas N horas (ex.: 6, 7,
 *   8 — "moedas que atingiram RSI X nas últimas N horas"). 0/undefined = sem restrição, considera
 *   todo o histórico buscado (candleCount). Não afeta o cálculo da largura de banda, que já tem
 *   sua própria janela (bandWidth.lookback).
 * @param {string|null} [options.source]       'gate' ou null (Binance).
 * @param {object} [options.priorRsiFilter]    Mesmo filtro "não é repique" do bot ao vivo (ver
 *   entry.priorRsiFilter em backend/bot/rsi-momentum/strategyEngine.js) — os `count` valores de
 *   RSI anteriores ao cruzamento precisam estar <= threshold. Default bate com o preset estático
 *   (backend/bot/rsi-momentum/strategyPresets.js): o chamador deve passar a config GLOBAL real
 *   (rsi_momentum_global_config) pra estatística ficar fiel ao que o bot realmente exige.
 * @param {boolean} [options.priorRsiFilter.enabled=true]
 * @param {number}  [options.priorRsiFilter.count=3]
 * @param {object} [options.bandWidth]         Filtro opcional de largura de banda (Bollinger).
 * @param {boolean} [options.bandWidth.enabled=false]
 * @param {string}  [options.bandWidth.interval='5m']
 * @param {number}  [options.bandWidth.period=20]
 * @param {number}  [options.bandWidth.stdDev=2]
 * @param {number}  [options.bandWidth.lookback=300]  Candles usados p/ calcular a largura média.
 * @param {number}  [options.bandWidth.minPct=2]      Largura média mínima (%) exigida.
 * @param {object} [options.prevDayCloud]      Filtro opcional pela nuvem D-1 (mesmo indicador do
 *   gráfico — banda entre abertura/fechamento do candle diário NATIVO anterior ao dia do sinal,
 *   ver buildPrevDayCloudSegments em frontend-react/src/components/CandlestickChart.jsx). Exige
 *   que o preço do sinal esteja ATÉ o limite [-∞, lower + maxPct% × (upper-lower)] — não importa
 *   se o dia anterior fechou em alta ou baixa. maxPct=100 (padrão) exige só estar até o topo da
 *   nuvem; valores menores restringem até a parte de baixo dela (ex.: 70% = até o fundo + 70% da
 *   altura da nuvem). Preço ABAIXO da nuvem inteira também libera — desconto ainda maior que a
 *   própria nuvem; só bloqueia sinal com preço ACIMA do limite superior.
 * @param {boolean} [options.prevDayCloud.enabled=false]
 * @param {number}  [options.prevDayCloud.maxPct=100]
 * @param {string}  [options.prevDayCloud.interval='4h']  Mesmo seletor do gráfico (ver
 *   prevDayCloudInterval em CandlestickChart.jsx). Com source='gate' e um interval sem candle
 *   nativo na Gate.io (só 1m/5m/15m/30m/1h/2h/4h/8h/1d), cai pra '1d'.
 * @param {number}  [options.prevDayCloud.candleCount=3]  Quantos candles anteriores (do interval
 *   acima) entram no envelope da nuvem — 1 é só o candle imediatamente anterior; N>1 junta os
 *   últimos N: nuvem = [menor open/close, maior open/close] entre todos eles (mesmo parâmetro do
 *   gráfico, ver buildPrevDayCloudSegments em CandlestickChart.jsx).
 * @param {boolean} [options.prevDayCloud.useHighLow=true]  Aumenta a nuvem: em vez de
 *   abertura/fechamento (corpo do candle), usa máxima/mínima (pavios) dos candles da janela —
 *   faixa mais larga, mesmo parâmetro do gráfico e do bot ao vivo. Padrão máx/mín; passe
 *   explicitamente `false` pra voltar ao corpo (abertura/fechamento).
 * @param {object} [options.supportResistance]  Filtro/alvo por Suporte/Resistência (mesmo
 *   detectSupportResistance de backend/utils/supportResistance.js, usado no gráfico). Independente
 *   da nuvem D-1 — dá pra ligar os dois juntos. As zonas são recalculadas POR SINAL a partir da
 *   janela móvel dos últimos `candleCount` candles do `interval` que fecharam antes do sinal
 *   (sem look-ahead).
 *   ENTRADA (filtro de desconto): só aceita o sinal se o preço estiver no máximo `entryMaxPct`%
 *   ACIMA da linha de suporte escolhida (distância absoluta ao suporte — NÃO % do canal até a
 *   resistência); preço abaixo do suporte também libera; sem suporte de referência não bloqueia
 *   (fail-open).
 *   SAÍDA: o alvo vira a `exitResistanceRank`-ésima resistência acima do preço do sinal, no
 *   lugar do targetPct% fixo (o stop não muda). Sem resistência acima, cai no targetPct/targetMode.
 * @param {boolean} [options.supportResistance.enabled=false]
 * @param {string}  [options.supportResistance.interval='4h']  Mesmo leque do seletor da nuvem D-1.
 * @param {number}  [options.supportResistance.candleCount=200]  Candles da janela móvel do S/R (20–1000).
 * @param {number}  [options.supportResistance.entrySupportRank=1]  1 = 1º suporte abaixo do preço, 2 = 2º, 3 = 3º.
 * @param {number}  [options.supportResistance.exitResistanceRank=1]  1 = 1ª resistência acima do preço, 2 = 2ª, 3 = 3ª.
 * @param {number|'adapt'} [options.supportResistance.entryMaxPct=10]  Distância % máxima do preço do
 *   sinal ACIMA da linha de suporte (1–100). 'adapt' = calcula da história da moeda (mediana de
 *   quão perto do suporte anterior o preço faz fundo antes de virar, clamp 1–8%, default 3) —
 *   ver computeAdaptiveSupportEntryPct. O valor resolvido volta em result.supportResistance.entryMaxPct.
 * @param {number}  [options.minVolumeUsdt=0]  Filtro opcional de volume 24h (mesmo campo do bot
 *   ao vivo, config.volume.minVolumeUsdt — ver marketScanner.js). 0 = desligado. Usa o mesmo
 *   cache de /ticker/24hr da Binance (cachedTicker24hr.js) — sem efeito quando source='gate'
 *   (sem dado de volume 24h da Gate.io integrado aqui). Se o símbolo não atingir o mínimo,
 *   NENHUM sinal entra na simulação (mesmo comportamento "bloqueia o símbolo inteiro" do
 *   bandWidth).
 * @param {boolean} [options.excludeOpenExits=false]  Remove da amostra (tabela E agregados —
 *   P&L, taxa de acerto, contagens) os sinais cujo outcome é "open" (ainda não bateram alvo nem
 *   stop até agora — resultado não realizado/pendente). Com winRatePct já ignorando "open" por
 *   padrão, esse filtro serve pra também limpar a tabela e o P&L médio dessas posições ainda em
 *   aberto.
 * @param {boolean} [options.prevCandleStop=false]  Stop pelo candle de 4h ANTERIOR ao sinal, em
 *   vez do stop fixo (stopLossPct) — ver resolvePrevCandleStopPrice. Candle anterior em alta:
 *   stop = abertura dele. Candle anterior em baixa: stop = fechamento dele (nos dois casos, o
 *   "fundo do corpo" do candle — Math.min(open, close)). O alvo (targetPct) continua em % fixo —
 *   só o stop muda de mecânica. Sempre 4h, fixo (sem intervalo configurável). Sinal sem candle
 *   de 4h suficiente antes dele (início da amostra), ou cujo stop calculado ficaria ACIMA do
 *   preço de entrada (inválido pra uma compra), cai de volta pro stop fixo automaticamente.
 * @param {string} [options.targetMode='fixed']  Modo do ALVO, INDEPENDENTE do stop:
 *   'fixed' = alvo constante em `targetPct`%; 'continuous' = base `targetPct`% subindo em degraus
 *   com o pico (contador próprio `trailingTarget.coinStepPct`), `trailingTarget.stepPct` p.p. por
 *   degrau; 'off' = sem alvo, a posição só sai pelo stop. Sem valor explícito, deriva do
 *   `trailingTarget.enabled` legado e cai em 'fixed'.
 * @param {object} [options.trailingStop]  Stop contínuo — INDEPENDENTE do alvo: sobe em degraus de
 *   `stopStepPct`% a cada `coinStepPct`% de novo topo de preço desde a entrada (ex.: startPct=5,
 *   coinStepPct=1, stopStepPct=1 — moeda subiu 1%: stop de -5% vira -4%; subiu 2%: vira -3%; pode
 *   virar positivo e travar lucro). Os dois degraus são independentes. Ignora `prevCandleStop`.
 * @param {boolean} [options.trailingStop.enabled=false]
 * @param {string}  [options.trailingStop.mode='continuous']  Mecânica do stop contínuo:
 *   'continuous' — rampa linear única ancorada na ENTRADA (params abaixo: startPct/coinStepPct/stopStepPct).
 *   'twoPhase' (Escada Dupla) — ancorada na ENTRADA, DUAS inclinações: fase A agressiva
 *     (aStopStepPct/aCoinStepPct) até o stop travar `pivotPct`% de lucro; depois fase B suave
 *     (bStopStepPct/bCoinStepPct), contada a partir do pivô.
 *   'peakTrail' (Trilha do Topo) — ancorada no PICO: stop a `wNearPct`% abaixo do topo enquanto o
 *     ganho do pico < `pivotGainPct`%, e a `wFarPct`% abaixo depois (Chandelier de % em 2 fases).
 *   'atrTrail' (Trilha ATR) — como peakTrail, mas largura da fase B = `atrMult` × ATR% (ATR de
 *     Wilder período 14, no intervalo do sinal), limitada a `atrMaxPct`%. Fase A = `wNearPct`% fixo.
 *   Todos os modos são MONOTÔNICOS (o stop nunca desce). Ignora `prevCandleStop`.
 * @param {number}  [options.trailingStop.startPct=stopLossPct]  Distância inicial do stop (%). Piso de todos os modos.
 * @param {number}  [options.trailingStop.coinStepPct=1]  ['continuous'] Cada quantos % de alta o stop sobe um degrau.
 * @param {number}  [options.trailingStop.stopStepPct=1]  ['continuous'] Quantos p.p. o stop sobe a cada degrau.
 * @param {number}  [options.trailingStop.pivotPct=1]  ['twoPhase'] LUCRO travado (%) no fim da fase A (0 = breakeven, positivo = já no lucro).
 * @param {number}  [options.trailingStop.aCoinStepPct=3] [options.trailingStop.aStopStepPct=2.5]  ['twoPhase'] Degrau da fase A.
 * @param {number}  [options.trailingStop.bCoinStepPct=3] [options.trailingStop.bStopStepPct=1]  ['twoPhase'] Degrau da fase B.
 * @param {number}  [options.trailingStop.pivotGainPct=5]  ['peakTrail'/'atrTrail'] Ganho do pico (%) que troca de fase.
 * @param {number}  [options.trailingStop.wNearPct=4]  ['peakTrail'/'atrTrail'] Largura da fase A (% abaixo do pico).
 * @param {number}  [options.trailingStop.wFarPct=9]  ['peakTrail'] Largura da fase B (% abaixo do pico).
 * @param {number}  [options.trailingStop.atrMult=2] [options.trailingStop.atrMaxPct=12]  ['atrTrail'] Fase B = min(atrMaxPct, atrMult×ATR%).
 * @param {object} [options.trailingTarget]  Degraus do alvo contínuo (targetMode='continuous') —
 *   contador PRÓPRIO, independente do stop. Um alvo que sobe mais rápido do que o preço acaba
 *   nunca preenchendo, e a posição sai pelo stop — ver resolveFromSignal.
 * @param {number}  [options.trailingTarget.coinStepPct=3]  Cada quantos % de alta do pico o alvo sobe um degrau.
 * @param {number}  [options.trailingTarget.stepPct=3]  Quantos p.p. o alvo sobe a cada degrau.
 * @param {object} [options.adxFilter]  Filtro de força de tendência (ADX de Wilder, período fixo
 *   14) — só permite o sinal se o ADX, no intervalo escolhido, estiver NA OU ACIMA do mínimo
 *   exigido no instante do sinal. Mercado em range (ADX baixo) costuma gerar cruzamentos de RSI
 *   fracos que revertem contra a posição; exigir ADX alto filtra pra sinais que ocorrem dentro de
 *   uma tendência real. Sem valor de ADX disponível ainda (warmup), NÃO bloqueia (fail-open).
 * @param {boolean} [options.adxFilter.enabled=false]
 * @param {string}  [options.adxFilter.interval='1h']
 * @param {number}  [options.adxFilter.minAdx=25]
 * @param {object} [options.macdFilter]  Confirmação de momentum por MACD (12/26/9 padrão) — só
 *   permite o sinal se o histograma do MACD (MACD − linha de sinal), no intervalo escolhido,
 *   estiver POSITIVO no instante do sinal (mesmo que MACD > linha de sinal). Segunda confirmação
 *   independente do RSI, pontual (no candle do sinal) — reduz repiques onde o RSI cruzou mas o
 *   momentum de fundo ainda não virou. Sem valor de MACD disponível ainda (warmup), NÃO bloqueia.
 * @param {boolean} [options.macdFilter.enabled=false]
 * @param {string}  [options.macdFilter.interval='1h']
 * @param {object} [options.higherRsiFilter]  Confirmação multi-timeframe pelo RSI de 1h (fixo, o
 *   mesmo REF_RSI_INTERVAL da coluna "RSI 1h") — só permite o sinal se o RSI de 1h vigente no
 *   instante do sinal estiver NA OU ACIMA de `minRsi`. O gatilho de entrada é de um intervalo
 *   menor (ex.: 15m); este filtro evita comprar o rompimento enquanto o timeframe maior ainda
 *   está fraco. Base: Elder Triple Screen (tendência no TF maior antes da entrada no menor),
 *   linha 50 do RSI como filtro de regime, "range rules" de Brown/Cardwell (em alta o RSI fica
 *   na faixa ~40-90; abaixo de 50 = ainda em faixa de baixa). Sem RSI 1h ainda (warmup), NÃO
 *   bloqueia (fail-open, igual ADX/MACD).
 * @param {boolean} [options.higherRsiFilter.enabled=false]
 * @param {number}  [options.higherRsiFilter.minRsi=50]  RSI 1h mínimo exigido no instante do sinal.
 * @param {object} [options.rsi5mFilter]  Mesmo entry.rsi5mFilter do bot ao vivo (ver checkRsi5mFilter
 *   em backend/bot/rsi-momentum/strategyEngine.js): exige RSI(14) do candle de 5m fechado no
 *   FECHAMENTO do candle do sinal > `threshold`. Vem da config GLOBAL do bot (igual priorRsiFilter),
 *   não tem toggle nas Estatísticas. Fail-open no warmup.
 * @param {boolean} [options.rsi5mFilter.enabled=false]
 * @param {number}  [options.rsi5mFilter.threshold=70]  RSI 5m mínimo (50–95).
 * @param {object} [options.newHighFilter]  Filtro "não comprar esticado" (só backtest/Estatísticas):
 *   recusa o sinal se `signalPrice >= max(high dos `lookback` candles ANTERIORES ao candle do sinal)
 *   × (1 − `marginPct`/100)`. Pega compras perto/acima do topo recente sem estrutura acima.
 * @param {boolean} [options.newHighFilter.enabled=false]
 * @param {number}  [options.newHighFilter.lookback=20]  Quantos candles do intervalo do sinal (3–300).
 * @param {number}  [options.newHighFilter.marginPct=2]  Folga % abaixo da máxima (0–20). 0 = só bloqueia acima do topo.
 * @param {object} [options.entriesDayRange]  Faixa opcional de entradas/dia pro card extra em
 *   dailyEntryStats.entriesRangeDaysPct (ver computeDailyEntryStats em dailyEntryStats.js) — ex.:
 *   {min:2, max:3} = "% de dias com 2 a 3 entradas". Sem isso, só multiEntryDaysPct (>=2, sem
 *   teto) é calculado.
 * @param {number} [options.entriesDayRange.min=2]
 * @param {number|null} [options.entriesDayRange.max=null]
 */
async function analyseRsiThresholdBacktest(symbol, interval, options = {}) {
    const {
        rsiThreshold   = 70,
        pullbackPct    = 0,
        targetPct      = 5,
        stopLossPct    = 5,
        positionSizeUsd = 40,
        candleCount,
        lookbackHours   = 0,
        source          = null,
        priorRsiFilter  = null,
        bandWidth       = null,
        prevDayCloud    = null,
        supportResistance = null,
        minVolumeUsdt   = 0,
        excludeOpenExits = false,
        prevCandleStop  = false,
        adxFilter       = null,
        macdFilter      = null,
        higherRsiFilter = null,
        rsi5mFilter     = null,
        newHighFilter   = null,
        trailingStop    = null,
        trailingTarget  = null,
        targetMode      = null,
        hardTakeProfit  = null,
        entriesDayRange = null,
    } = options;

    // Teto de lucro (venda forçada em +pct%) — mesmo do bot (exit.hardTakeProfit). 0/null = off.
    const hardTakeProfitPct = hardTakeProfit?.enabled
        ? Math.max(1, Math.min(200, Number(hardTakeProfit.pct ?? 15)))
        : 0;

    const trailingStopEnabled = !!trailingStop?.enabled;
    const trailingStopMode = ['continuous', 'twoPhase', 'peakTrail', 'atrTrail'].includes(trailingStop?.mode)
        ? trailingStop.mode : 'continuous';
    const trailingStopStartPct = Math.max(0.5, Math.min(50, Number(trailingStop?.startPct ?? stopLossPct)));
    const trailingStopCoinStepPct = Math.max(0.1, Math.min(20, Number(trailingStop?.coinStepPct ?? 1)));
    const trailingStopStopStepPct = Math.max(0.1, Math.min(20, Number(trailingStop?.stopStepPct ?? 1)));
    // Params dos modos novos do stop contínuo (twoPhase / peakTrail / atrTrail) — ver
    // trailingStopCandidate em resolveFromSignal. Clamp aqui, uma vez.
    const tsPivotPct       = Math.max(-5, Math.min(20, Number(trailingStop?.pivotPct ?? 1)));
    const tsPhaseACoinStep = Math.max(0.1, Math.min(20, Number(trailingStop?.aCoinStepPct ?? 3)));
    const tsPhaseAStopStep = Math.max(0.1, Math.min(20, Number(trailingStop?.aStopStepPct ?? 2.5)));
    const tsPhaseBCoinStep = Math.max(0.1, Math.min(20, Number(trailingStop?.bCoinStepPct ?? 3)));
    const tsPhaseBStopStep = Math.max(0.1, Math.min(20, Number(trailingStop?.bStopStepPct ?? 1)));
    const tsPivotGainPct   = Math.max(0.1, Math.min(50, Number(trailingStop?.pivotGainPct ?? 5)));
    const tsWNearPct       = Math.max(0.1, Math.min(50, Number(trailingStop?.wNearPct ?? 4)));
    const tsWFarPct        = Math.max(0.1, Math.min(50, Number(trailingStop?.wFarPct ?? 9)));
    const tsAtrMult        = Math.max(0.1, Math.min(10, Number(trailingStop?.atrMult ?? 2)));
    const tsAtrMaxPct      = Math.max(0.5, Math.min(50, Number(trailingStop?.atrMaxPct ?? 12)));
    const trailingStopNeedsAtr = trailingStopEnabled && trailingStopMode === 'atrTrail';
    // Modo do alvo — INDEPENDENTE do stop. Sem targetMode explícito, deriva do trailingTarget
    // legado (compat) e cai em 'fixed'.
    const targetModeResolved = (targetMode === 'fixed' || targetMode === 'continuous' || targetMode === 'off')
        ? targetMode
        : (trailingTarget?.enabled ? 'continuous' : 'fixed');
    // Alvo contínuo tem contador PRÓPRIO (independente do stop).
    const trailingTargetCoinStepPct = Math.max(0.1, Math.min(20, Number(trailingTarget?.coinStepPct ?? 3)));
    const trailingTargetStepPct = Math.max(0.1, Math.min(50, Number(trailingTarget?.stepPct ?? 3)));

    const pcsEnabled = !!prevCandleStop;
    const adxEnabled = !!adxFilter?.enabled;
    const adxInterval = adxFilter?.interval ?? '1h';
    const adxMinAdx  = Math.max(1, Number(adxFilter?.minAdx ?? 25));
    const macdEnabled = !!macdFilter?.enabled;
    const macdInterval = macdFilter?.interval ?? '1h';
    // Filtro de confirmação pelo RSI de 1h (mesmo REF_RSI_INTERVAL da coluna informativa) — ver
    // JSDoc de options.higherRsiFilter. minRsi entre 1 e 99.
    const higherRsiEnabled = !!higherRsiFilter?.enabled;
    const higherRsiMin = Math.max(1, Math.min(99, Number(higherRsiFilter?.minRsi ?? 50)));

    // Filtro RSI 5m (mesmo entry.rsi5mFilter do bot ao vivo — ver checkRsi5mFilter em
    // backend/bot/rsi-momentum/strategyEngine.js): exige RSI(14) do candle de 5m fechado no
    // fechamento do candle do sinal > threshold. Aqui vem da config GLOBAL do bot (igual ao
    // priorRsiFilter), sem toggle nas Estatísticas.
    const rsi5mEnabled = !!rsi5mFilter?.enabled;
    const rsi5mThreshold = Math.max(50, Math.min(95, Number(rsi5mFilter?.threshold ?? 70)));

    // Filtro "topo dos últimos N" (só backtest/Estatísticas por enquanto): recusa o sinal se o
    // preço estiver a menos de nhMarginPct% da máxima dos nhLookback candles ANTERIORES ao candle
    // do sinal (no intervalo do sinal). Pega compras esticadas / rompimento de topo sem estrutura.
    const nhEnabled = !!newHighFilter?.enabled;
    const nhLookback = Math.max(3, Math.min(300, Math.round(Number(newHighFilter?.lookback ?? 20))));
    const nhMarginPct = Math.max(0, Math.min(20, Number(newHighFilter?.marginPct ?? 2)));

    const priorRsiCount = priorRsiFilter?.enabled === false
        ? 0
        : Math.max(1, Math.round(Number(priorRsiFilter?.count ?? 3)));

    const signalCutoffMs = lookbackHours > 0 ? Date.now() - lookbackHours * 60 * 60 * 1000 : 0;

    const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
    const mainLimit = candleCount ?? DEFAULT_CANDLE_COUNT;

    const bwEnabled = !!bandWidth?.enabled;
    const bwInterval = bandWidth?.interval ?? '5m';
    const bwPeriod   = bandWidth?.period ?? BB_PERIOD;
    const bwStdDev   = bandWidth?.stdDev ?? BB_STDDEV;
    const bwLookback = bandWidth?.lookback ?? 300;
    const bwMinPct   = bandWidth?.minPct ?? 2;

    const pdcEnabled = !!prevDayCloud?.enabled;
    const pdcMaxPct  = Math.max(1, Math.min(100, Number(prevDayCloud?.maxPct ?? 100)));
    const pdcRequestedInterval = PREV_DAY_CLOUD_INTERVALS.includes(prevDayCloud?.interval) ? prevDayCloud.interval : '4h';
    // Nem todo intervalo tem candle nativo na Gate.io (ver CLAUDE.md) — com source='gate' e um
    // interval fora de GATE_PREV_DAY_CLOUD_INTERVALS, cai pra '1d'.
    const pdcInterval = (source === 'gate' && !GATE_PREV_DAY_CLOUD_INTERVALS.includes(pdcRequestedInterval))
        ? '1d'
        : pdcRequestedInterval;
    // Quantos candles (do pdcInterval) entram no envelope da nuvem — 1 (padrão) é só o candle
    // anterior, ver resolvePrevDayCloud/checkPrevDayCloudFilter.
    const pdcCandleCount = Math.max(1, Math.min(10, Math.round(Number(prevDayCloud?.candleCount ?? 3))));
    // Aumenta a nuvem: máxima/mínima (pavios) em vez de abertura/fechamento (corpo) — ver
    // resolvePrevDayCloud e buildPrevDayCloudSegments no frontend. Padrão máx/mín; só `false`
    // explícito volta pro corpo.
    const pdcUseHighLow = prevDayCloud?.useHighLow !== false;
    // ── Suporte/Resistência (mesmo detectSupportResistance do gráfico) ──────────────────────
    const srEnabled = !!supportResistance?.enabled;
    const srRequestedInterval = PREV_DAY_CLOUD_INTERVALS.includes(supportResistance?.interval)
        ? supportResistance.interval : '4h';
    const srInterval = (source === 'gate' && !GATE_PREV_DAY_CLOUD_INTERVALS.includes(srRequestedInterval))
        ? '1d' : srRequestedInterval;
    const srCandleCount = Math.max(20, Math.min(1000, Math.round(Number(supportResistance?.candleCount ?? 200))));
    const srEntryRank = Math.max(1, Math.min(3, Math.round(Number(supportResistance?.entrySupportRank ?? 1))));
    const srExitRank = Math.max(1, Math.min(3, Math.round(Number(supportResistance?.exitResistanceRank ?? 1))));
    // 'adapt' = calcula o limite da história da moeda (ver computeAdaptiveSupportEntryPct, aplicado
    // depois de buscar srCandles). Senão, % fixo entre 1 e 100.
    const srEntryMaxPctAdaptive = supportResistance?.entryMaxPct === 'adapt';
    let srEntryMaxPct = srEntryMaxPctAdaptive
        ? SR_ADAPTIVE_ENTRY_DEFAULT_PCT
        : Math.max(1, Math.min(100, Number(supportResistance?.entryMaxPct ?? 10)));
    // Candles do intervalo do S/R a buscar: a janela móvel (srCandleCount) precisa caber ANTES do
    // sinal mais antigo da amostra + a própria janela do intervalo principal. Mesma conta do
    // pdcDayLimit, só que a "folga" é a janela inteira do S/R.
    const srFetchLimit = srEnabled
        ? Math.min(3000, srCandleCount + Math.ceil(
            (mainLimit * (interval === '1m' ? 60_000 : intervalMs(interval))) / intervalMs(srInterval),
        ) + 5)
        : 0;

    // Dias/períodos cobertos pelo intervalo principal (mainLimit candles) + folga de
    // pdcCandleCount+3, pro sinal mais antigo da amostra também ter uma janela completa de
    // candles anteriores pra servir de referência — mesma conta de computePrevDayCloudFetchLimit
    // no frontend.
    const pdcDayLimit = Math.min(500, Math.max(10,
        Math.ceil((mainLimit * (interval === '1m' ? 60_000 : intervalMs(interval))) / intervalMs(pdcInterval)) + pdcCandleCount + 3,
    ));

    // Candles de 4h cobertos pela janela do intervalo principal + folga de 3 candles (o candle
    // 4h anterior ao sinal mais antigo da amostra também precisa de referência) — mesma conta do
    // pdcDayLimit acima, só que em 4h em vez de 1d.
    const pcsFourHLimit = Math.min(2000, Math.max(10,
        Math.ceil((mainLimit * (interval === '1m' ? 60_000 : intervalMs(interval))) / intervalMs('4h')) + 3,
    ));

    const volEnabled = Number(minVolumeUsdt) > 0 && source !== 'gate';

    const adxLimit = adxEnabled
        ? computeOwnIntervalFetchLimit(interval, mainLimit, adxInterval, ADX_WARMUP_BARS)
        : 0;
    const macdLimit = macdEnabled
        ? computeOwnIntervalFetchLimit(interval, mainLimit, macdInterval, MACD_WARMUP_BARS)
        : 0;

    // RSI 1h de referência (informativo, ver REF_RSI_INTERVAL) — só busca candles próprios quando
    // o intervalo do sinal não é já 1h.
    const refRsiNeedsFetch = interval !== REF_RSI_INTERVAL;
    const refRsiLimit = refRsiNeedsFetch
        ? computeOwnIntervalFetchLimit(interval, mainLimit, REF_RSI_INTERVAL, RSI_WARMUP_BARS)
        : 0;

    // RSI 5m do filtro entry.rsi5mFilter — com o sinal já em 5m, é a própria série principal.
    const rsi5mNeedsFetch = rsi5mEnabled && interval !== '5m';
    const rsi5mLimit = rsi5mNeedsFetch
        ? computeOwnIntervalFetchLimit(interval, mainLimit, '5m', RSI_WARMUP_BARS)
        : 0;

    const settled = await Promise.allSettled([
        fetchCandles(symbol, interval, mainLimit),
        bwEnabled
            ? fetchCandles(symbol, bwInterval, bwLookback + bwPeriod + BB_MIN_CANDLES_PADDING)
            : Promise.resolve(null),
        pdcEnabled
            ? fetchCandles(symbol, pdcInterval, pdcDayLimit)
            : Promise.resolve(null),
        volEnabled ? getTickers() : Promise.resolve(null),
        pcsEnabled
            ? fetchCandles(symbol, '4h', pcsFourHLimit)
            : Promise.resolve(null),
        adxEnabled
            ? fetchCandles(symbol, adxInterval, adxLimit)
            : Promise.resolve(null),
        macdEnabled
            ? fetchCandles(symbol, macdInterval, macdLimit)
            : Promise.resolve(null),
        refRsiNeedsFetch
            ? fetchCandles(symbol, REF_RSI_INTERVAL, refRsiLimit)
            : Promise.resolve(null),
        srEnabled
            ? fetchCandles(symbol, srInterval, srFetchLimit)
            : Promise.resolve(null),
        rsi5mNeedsFetch
            ? fetchCandles(symbol, '5m', rsi5mLimit)
            : Promise.resolve(null),
    ]);

    const [candlesResult, bwCandlesResult, pdcCandlesResult, tickersResult, pcsCandlesResult, adxCandlesResult, macdCandlesResult, refRsiCandlesResult, srCandlesResult, rsi5mCandlesResult] = settled;
    if (candlesResult.status === 'rejected') throw candlesResult.reason;
    const candles = candlesResult.value;

    const dailyCandles = pdcEnabled && pdcCandlesResult.status === 'fulfilled' && pdcCandlesResult.value
        ? pdcCandlesResult.value
        : [];

    const fourHCandles = pcsEnabled && pcsCandlesResult.status === 'fulfilled' && pcsCandlesResult.value
        ? pcsCandlesResult.value
        : [];

    const srCandles = srEnabled && srCandlesResult.status === 'fulfilled' && srCandlesResult.value
        ? srCandlesResult.value
        : [];
    // entryMaxPct='adapt' → resolve o limite da história da moeda agora que temos srCandles.
    if (srEntryMaxPctAdaptive && srCandles.length) {
        srEntryMaxPct = computeAdaptiveSupportEntryPct(srCandles);
    }
    // Cache das zonas de S/R por índice-fim da janela móvel (o S/R só muda quando um candle novo
    // do srInterval fecha) — ver resolveSupportResistanceAt.
    const srZonesCache = new Map();
    let srBlocked = 0; // sinais cortados pelo filtro de desconto do S/R (só conta com ele ligado)

    // ADX (força de tendência) — calculado no intervalo PRÓPRIO escolhido (adxInterval), não no
    // intervalo do sinal: geralmente faz sentido olhar a tendência num timeframe maior que o do
    // gatilho de RSI (ex.: RSI em 15m, ADX em 1h).
    const adxCandles = adxEnabled && adxCandlesResult.status === 'fulfilled' && adxCandlesResult.value
        ? adxCandlesResult.value
        : [];
    let adxSeries = [];
    let adxOffset = 0;
    if (adxCandles.length) {
        const highs = adxCandles.map(c => parseFloat(c.high));
        const lows = adxCandles.map(c => parseFloat(c.low));
        const closesAdx = adxCandles.map(c => parseFloat(c.close));
        adxSeries = ADX.calculate({ high: highs, low: lows, close: closesAdx, period: ADX_PERIOD });
        adxOffset = adxCandles.length - adxSeries.length;
    }

    // MACD (confirmação de momentum) — mesma ideia, intervalo próprio (macdInterval).
    const macdCandles = macdEnabled && macdCandlesResult.status === 'fulfilled' && macdCandlesResult.value
        ? macdCandlesResult.value
        : [];
    let macdSeries = [];
    let macdOffset = 0;
    if (macdCandles.length) {
        const closesMacd = macdCandles.map(c => parseFloat(c.close));
        macdSeries = MACD.calculate({
            values: closesMacd,
            fastPeriod: MACD_FAST_PERIOD,
            slowPeriod: MACD_SLOW_PERIOD,
            signalPeriod: MACD_SIGNAL_PERIOD,
            SimpleMAOscillator: false,
            SimpleMASignal: false,
        });
        macdOffset = macdCandles.length - macdSeries.length;
    }

    // Volume 24h: mesmo campo/fonte do filtro do bot ao vivo (marketScanner.js) — falha ao
    // buscar o ticker não bloqueia o backtest (fail-open), só desativa o filtro nesta chamada.
    let volumeResult = null;
    if (volEnabled) {
        let quoteVolume = null;
        if (tickersResult.status === 'fulfilled' && Array.isArray(tickersResult.value)) {
            const t = tickersResult.value.find((x) => x.symbol === symbol);
            quoteVolume = t ? Number(t.quoteVolume) : null;
        }
        volumeResult = {
            minVolumeUsdt: Number(minVolumeUsdt),
            quoteVolume,
            passed: quoteVolume != null && quoteVolume >= Number(minVolumeUsdt),
        };
    }
    const volumeBlocksEntries = volEnabled && !volumeResult.passed;

    // Largura de banda: mesmo motor do filtro de mercado "Larg%" (ver
    // backend/services/fetchBollingerBandWidthFilter.js) — % médio de valorização de cada
    // ciclo fundo→topo, sem outliers. É uma propriedade única da moeda no período: se não
    // passar no mínimo exigido, NENHUM sinal desse símbolo entra na simulação.
    let bandWidthResult = null;
    if (bwEnabled) {
        let avgWidthPct = null;
        if (bwCandlesResult.status === 'fulfilled' && bwCandlesResult.value) {
            const closed = closedCandlesOnly(bwCandlesResult.value);
            const occurrences = bollingerCycleOccurrences(closed, { period: bwPeriod, stdDev: bwStdDev });
            if (occurrences?.length) {
                avgWidthPct = Math.round(averageWithoutOutliers(occurrences) * 100) / 100;
            }
        }
        bandWidthResult = {
            interval: bwInterval,
            period: bwPeriod,
            stdDev: bwStdDev,
            lookback: bwLookback,
            minPct: bwMinPct,
            avgWidthPct,
            passed: avgWidthPct != null && avgWidthPct >= bwMinPct,
        };
    }

    const bandWidthBlocksEntries = bwEnabled && !bandWidthResult.passed;

    const closes = candles.map(c => parseFloat(c.close));
    const rsiValues = RSI.calculate({ values: closes, period: RSI_PERIOD });
    const offset = RSI_PERIOD;

    // ATR de Wilder no PRÓPRIO intervalo do sinal — só pro stop contínuo modo 'atrTrail'.
    // atrSeries[k] corresponde a candles[k + atrOffset]; resolvido por sinal via atrPct abaixo.
    let atrSeries = [];
    let atrOffset = 0;
    if (trailingStopNeedsAtr) {
        atrSeries = ATR.calculate({
            high: candles.map(c => parseFloat(c.high)),
            low: candles.map(c => parseFloat(c.low)),
            close: closes,
            period: ATR_PERIOD,
        });
        atrOffset = candles.length - atrSeries.length;
    }

    // RSI 1h de referência (informativo — ver REF_RSI_INTERVAL): série calculada no intervalo
    // próprio, resolvida no instante de cada sinal por resolveOwnIntervalValueAt (mesmo padrão de
    // ADX/MACD). Com o sinal já em 1h, é a própria série principal.
    let refRsiCandles = [];
    let refRsiSeries = [];
    let refRsiOffset = 0;
    if (!refRsiNeedsFetch) {
        refRsiCandles = candles;
        refRsiSeries = rsiValues;
        refRsiOffset = offset;
    } else if (refRsiCandlesResult.status === 'fulfilled' && refRsiCandlesResult.value?.length) {
        refRsiCandles = refRsiCandlesResult.value;
        refRsiSeries = RSI.calculate({ values: refRsiCandles.map(c => parseFloat(c.close)), period: RSI_PERIOD });
        refRsiOffset = refRsiCandles.length - refRsiSeries.length;
    }

    // RSI 5m do filtro entry.rsi5mFilter — mesmo padrão do refRsi acima.
    let rsi5mCandles = [];
    let rsi5mSeries = [];
    let rsi5mOffset = 0;
    if (rsi5mEnabled && !rsi5mNeedsFetch) {
        rsi5mCandles = candles;
        rsi5mSeries = rsiValues;
        rsi5mOffset = offset;
    } else if (rsi5mNeedsFetch && rsi5mCandlesResult.status === 'fulfilled' && rsi5mCandlesResult.value?.length) {
        rsi5mCandles = rsi5mCandlesResult.value;
        rsi5mSeries = RSI.calculate({ values: rsi5mCandles.map(c => parseFloat(c.close)), period: RSI_PERIOD });
        rsi5mOffset = rsi5mCandles.length - rsi5mSeries.length;
    }

    // Fase 1 — detecta os cruzamentos de RSI no candle do `interval` principal (o "pensamento"
    // continua em 15m/etc.), sem resolver ainda pullback/saída.
    const rawSignals = [];
    let higherRsiBlocked = 0; // sinais cortados pelo filtro de RSI 1h (só conta com ele ligado)
    let rsi5mBlocked = 0;     // sinais cortados pelo filtro de RSI 5m (só conta com ele ligado)
    let newHighBlocked = 0;   // sinais cortados pelo filtro "topo dos últimos N" (só conta com ele ligado)
    const minI = Math.max(1, priorRsiCount);
    if (!bandWidthBlocksEntries && !volumeBlocksEntries) {
        for (let i = minI; i < rsiValues.length; i++) {
            if (rsiValues[i - 1] >= rsiThreshold || rsiValues[i] < rsiThreshold) continue;
            // Mesmo filtro de "não é repique de volatilidade" do bot ao vivo (ver
            // evaluateEntrySignal em backend/bot/rsi-momentum/strategyEngine.js, entry.priorRsiFilter):
            // os `priorRsiCount` valores de RSI anteriores ao cruzamento também precisam estar
            // <= threshold (rsiValues[i-1] já garantido pela checagem do cruzamento acima).
            let priorRsiBlocked = false;
            for (let k = 2; k <= priorRsiCount; k++) {
                if (rsiValues[i - k] > rsiThreshold) { priorRsiBlocked = true; break; }
            }
            if (priorRsiBlocked) continue;

            const idx = i + offset;
            const signalCandle = candles[idx];
            if (signalCandle.openTime < signalCutoffMs) continue;

            const signalPrice = parseFloat(signalCandle.close);
            if (pdcEnabled && !checkPrevDayCloudFilter(dailyCandles, signalCandle.openTime, signalPrice, pdcMaxPct, pdcCandleCount, pdcUseHighLow)) continue;

            // Faixa vertical (1 = base, 5 = topo) da nuvem D-1 onde o preço do sinal cai — só faz
            // sentido com o filtro da nuvem ligado (dailyCandles buscado). Ver classifyCloudZone /
            // computeCloudZoneStats e o gráfico "Sinais por faixa da nuvem D-1" no frontend.
            const cloudZone = pdcEnabled
                ? classifyCloudZone(
                    resolvePrevDayCloud(dailyCandles, signalCandle.openTime, pdcCandleCount, pdcUseHighLow),
                    signalPrice,
                )
                : null;

            // ADX: só passa com tendência confirmada (>= mínimo) no instante do sinal. Sem valor
            // disponível ainda (warmup do indicador), não bloqueia.
            if (adxEnabled) {
                const adxValue = resolveOwnIntervalValueAt(adxCandles, adxSeries, adxOffset, signalCandle.openTime, (e) => e.adx);
                if (adxValue != null && adxValue < adxMinAdx) continue;
            }

            // MACD: só passa com histograma positivo (MACD > linha de sinal) no instante do
            // sinal. Sem valor disponível ainda (warmup), não bloqueia.
            if (macdEnabled) {
                const macdHist = resolveOwnIntervalValueAt(macdCandles, macdSeries, macdOffset, signalCandle.openTime, (e) => e.histogram);
                if (macdHist != null && macdHist <= 0) continue;
            }

            // RSI 1h vigente no instante do sinal — informativo (coluna "RSI 1h" / gráfico de
            // faixas) E base do filtro higherRsiFilter. null enquanto não há candle 1h suficiente
            // antes do sinal (início da amostra / warmup).
            const rsi1hAtSignal = resolveOwnIntervalValueAt(refRsiCandles, refRsiSeries, refRsiOffset, signalCandle.openTime, (v) => v);

            // Confirmação multi-timeframe: só entra se o RSI 1h >= o mínimo. Fail-open no warmup
            // (rsi1hAtSignal == null), igual ADX/MACD. Ver JSDoc de options.higherRsiFilter.
            if (higherRsiEnabled && rsi1hAtSignal != null && rsi1hAtSignal < higherRsiMin) {
                higherRsiBlocked++;
                continue;
            }

            // Filtro RSI 5m (config global do bot): RSI(14) do candle de 5m fechado no FECHAMENTO
            // do candle do sinal precisa estar > threshold. Resolve em openTime + duração do candle
            // do sinal − 1ms (o 5m que fecha junto com o candle do sinal). Fail-open no warmup.
            if (rsi5mEnabled) {
                const rsi5mAtSignal = resolveOwnIntervalValueAt(
                    rsi5mCandles, rsi5mSeries, rsi5mOffset,
                    signalCandle.openTime + (interval === '1m' ? 60_000 : intervalMs(interval)) - 1,
                    (v) => v,
                );
                if (rsi5mAtSignal != null && rsi5mAtSignal <= rsi5mThreshold) {
                    rsi5mBlocked++;
                    continue;
                }
            }

            // Filtro "topo dos últimos N": recusa se o preço do sinal está a menos de nhMarginPct%
            // da máxima dos nhLookback candles ANTERIORES ao candle do sinal (não comprar esticado).
            if (nhEnabled) {
                let maxHigh = 0;
                for (let j = Math.max(0, idx - nhLookback); j < idx; j++) {
                    const h = parseFloat(candles[j].high);
                    if (h > maxHigh) maxHigh = h;
                }
                if (maxHigh > 0 && signalPrice >= maxHigh * (1 - nhMarginPct / 100)) {
                    newHighBlocked++;
                    continue;
                }
            }

            const stopPriceOverride = pcsEnabled
                ? resolvePrevCandleStopPrice(fourHCandles, signalCandle.openTime)
                : null;

            // Suporte/Resistência vigente no instante do sinal (mesmo detectSupportResistance do
            // gráfico, janela móvel srCandleCount, sem look-ahead). Filtro de desconto: só entra
            // se o preço estiver na parte baixa do canal [suporte escolhido → resistência
            // escolhida]. Alvo (srTargetPrice) = a resistência escolhida acima do preço do sinal.
            let srZone = null;
            let srTargetPrice = null;
            let srLines = null;
            if (srEnabled) {
                const zones = resolveSupportResistanceAt(srCandles, signalCandle.openTime, srCandleCount, srZonesCache);
                if (zones && !checkSupportResistanceFilter(zones, signalPrice, srEntryRank, srExitRank, srEntryMaxPct)) {
                    srBlocked++;
                    continue;
                }
                if (zones) {
                    srZone = classifySrZone(zones, signalPrice, srEntryRank);
                    const chosenR = pickResistance(zones, signalPrice, srExitRank);
                    srTargetPrice = chosenR?.price ?? null;
                    // Níveis EXATOS que o backtest usou nesse sinal — o gráfico desenha esses
                    // verbatim ao abrir o trade (ver chartSrOverride), pra o gráfico e o trade
                    // serem a mesma coisa. leftBars/rightBars = defaults do detectSupportResistance.
                    srLines = {
                        interval: srInterval,
                        candleCount: srCandleCount,
                        levels: [...zones.supports, ...zones.resistances].map((l) => ({
                            price: l.price, touches: l.touches, type: l.type,
                        })),
                        entrySupport: pickSupport(zones, signalPrice, srEntryRank)?.price ?? null,
                        exitResistance: srTargetPrice,
                    };
                }
            }

            rawSignals.push({
                signalCandle,
                signalPrice,
                signalRsi: parseFloat(rsiValues[i].toFixed(2)),
                signalRsi1h: rsi1hAtSignal != null ? parseFloat(rsi1hAtSignal.toFixed(2)) : null,
                idx,
                stopPriceOverride,
                cloudZone,
                srZone,
                srTargetPrice,
                srLines,
            });
        }
    }

    // Fase 2 — busca candles de 1m cobrindo do sinal mais antigo até agora (uma única vez,
    // reaproveitada por todos os sinais desta moeda), pra resolver pullback + OCO minuto a
    // minuto como no bot real. Intervalo já em 1m: os próprios candles principais já servem.
    let oneMinCandles = null;
    if (rawSignals.length > 0 && interval !== '1m') {
        const ivMs = intervalMs(interval);
        const earliestCloseMs = Math.min(...rawSignals.map((s) => s.signalCandle.openTime + ivMs));
        const neededMinutes = Math.ceil((Date.now() - earliestCloseMs) / 60000) + 2;
        const limit1m = Math.max(5, Math.min(neededMinutes, MAX_ONE_MINUTE_CANDLES));
        try {
            oneMinCandles = await fetchCandles(symbol, '1m', limit1m);
        } catch {
            oneMinCandles = null;
        }
    }

    const occurrences = [];
    for (const { signalCandle, signalPrice, signalRsi, signalRsi1h, idx, stopPriceOverride, cloudZone, srZone, srTargetPrice, srLines } of rawSignals) {
        const ivMs = interval === '1m' ? 60_000 : intervalMs(interval);
        const signalCloseMs = signalCandle.openTime + ivMs;

        let scanCandles = null;
        if (interval === '1m') {
            scanCandles = candles.slice(idx + 1);
        } else if (oneMinCandles?.length && oneMinCandles[0].openTime <= signalCloseMs) {
            scanCandles = oneMinCandles.filter((c) => c.openTime > signalCloseMs);
        }

        // Fallback: sinal mais antigo que a janela de 1m disponível (ou 1m indisponível) —
        // resolve pelo candle do intervalo principal, como antes.
        if (!scanCandles) {
            scanCandles = candles.slice(idx + 1);
        }

        // ATR% no instante do sinal (só usado pelo modo 'atrTrail'). null enquanto não há série
        // suficiente antes do sinal (warmup) — nesse caso o modo cai na largura wNearPct.
        let atrPctAtSignal = null;
        if (trailingStopNeedsAtr && atrSeries.length) {
            const k = idx - atrOffset;
            if (k >= 0 && k < atrSeries.length && signalPrice > 0) {
                atrPctAtSignal = (atrSeries[k] / signalPrice) * 100;
            }
        }

        const resolved = resolveFromSignal(scanCandles, signalPrice, {
            pullbackPct, targetPct, stopLossPct, stopPriceOverride, hardTakeProfitPct,
            targetPriceOverride: srEnabled ? srTargetPrice : null,
            targetMode: targetModeResolved,
            trailingStop: trailingStopEnabled
                ? {
                    enabled: true,
                    mode: trailingStopMode,
                    startPct: trailingStopStartPct,
                    coinStepPct: trailingStopCoinStepPct,
                    stopStepPct: trailingStopStopStepPct,
                    pivotPct: tsPivotPct,
                    aCoinStepPct: tsPhaseACoinStep,
                    aStopStepPct: tsPhaseAStopStep,
                    bCoinStepPct: tsPhaseBCoinStep,
                    bStopStepPct: tsPhaseBStopStep,
                    pivotGainPct: tsPivotGainPct,
                    wNearPct: tsWNearPct,
                    wFarPct: tsWFarPct,
                    atrMult: tsAtrMult,
                    atrMaxPct: tsAtrMaxPct,
                    atrPct: atrPctAtSignal,
                }
                : null,
            trailingTarget: targetModeResolved === 'continuous'
                ? { coinStepPct: trailingTargetCoinStepPct, stepPct: trailingTargetStepPct }
                : null,
        });
        occurrences.push(buildOccurrence(signalCandle, signalPrice, signalRsi, resolved, positionSizeUsd, cloudZone, signalRsi1h, srZone, srLines));
    }

    // "Remover saída aberta": tira da amostra (tabela E agregados) os sinais ainda não resolvidos
    // (outcome 'open', preso ao preço de agora) — sem isso, o P&L médio ficaria misturado com
    // posições ainda em aberto, cujo resultado final ainda não é conhecido.
    const finalOccurrences = excludeOpenExits ? occurrences.filter(o => o.outcome !== 'open') : occurrences;

    const filledOccurrences = finalOccurrences.filter(o => o.filled);
    const totalTarget = filledOccurrences.filter(o => o.outcome === 'target').length;
    const totalStop = filledOccurrences.filter(o => o.outcome === 'stop').length;
    const totalOpen = filledOccurrences.filter(o => o.outcome === 'open').length;
    const totalNotFilled = finalOccurrences.length - filledOccurrences.length;
    const closedCount = totalTarget + totalStop;
    const baseVsEvolved = countBaseVsEvolvedExits(filledOccurrences);
    const winRatePct = closedCount > 0 ? parseFloat(((totalTarget / closedCount) * 100).toFixed(1)) : 0;
    const totalInvestedUsd = parseFloat((filledOccurrences.length * positionSizeUsd).toFixed(2));
    const totalPnlUsd = parseFloat(filledOccurrences.reduce((s, o) => s + o.pnlUsd, 0).toFixed(2));
    const avgPnlPct = filledOccurrences.length > 0
        ? parseFloat((filledOccurrences.reduce((s, o) => s + o.pnlPct, 0) / filledOccurrences.length).toFixed(2))
        : 0;

    return {
        symbol,
        interval,
        rsiPeriod: RSI_PERIOD,
        refRsiInterval: REF_RSI_INTERVAL,
        rsiThreshold,
        priorRsiCount,
        pullbackPct,
        targetPct,
        stopLossPct,
        positionSizeUsd,
        lookbackHours,
        totalCandles: candles.length,
        candleSpanMs: candles.length > 1 ? candles[candles.length - 1].openTime - candles[0].openTime : 0,
        totalSignals: finalOccurrences.length,
        totalFilled: filledOccurrences.length,
        totalTarget,
        totalStop,
        totalOpen,
        totalNotFilled,
        stopBaseCount: baseVsEvolved.stopBase,
        stopEvolvedCount: baseVsEvolved.stopEvolved,
        targetBaseCount: baseVsEvolved.targetBase,
        targetEvolvedCount: baseVsEvolved.targetEvolved,
        winRatePct,
        totalInvestedUsd,
        totalPnlUsd,
        avgPnlPct,
        bandWidth: bandWidthResult,
        prevDayCloud: pdcEnabled ? { maxPct: pdcMaxPct, interval: pdcInterval, candleCount: pdcCandleCount, useHighLow: pdcUseHighLow } : null,
        cloudZoneStats: pdcEnabled ? computeCloudZoneStats(finalOccurrences) : null,
        supportResistance: srEnabled ? {
            interval: srInterval, candleCount: srCandleCount,
            entrySupportRank: srEntryRank, exitResistanceRank: srExitRank,
            entryMaxPct: srEntryMaxPct,
            entryMaxPctMode: srEntryMaxPctAdaptive ? 'adapt' : 'fixed',
        } : null,
        supportResistanceStats: srEnabled ? computeSupportResistanceZoneStats(finalOccurrences) : null,
        srBlockedCount: srEnabled ? srBlocked : 0,
        rsi1hBreakdown: computeRsi1hBreakdown(finalOccurrences),
        volume: volumeResult,
        excludeOpenExits,
        prevCandleStop: pcsEnabled,
        adxFilter: adxEnabled ? { interval: adxInterval, minAdx: adxMinAdx } : null,
        macdFilter: macdEnabled ? { interval: macdInterval } : null,
        higherRsiFilter: higherRsiEnabled ? { interval: REF_RSI_INTERVAL, minRsi: higherRsiMin } : null,
        higherRsiBlockedCount: higherRsiEnabled ? higherRsiBlocked : 0,
        rsi5mFilter: rsi5mEnabled ? { interval: '5m', threshold: rsi5mThreshold } : null,
        rsi5mBlockedCount: rsi5mEnabled ? rsi5mBlocked : 0,
        newHighFilter: nhEnabled ? { lookback: nhLookback, marginPct: nhMarginPct } : null,
        newHighBlockedCount: nhEnabled ? newHighBlocked : 0,
        trailingStop: trailingStopEnabled ? {
            mode: trailingStopMode,
            startPct: trailingStopStartPct,
            coinStepPct: trailingStopCoinStepPct,
            stopStepPct: trailingStopStopStepPct,
            ...(trailingStopMode === 'twoPhase' ? {
                pivotPct: tsPivotPct,
                aCoinStepPct: tsPhaseACoinStep, aStopStepPct: tsPhaseAStopStep,
                bCoinStepPct: tsPhaseBCoinStep, bStopStepPct: tsPhaseBStopStep,
            } : {}),
            ...(trailingStopMode === 'peakTrail' ? {
                pivotGainPct: tsPivotGainPct, wNearPct: tsWNearPct, wFarPct: tsWFarPct,
            } : {}),
            ...(trailingStopMode === 'atrTrail' ? {
                pivotGainPct: tsPivotGainPct, wNearPct: tsWNearPct,
                atrPeriod: ATR_PERIOD, atrMult: tsAtrMult, atrMaxPct: tsAtrMaxPct,
            } : {}),
        } : null,
        targetMode: targetModeResolved,
        trailingTarget: targetModeResolved === 'continuous' ? {
            basePct: targetPct,
            coinStepPct: trailingTargetCoinStepPct,
            stepPct: trailingTargetStepPct,
        } : null,
        hardTakeProfit: hardTakeProfitPct > 0 ? { pct: hardTakeProfitPct } : null,
        dailyEntryStats: computeDailyEntryStats(filledOccurrences, positionSizeUsd, entriesDayRange),
        tradeDuration: computeAvgTradeDurationMs(filledOccurrences),
        occurrences: finalOccurrences,
    };
}

module.exports = analyseRsiThresholdBacktest;
module.exports.countBaseVsEvolvedExits = countBaseVsEvolvedExits;
module.exports.computeCloudZoneStats = computeCloudZoneStats;
module.exports.computeSupportResistanceZoneStats = computeSupportResistanceZoneStats;
module.exports.computeRsi1hBreakdown = computeRsi1hBreakdown;
module.exports.pickSupport = pickSupport;
module.exports.pickResistance = pickResistance;
module.exports.checkSupportResistanceFilter = checkSupportResistanceFilter;
module.exports.classifySrZone = classifySrZone;
module.exports.resolveSupportResistanceAt = resolveSupportResistanceAt;
module.exports.computeAdaptiveSupportEntryPct = computeAdaptiveSupportEntryPct;
