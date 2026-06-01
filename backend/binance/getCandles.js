const getClient                    = require('./getClient');
const writeCandles                 = require('../utils/write-candles');
const readCandles                  = require('../utils/read-candles');
const convertIntervalToMiliseconds = require('../utils/convert-interval-to-miliseconds');
const { getGateCandles }           = require('../gate/getGateCandles');

// Símbolos deslistados na Binance — usar Gate.io automaticamente
const GATE_ONLY_SYMBOLS = new Set(['SKYAIUSDT', 'SLXUSDT']);

/**
 * Busca candles de um símbolo. Se o símbolo estiver deslistado na Binance,
 * delega automaticamente para a Gate.io (mesmo formato de retorno).
 *
 * @param {string}  symbol   Ex: 'BTCUSDT', 'FIOUSDT'
 * @param {string}  interval Ex: '1h', '4h', '8h'
 * @param {number}  limit    Quantidade de candles solicitados
 */
let i = 0;
module.exports = getCandles = async function (symbol, interval, limit) {

    if (GATE_ONLY_SYMBOLS.has(symbol.toUpperCase())) {
        return getGateCandles(symbol, interval, limit);
    }

    // limit = 1000;

    let dbCandles;
    try {
        dbCandles = await readCandles(symbol, interval);
    } catch (error) {
        if (error.code === 'ENOENT') {
            writeCandles(symbol, interval, []);
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

    const timeDifference   = currentTimestamp - dbLastItemOpenTime;
    let miliseconds        = await convertIntervalToMiliseconds(interval);
    const limitForUpdateDb = Math.floor(timeDifference / miliseconds);

    i++;

    if (dbCandles.length > 3000) {
        dbCandles = dbCandles.slice(-2999);
    }

    if (limit > dbCandles.length) {

        let client  = await getClient();
        let candles = await client.candles({ symbol, interval, limit });

        writeCandles(symbol, interval, candles);
        return candles;

    } else {

        if (limitForUpdateDb > 0) {

            let client  = await getClient();
            let candles = await client.candles({ symbol, interval, limit: limitForUpdateDb });

            candles.forEach(candle => dbCandles.push(candle));

        } else {

            let client  = await getClient();
            let candles = await client.candles({ symbol, interval, limit: 1 });

            dbCandles.pop();
            candles.forEach(candle => dbCandles.push(candle));
        }

        // Deduplica por openTime
        const uniqueItems = {};
        dbCandles.forEach(item => { uniqueItems[item.openTime] = item; });
        const uniqueArray = Object.values(uniqueItems);

        writeCandles(symbol, interval, uniqueArray);
        return uniqueArray.slice(-limit);
    }
};
