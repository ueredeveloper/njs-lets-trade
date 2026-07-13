'use strict';

const EMA = require('technicalindicators').EMA;
const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');

const LIMIT = 3000;

function buildAlignedSeries(candles, fast, slow) {
    const closes = candles.map(c => parseFloat(c.close));
    const fastVals = EMA.calculate({ values: closes, period: fast });
    const slowVals = EMA.calculate({ values: closes, period: slow });
    const fastOff = fast - 1;
    const slowOff = slow - 1;
    const fastMap = new Map(fastVals.map((v, i) => [candles[i + fastOff].openTime, v]));
    const slowMap = new Map(slowVals.map((v, i) => [candles[i + slowOff].openTime, v]));
    return candles
        .filter(c => fastMap.has(c.openTime) && slowMap.has(c.openTime))
        .map(c => ({
            openTime: parseInt(c.openTime),
            close: parseFloat(c.close),
            fast: fastMap.get(c.openTime),
            slow: slowMap.get(c.openTime),
        }));
}

/**
 * Analisa ciclos de cruzamento EMA simples: mede a valorização média entre
 * o cruzamento de entrada (EMA{fast} acima de EMA{slow} no intervalo de entrada)
 * e o cruzamento de saída (EMA{fast} abaixo de EMA{slow} no intervalo de saída).
 *
 * @param {string} symbol
 * @param {object} [options]
 * @param {string} [options.entryInterval='15m']  Intervalo de entrada (cruzamento para cima)
 * @param {string} [options.exitInterval='30m']   Intervalo de saída (cruzamento para baixo)
 * @param {number} [options.fastPeriod=9]         Período da EMA rápida
 * @param {number} [options.slowPeriod=21]        Período da EMA lenta
 * @param {string|null} [options.source=null]     'gate' ou null (Binance)
 *
 * @returns {Promise<object>}
 *   - symbol, entryInterval, exitInterval, fastPeriod, slowPeriod
 *   - totalEntrySignals    : total de cruzamentos de entrada encontrados
 *   - totalOccurrences     : ciclos completos (entrada + saída)
 *   - avgAppreciationPercent: valorização média (%)
 *   - occurrences[]        : detalhes de cada ciclo
 */
async function analyseSimpleMaCross(symbol, options = {}) {
    const {
        entryInterval = '15m',
        exitInterval  = '30m',
        fastPeriod    = 9,
        slowPeriod    = 21,
        source        = null,
    } = options;

    const fetchFn = source === 'gate' ? getGateCandles : getCandles;

    const [entryCdls, exitCdls] = await Promise.all([
        fetchFn(symbol, entryInterval, LIMIT),
        fetchFn(symbol, exitInterval, LIMIT),
    ]);

    const entrySeries = buildAlignedSeries(entryCdls, fastPeriod, slowPeriod);
    const exitSeries  = buildAlignedSeries(exitCdls,  fastPeriod, slowPeriod);

    // Cruzamentos EMA fast acima de EMA slow na série de entrada
    const entrySignals = [];
    for (let i = 1; i < entrySeries.length; i++) {
        const prev = entrySeries[i - 1];
        const curr = entrySeries[i];
        if (prev.fast <= prev.slow && curr.fast > curr.slow) {
            entrySignals.push({ time: curr.openTime, price: curr.close });
        }
    }

    // Para cada sinal de entrada, encontra o primeiro cruzamento para baixo na série de saída
    const occurrences = [];
    for (const signal of entrySignals) {
        let wasAbove = null;
        let foundExit = null;

        for (const ex of exitSeries) {
            const isAbove = ex.fast > ex.slow;
            if (ex.openTime > signal.time && wasAbove === true && !isAbove) {
                foundExit = ex;
                break;
            }
            wasAbove = isAbove;
        }

        if (foundExit) {
            occurrences.push({
                startDate:  new Date(signal.time).toISOString(),
                entryPrice: signal.price,
                endDate:    new Date(foundExit.openTime).toISOString(),
                exitPrice:  foundExit.close,
                appreciationPercent: parseFloat(
                    (((foundExit.close - signal.price) / signal.price) * 100).toFixed(2)
                ),
            });
        }
    }

    const total = occurrences.length;
    const avgAppreciationPercent = total > 0
        ? parseFloat((occurrences.reduce((s, o) => s + o.appreciationPercent, 0) / total).toFixed(2))
        : 0;

    return {
        symbol,
        entryInterval,
        exitInterval,
        fastPeriod,
        slowPeriod,
        totalEntrySignals: entrySignals.length,
        totalOccurrences: total,
        avgAppreciationPercent,
        occurrences,
    };
}

module.exports = analyseSimpleMaCross;
