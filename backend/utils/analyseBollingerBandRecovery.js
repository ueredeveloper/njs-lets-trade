'use strict';

const BollingerBands = require('technicalindicators').BollingerBands;
const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { getMedianTrendThreshold } = require('./bollingerMedianTrendConfig');

const BB_PERIOD = 20;
const BB_STD_DEV = 2;
const DEFAULT_CANDLE_COUNT = 1000; // candles 4h — cobre bastante histórico para warmup + ciclos

/**
 * Analisa ciclos de fundo→topo na Bollinger Bands de uma moeda.
 *
 * Varre a série de candles procurando ciclos completos:
 *   mínima (pavio) toca/cruza a banda inferior  → entrada (fundo, menor mínima da zona)
 *   máxima (pavio) toca/cruza a banda superior  → saída (topo)
 * Detecta o toque pelo pavio (high/low) — igual ao que se vê visualmente no gráfico —
 * mas registra entryPrice/exitPrice como o close do candle do toque (preço de referência
 * realista, já que o pavio extremo não é necessariamente executável).
 * Para cada ciclo registra preço de entrada, preço de saída e valorização (%).
 *
 * @param {string} symbol              - Símbolo da moeda. Ex: 'BTCUSDT'
 * @param {object} [options]
 * @param {string} [options.interval='4h']  Intervalo dos candles.
 * @param {number} [options.period=20]      Período da Bollinger Bands.
 * @param {number} [options.stdDev=2]       Desvio padrão das bandas.
 * @param {string|null} [options.source=null] 'gate' ou null (Binance).
 * @param {number} [options.pullbackPct=0] Exige que o preço caia esse tanto % ABAIXO da banda
 *   inferior (não só toque nela) antes de contar a entrada — simula uma ordem limite de compra
 *   nesse preço (mesmo `entry.pullback.belowPct` do bot, ver strategyEngine.js). 0 = desligado,
 *   entra assim que a banda é tocada (comportamento padrão, preço de entrada = close do fundo).
 * @param {number} [options.candleCount=1000] Quantidade de candles buscados para a análise.
 *
 * @returns {Promise<object>}
 *  - symbol / interval / period / stdDev
 *  - totalCandles / totalBbPeriods
 *  - totalOccurrences      : ciclos completos encontrados (fundo + topo)
 *  - avgAppreciationPercent: valorização média (%) entre fundo e topo
 *  - occurrences[]         : detalhes de cada ciclo
 *  - openOccurrence        : ciclo em aberto (fundo já tocado, topo ainda não)
 */
function buildBbSeries(candles, period, stdDev) {
    if (!candles || candles.length < period + 1) return null;
    const closes = candles.map(c => parseFloat(c.close));
    const bb = BollingerBands.calculate({ period, values: closes, stdDev });
    const offset = period - 1;
    return bb.map((b, i) => ({
        openTime: parseInt(candles[i + offset].openTime),
        lower: b.lower,
        middle: b.middle,
        upper: b.upper,
    }));
}

/**
 * Tendência % da linha mediana (média) da BB nos `lookback` candles fechados imediatamente
 * ANTERIORES ao índice `i` (o candle do toque em si fica de fora — mesma janela usada pelo bot
 * em checkMedianTrendFilter/backend/bot/bollinger-bands/strategyEngine.js, que compara contra o
 * último candle já fechado antes do sinal). Retorna null se não houver histórico suficiente.
 */
function medianTrendAvgDiffPct(bbSeries, i, lookback) {
    const start = i - lookback - 1;
    if (start < 0) return null;
    const middles = bbSeries.slice(start, i).map(b => b.middle);
    if (middles.length < lookback + 1) return null;
    const diffPcts = [];
    for (let k = 1; k < middles.length; k++) {
        if (!(middles[k - 1] > 0)) continue;
        diffPcts.push(((middles[k] - middles[k - 1]) / middles[k - 1]) * 100);
    }
    if (!diffPcts.length) return null;
    return diffPcts.reduce((a, b) => a + b, 0) / diffPcts.length;
}

async function analyseBollingerBandRecovery(symbol, options = {}) {
    const {
        interval = '4h',
        period   = BB_PERIOD,
        stdDev   = BB_STD_DEV,
        source   = null,
        medianTrendFilter   = false,
        medianTrendLookback = 10,
        pullbackPct = 0,
        candleCount = DEFAULT_CANDLE_COUNT,
    } = options;
    const pullback = Math.max(0, parseFloat(pullbackPct) || 0);
    const limit = parseInt(candleCount) || DEFAULT_CANDLE_COUNT;

    const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
    const candles = await fetchCandles(symbol, interval, limit);

    const bbSeries = buildBbSeries(candles, period, stdDev);
    if (!bbSeries) throw new Error(`Candles insuficientes para BB(${period}) em ${interval}`);

    const offset = period - 1;

    // Máquina de estados sequencial:
    //   SEEK_ENTRY → aguarda a mínima (pavio) tocar/cruzar a banda inferior → registra fundo
    //   SEEK_EXIT  → aguarda a máxima (pavio) tocar/cruzar a banda superior → registra topo, volta ao início
    const occurrences = [];
    let state = 'SEEK_ENTRY';
    let minLowIdx = null;
    let pullbackEntryPrice = null; // preço exato do limite de pullback (só usado quando pullback > 0)

    for (let i = 0; i < bbSeries.length; i++) {
        const candle = candles[i + offset];
        const low = parseFloat(candle.low);
        const high = parseFloat(candle.high);

        // Com pullback, exige que o preço rompa esse tanto % abaixo da banda (não só toque nela)
        // — mesmo threshold que o bot arma como ordem limite (strategyEngine.js#evaluateEntrySignal).
        const entryThreshold = bbSeries[i].lower * (1 - pullback / 100);

        if (state === 'SEEK_ENTRY' && low <= entryThreshold) {
            if (medianTrendFilter) {
                const avgDiffPct = medianTrendAvgDiffPct(bbSeries, i, medianTrendLookback);
                // Sem histórico suficiente ou mediana em queda/subindo devagar demais → mesmo critério do bot: bloqueia a entrada.
                if (avgDiffPct === null || avgDiffPct < getMedianTrendThreshold()) continue;
            }
            minLowIdx = i;
            // Sem pullback, a entrada usa o close do fundo real (rastreado abaixo em SEEK_EXIT) —
            // com pullback, o preço de entrada já é conhecido: o próprio limite que teria enchido.
            pullbackEntryPrice = pullback > 0 ? entryThreshold : null;
            state = 'SEEK_EXIT';
            continue;
        }

        if (state === 'SEEK_EXIT') {
            if (pullback === 0 && low < parseFloat(candles[minLowIdx + offset].low)) {
                minLowIdx = i;
            }

            if (high >= bbSeries[i].upper) {
                const entryCandle = candles[minLowIdx + offset];
                const entryPrice = pullback > 0 ? pullbackEntryPrice : parseFloat(entryCandle.close);
                const exitPrice = parseFloat(candle.close);

                occurrences.push({
                    startDate: new Date(entryCandle.openTime).toISOString(),
                    entryPrice,
                    endDate: new Date(candle.openTime).toISOString(),
                    exitPrice,
                    appreciationPercent: parseFloat(
                        (((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2)
                    ),
                });

                minLowIdx = null;
                pullbackEntryPrice = null;
                state = 'SEEK_ENTRY';
            }
        }
    }

    // Ciclo aberto: a mínima tocou a banda inferior mas a máxima ainda não alcançou a superior.
    let openOccurrence = null;
    if (state === 'SEEK_EXIT' && minLowIdx !== null) {
        const lowestCandle = candles[minLowIdx + offset];
        const lastCandle = candles[candles.length - 1];
        const entryPrice = pullback > 0 ? pullbackEntryPrice : parseFloat(lowestCandle.close);
        const currentPrice = parseFloat(lastCandle.close);

        openOccurrence = {
            isOpen: true,
            startDate: new Date(lowestCandle.openTime).toISOString(),
            entryPrice,
            endDate: null,
            exitPrice: null,
            appreciationPercent: parseFloat(
                (((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2)
            ),
        };
    }

    const total = occurrences.length;
    const avgAppreciationPercent = total > 0
        ? parseFloat((occurrences.reduce((s, o) => s + o.appreciationPercent, 0) / total).toFixed(2))
        : 0;
    const avgCycleDurationMs = total > 0
        ? Math.round(occurrences.reduce((s, o) => s + (new Date(o.endDate).getTime() - new Date(o.startDate).getTime()), 0) / total)
        : 0;

    return {
        symbol,
        interval,
        period,
        stdDev,
        medianTrendFilter,
        medianTrendLookback,
        pullbackPct: pullback,
        totalCandles: candles.length,
        totalBbPeriods: bbSeries.length,
        totalOccurrences: total,
        avgAppreciationPercent,
        avgCycleDurationMs,
        occurrences,
        openOccurrence,
    };
}

module.exports = analyseBollingerBandRecovery;
