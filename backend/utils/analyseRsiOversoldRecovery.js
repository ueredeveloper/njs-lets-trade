const RSI = require('technicalindicators').RSI;
const readCandles = require('./read-candles');
const getClandles = require('../binance/getClandles');

const RSI_PERIOD = 14;
const HTF_LIMIT = 200;

/**
 * Analisa eventos de sobrevenda/sobrecompra no RSI de uma moeda.
 *
 * Lê os candles salvos em backend/data/candlestick/<symbol>-<interval>.json,
 * calcula o RSI (período 14) e varre a série procurando ciclos completos:
 *   RSI cai abaixo de `oversold`  →  entrada (pior RSI da zona)
 *   RSI sobe acima de `overbought` →  saída
 * Para cada ciclo registra preço de entrada, preço de saída e valorização (%).
 *
 * @param {string} symbol              - Símbolo da moeda. Ex: 'WAVESUSDT', 'OMGUSDT'
 * @param {string} interval            - Intervalo dos candles. Ex: '1m', '5m', '30m', '1h', '4h', '1d'
 * @param {object} [options]
 * @param {number} [options.oversold=30]    - RSI de entrada. Padrão 30 (sobrevenda clássica).
 *                                            Diminua para sinais mais raros e extremos (ex: 20).
 * @param {number} [options.overbought=70]  - RSI de saída. Padrão 70 (sobrecompra clássica).
 *                                            Diminua para saídas mais antecipadas (ex: 60).
 *
 * @returns {Promise<object>} Resultado com:
 *  - symbol / interval / rsiPeriod / oversoldThreshold / overboughtThreshold
 *  - totalCandles          : total de candles no arquivo
 *  - totalRsiPeriods       : períodos com RSI calculado (totalCandles - rsiPeriod)
 *  - totalOccurrences      : ciclos completos encontrados (entrada + saída confirmada)
 *  - avgAppreciationPercent: valorização média (%) entre entrada e saída
 *  - occurrences[]         : detalhes de cada ciclo
 *      - startDate         : data/hora da entrada (ISO 8601)
 *      - entryPrice        : preço de fechamento na entrada
 *      - entryRsi          : RSI no ponto de entrada
 *      - endDate           : data/hora da saída (ISO 8601)
 *      - exitPrice         : preço de fechamento na saída
 *      - exitRsi           : RSI no ponto de saída
 *      - appreciationPercent: valorização (%) de entryPrice até exitPrice
 *
 * @example
 * const analyse = require('./analyseRsiOversoldRecovery');
 *
 * // Padrão: entrada RSI < 30, saída RSI > 70
 * const result = await analyse('WAVESUSDT', '30m');
 *
 * // Customizado: entrada RSI < 20, saída RSI > 60
 * const result = await analyse('WAVESUSDT', '30m', { oversold: 20, overbought: 60 });
 *
 * console.log(result.totalCandles);       // 266
 * console.log(result.totalRsiPeriods);    // 252
 * console.log(result.totalOccurrences);   // 2
 * console.log(result.avgAppreciationPercent); // 3.98
 * console.log(result.occurrences[0].startDate);        // '2024-04-28T23:30:00.000Z'
 * console.log(result.occurrences[0].appreciationPercent); // 6.55
 */
function buildRsiSeries(candles) {
    if (!candles || candles.length < RSI_PERIOD + 1) return null;
    const closes = candles.map(c => parseFloat(c.close));
    const rsiValues = RSI.calculate({ values: closes, period: RSI_PERIOD });
    return rsiValues.map((rsi, i) => ({
        openTime: parseInt(candles[i + RSI_PERIOD].openTime),
        rsi: parseFloat(rsi.toFixed(2)),
    }));
}

// Retorna o RSI mais recente cujo openTime <= targetTime (busca binária).
function findRsiAt(series, targetTime) {
    if (!series) return null;
    let lo = 0, hi = series.length - 1, result = null;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (series[mid].openTime <= targetTime) {
            result = series[mid].rsi;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}

async function analyseRsiOversoldRecovery(symbol, interval, options = {}) {
    const { oversold = 30, overbought = 70 } = options;

    const settled = await Promise.allSettled([
        readCandles(symbol, interval),
        getClandles(symbol, '4h', HTF_LIMIT),
        getClandles(symbol, '8h', HTF_LIMIT),
    ]);

    const [candlesResult, candles4hResult, candles8hResult] = settled;
    if (candlesResult.status === 'rejected') throw candlesResult.reason;

    const candles  = candlesResult.value;
    const series4h = buildRsiSeries(candles4hResult.status === 'fulfilled' ? candles4hResult.value : null);
    const series8h = buildRsiSeries(candles8hResult.status === 'fulfilled' ? candles8hResult.value : null);

    const closes = candles.map(c => parseFloat(c.close));
    const rsiValues = RSI.calculate({ values: closes, period: RSI_PERIOD });

    // rsiValues[i] corresponde a candles[i + RSI_PERIOD]
    const offset = RSI_PERIOD;

    // Máquina de estados sequencial:
    //   SEEK_ENTRY → aguarda RSI cruzar abaixo de oversold  → registra entrada
    //   SEEK_EXIT  → aguarda RSI cruzar acima de overbought → registra saída, volta ao início
    // Cada ciclo começa somente após o anterior ser concluído (não há sobreposição).
    const occurrences = [];
    let state = 'SEEK_ENTRY';
    let entryIdx = null;

    for (let i = 0; i < rsiValues.length; i++) {
        if (state === 'SEEK_ENTRY' && rsiValues[i] < oversold) {
            entryIdx = i;
            state = 'SEEK_EXIT';
            continue;
        }

        if (state === 'SEEK_EXIT' && rsiValues[i] >= overbought) {
            const entryCandle = candles[entryIdx + offset];
            const exitCandle  = candles[i + offset];
            const entryPrice  = parseFloat(entryCandle.close);
            const exitPrice   = parseFloat(exitCandle.close);
            const entryTime   = parseInt(entryCandle.openTime);

            occurrences.push({
                startDate: new Date(entryCandle.openTime).toISOString(),
                entryPrice,
                entryRsi:   parseFloat(rsiValues[entryIdx].toFixed(2)),
                entryRsi4h: findRsiAt(series4h, entryTime),
                entryRsi8h: findRsiAt(series8h, entryTime),
                endDate: new Date(exitCandle.openTime).toISOString(),
                exitPrice,
                exitRsi: parseFloat(rsiValues[i].toFixed(2)),
                appreciationPercent: parseFloat(
                    (((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2)
                ),
            });

            entryIdx = null;
            state = 'SEEK_ENTRY';
        }
    }

    const total = occurrences.length;
    const avgAppreciationPercent = total > 0
        ? parseFloat((occurrences.reduce((s, o) => s + o.appreciationPercent, 0) / total).toFixed(2))
        : 0;

    return {
        symbol,
        interval,
        rsiPeriod: RSI_PERIOD,
        oversoldThreshold: oversold,
        overboughtThreshold: overbought,
        totalCandles: candles.length,
        totalRsiPeriods: rsiValues.length,
        totalOccurrences: total,
        avgAppreciationPercent,
        occurrences,
    };
}

module.exports = analyseRsiOversoldRecovery;

// Uso direto pelo terminal:
//   node backend/utils/analyseRsiOversoldRecovery.js <symbol> <interval> [oversold] [overbought]
//
// Exemplos:
//   node backend/utils/analyseRsiOversoldRecovery.js WAVESUSDT 30m
//   node backend/utils/analyseRsiOversoldRecovery.js WAVESUSDT 30m 20 60

/*
if (require.main === module) {
    const [,, symbol, interval, oversold, overbought] = process.argv;

    if (!symbol || !interval) {
        console.error('Uso: node analyseRsiOversoldRecovery.js <symbol> <interval> [oversold] [overbought]');
        console.error('Ex:  node analyseRsiOversoldRecovery.js WAVESUSDT 30m 30 70');
        process.exit(1);
    }

    const options = {
        oversold:   oversold   ? parseFloat(oversold)   : 30,
        overbought: overbought ? parseFloat(overbought) : 70,
    };

    analyseRsiOversoldRecovery(symbol, interval, options).then(r => {
        console.log(`\n${r.symbol} — ${r.interval} | RSI período: ${r.rsiPeriod}`);
        console.log(`Candles disponíveis: ${r.totalCandles} | Períodos RSI analisados: ${r.totalRsiPeriods}`);
        console.log(`Limiar entrada: RSI < ${r.oversoldThreshold} | Limiar saída: RSI > ${r.overboughtThreshold}`);
        console.log(`Eventos completos: ${r.totalOccurrences} | Valorização média: ${r.avgAppreciationPercent}%\n`);

        if (r.totalOccurrences === 0) {
            console.log('Nenhum ciclo completo encontrado no período disponível.');
            return;
        }

        r.occurrences.forEach((o, i) => {
            console.log(`  #${i + 1}`);
            console.log(`    Início : ${o.startDate}  RSI ${o.entryRsi}  preço $${o.entryPrice}`);
            console.log(`    Fim    : ${o.endDate}  RSI ${o.exitRsi}  preço $${o.exitPrice}`);
            console.log(`    Resultado: +${o.appreciationPercent}%\n`);
        });
    }).catch(err => {
        console.error('Erro:', err.message);
        process.exit(1);
    });
}
    */
