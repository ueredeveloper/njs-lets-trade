const fetchKlines = require('./fetchKlines');
const writeCandles = require('../utils/write-candles');
const readCandles = require('../utils/read-candles');
const convertIntervalToMiliseconds = require('../utils/convert-interval-to-miliseconds');
const { getGateCandles } = require('../gate/getGateCandles');
const { retentionLimitFor } = require('../utils/candleRetentionLimits');
const { withFileLock } = require('../utils/fileLock');

// Símbolos deslistados na Binance — usar Gate.io automaticamente
const GATE_ONLY_SYMBOLS = new Set(['SKYAIUSDT', 'SLXUSDT', 'UNIUSDT', 'ZESTUSDT', 'ONDOUSDT',
    'VIRTUAL', 'FARTCOINUSDT', 'ARIAUSDT', 'BEATUSDT', 'FILUSDT']);

/**
 * Busca candles de um símbolo. Se o símbolo estiver deslistado na Binance,
 * delega automaticamente para a Gate.io (mesmo formato de retorno).
 *
 * @param {string}  symbol   Ex: 'BTCUSDT', 'FIOUSDT'
 * @param {string}  interval Ex: '1h', '4h', '8h'
 * @param {number}  limit    Quantidade de candles solicitados
 */
module.exports = getCandles = async function (symbol, interval, limit) {

    if (GATE_ONLY_SYMBOLS.has(symbol.toUpperCase())) {
        return getGateCandles(symbol, interval, limit);
    }

    // limit = 1000;

    return withFileLock(`${symbol}-${interval}`, async () => {
        let dbCandles;
        try {
            dbCandles = await readCandles(symbol, interval);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await writeCandles(symbol, interval, []);
                dbCandles = [];
            } else {
                throw error;
            }
        }

        const currentTimestamp = Date.now();
        let dbLastItemOpenTime;

        if (dbCandles.length > 0) {
            dbLastItemOpenTime = dbCandles.slice(-1)[0].openTime;
        } else {
            dbLastItemOpenTime = Date.now();
        }

        const timeDifference = currentTimestamp - dbLastItemOpenTime;
        let miliseconds = await convertIntervalToMiliseconds(interval);
        const limitForUpdateDb = Math.floor(timeDifference / miliseconds);

        const retentionLimit = retentionLimitFor(interval);
        if (dbCandles.length > retentionLimit) {
            dbCandles = dbCandles.slice(-(retentionLimit - 1));
        }

        if (limit > dbCandles.length) {

            const candles = await fetchKlines(symbol, interval, limit);
            await writeCandles(symbol, interval, candles);
            return candles;

        } else {

            // Margem de segurança: NÃO confiar em limitForUpdateDb como o número exato de
            // candles a buscar. Math.floor(timeDifference/miliseconds) subestima 1 candle
            // sempre que o gap entre polls não é múltiplo exato do intervalo (jitter do loop
            // do bot, awaits, latência de rede) — ex.: poll a cada 5min num candle de 3m com
            // gap real de 5min58s dá floor(358/180)=1 quando 2 candles já fecharam. Buscar só
            // 1 candle nesse caso pula o candle intermediário pra sempre (nunca é buscado de
            // novo) e, no caminho antigo, o dbCandles.pop() ainda descartava o candle anterior
            // congelado no meio da formação — banda calculada sobre dado desatualizado (ver
            // caso BOME/HEMI: bot comprando sem o desconto de pullback configurado porque a
            // banda inferior usada vinha de 1-2 candles atrás da real). Buscar sempre alguns
            // candles a mais que o necessário e deixar a deduplicação por openTime abaixo
            // corrigir/preencher qualquer buraco resolve sem precisar acertar o cálculo exato.
            const fetchCount = Math.max(5, limitForUpdateDb + 3);
            const candles = await fetchKlines(symbol, interval, fetchCount);
            candles.forEach(candle => dbCandles.push(candle));

            // Deduplica por openTime
            const uniqueItems = {};
            dbCandles.forEach(item => { uniqueItems[item.openTime] = item; });
            const uniqueArray = Object.values(uniqueItems);

            await writeCandles(symbol, interval, uniqueArray);
            return uniqueArray.slice(-limit);
        }
    });
};
