const getClient = require('./getClient');


module.exports = getClandles = async function (symbol, interval, limit) {

    let client = await getClient();
    let candles = await client.candles({ symbol: symbol, interval: interval, limit: limit });

    return candles;
}