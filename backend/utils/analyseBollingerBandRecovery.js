'use strict';

const BollingerBands = require('technicalindicators').BollingerBands;
const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');

const BB_PERIOD = 20;
const BB_STD_DEV = 2;
const LIMIT = 1000; // candles 4h — cobre bastante histórico para warmup + ciclos

/**
 * Analisa ciclos de fundo→topo na Bollinger Bands de uma moeda.
 *
 * Varre a série de candles procurando ciclos completos:
 *   close toca/cruza a banda inferior  → entrada (fundo, pior close da zona)
 *   close toca/cruza a banda superior  → saída (topo)
 * Para cada ciclo registra preço de entrada, preço de saída e valorização (%).
 *
 * @param {string} symbol              - Símbolo da moeda. Ex: 'BTCUSDT'
 * @param {object} [options]
 * @param {string} [options.interval='4h']  Intervalo dos candles.
 * @param {number} [options.period=20]      Período da Bollinger Bands.
 * @param {number} [options.stdDev=2]       Desvio padrão das bandas.
 * @param {string|null} [options.source=null] 'gate' ou null (Binance).
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

async function analyseBollingerBandRecovery(symbol, options = {}) {
    const {
        interval = '4h',
        period   = BB_PERIOD,
        stdDev   = BB_STD_DEV,
        source   = null,
    } = options;

    const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
    const candles = await fetchCandles(symbol, interval, LIMIT);

    const bbSeries = buildBbSeries(candles, period, stdDev);
    if (!bbSeries) throw new Error(`Candles insuficientes para BB(${period}) em ${interval}`);

    const offset = period - 1;

    // Máquina de estados sequencial:
    //   SEEK_ENTRY → aguarda close tocar/cruzar a banda inferior → registra fundo
    //   SEEK_EXIT  → aguarda close tocar/cruzar a banda superior → registra topo, volta ao início
    const occurrences = [];
    let state = 'SEEK_ENTRY';
    let minCloseIdx = null;

    for (let i = 0; i < bbSeries.length; i++) {
        const candle = candles[i + offset];
        const close = parseFloat(candle.close);

        if (state === 'SEEK_ENTRY' && close <= bbSeries[i].lower) {
            minCloseIdx = i;
            state = 'SEEK_EXIT';
            continue;
        }

        if (state === 'SEEK_EXIT') {
            if (close < parseFloat(candles[minCloseIdx + offset].close)) {
                minCloseIdx = i;
            }

            if (close >= bbSeries[i].upper) {
                const entryCandle = candles[minCloseIdx + offset];
                const entryPrice = parseFloat(entryCandle.close);
                const exitPrice = close;

                occurrences.push({
                    startDate: new Date(entryCandle.openTime).toISOString(),
                    entryPrice,
                    endDate: new Date(candle.openTime).toISOString(),
                    exitPrice,
                    appreciationPercent: parseFloat(
                        (((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2)
                    ),
                });

                minCloseIdx = null;
                state = 'SEEK_ENTRY';
            }
        }
    }

    // Ciclo aberto: close tocou a banda inferior mas ainda não alcançou a superior.
    let openOccurrence = null;
    if (state === 'SEEK_EXIT' && minCloseIdx !== null) {
        const lowestCandle = candles[minCloseIdx + offset];
        const lastCandle = candles[candles.length - 1];
        const entryPrice = parseFloat(lowestCandle.close);
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

    return {
        symbol,
        interval,
        period,
        stdDev,
        totalCandles: candles.length,
        totalBbPeriods: bbSeries.length,
        totalOccurrences: total,
        avgAppreciationPercent,
        occurrences,
        openOccurrence,
    };
}

module.exports = analyseBollingerBandRecovery;
