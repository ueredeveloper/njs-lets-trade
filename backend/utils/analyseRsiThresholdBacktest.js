'use strict';

const RSI = require('technicalindicators').RSI;
const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { bollingerCycleOccurrences } = require('./indicatorGrowthEngines');
const { averageWithoutOutliers } = require('./removeOutliersIQR');

const RSI_PERIOD = 14;
const DEFAULT_CANDLE_COUNT = 1000;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const BB_MIN_CANDLES_PADDING = 5;
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
function resolveFromSignal(scanCandles, signalPrice, { pullbackPct, targetPct, stopLossPct }) {
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

    const targetPrice = entryPrice * (1 + targetPct / 100);
    const stopPrice = entryPrice * (1 - stopLossPct / 100);

    let outcome = 'open';
    let exitTime = null;
    let exitPrice = null;

    for (let j = startScanIdx; j < scanCandles.length; j++) {
        const low = parseFloat(scanCandles[j].low);
        const high = parseFloat(scanCandles[j].high);

        // Ordem intra-candle desconhecida (só temos OHLC) — no empate assume o pior caso
        // (stop primeiro), mesmo critério conservador de sempre.
        if (low <= stopPrice) {
            outcome = 'stop';
            exitTime = scanCandles[j].openTime;
            exitPrice = stopPrice;
            break;
        }
        if (high >= targetPrice) {
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

    return { filled: true, entryTime, entryPrice, targetPrice, stopPrice, outcome, exitTime, exitPrice };
}

function buildOccurrence(signalCandle, signalPrice, signalRsi, resolved, positionSizeUsd) {
    if (!resolved.filled) {
        return {
            signalDate: new Date(signalCandle.openTime).toISOString(),
            signalPrice,
            signalRsi,
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
    };
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
    } = options;

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

    const settled = await Promise.allSettled([
        fetchCandles(symbol, interval, mainLimit),
        bwEnabled
            ? fetchCandles(symbol, bwInterval, bwLookback + bwPeriod + BB_MIN_CANDLES_PADDING)
            : Promise.resolve(null),
    ]);

    const [candlesResult, bwCandlesResult] = settled;
    if (candlesResult.status === 'rejected') throw candlesResult.reason;
    const candles = candlesResult.value;

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

    // Fase 1 — detecta os cruzamentos de RSI no candle do `interval` principal (o "pensamento"
    // continua em 15m/etc.), sem resolver ainda pullback/saída.
    const rawSignals = [];
    const minI = Math.max(1, priorRsiCount);
    if (!bandWidthBlocksEntries) {
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

            rawSignals.push({
                signalCandle,
                signalPrice: parseFloat(signalCandle.close),
                signalRsi: parseFloat(rsiValues[i].toFixed(2)),
                idx,
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
    for (const { signalCandle, signalPrice, signalRsi, idx } of rawSignals) {
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

        const resolved = resolveFromSignal(scanCandles, signalPrice, { pullbackPct, targetPct, stopLossPct });
        occurrences.push(buildOccurrence(signalCandle, signalPrice, signalRsi, resolved, positionSizeUsd));
    }

    const filledOccurrences = occurrences.filter(o => o.filled);
    const totalTarget = filledOccurrences.filter(o => o.outcome === 'target').length;
    const totalStop = filledOccurrences.filter(o => o.outcome === 'stop').length;
    const totalOpen = filledOccurrences.filter(o => o.outcome === 'open').length;
    const totalNotFilled = occurrences.length - filledOccurrences.length;
    const closedCount = totalTarget + totalStop;
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
        rsiThreshold,
        priorRsiCount,
        pullbackPct,
        targetPct,
        stopLossPct,
        positionSizeUsd,
        lookbackHours,
        totalCandles: candles.length,
        candleSpanMs: candles.length > 1 ? candles[candles.length - 1].openTime - candles[0].openTime : 0,
        totalSignals: occurrences.length,
        totalFilled: filledOccurrences.length,
        totalTarget,
        totalStop,
        totalOpen,
        totalNotFilled,
        winRatePct,
        totalInvestedUsd,
        totalPnlUsd,
        avgPnlPct,
        bandWidth: bandWidthResult,
        occurrences,
    };
}

module.exports = analyseRsiThresholdBacktest;
