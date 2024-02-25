const getClient = require('./getClient');

module.exports = getClandles = async function (symbol, limit, interval){

    let client = await getClient();
    let candles = await client.candles({ symbol: symbol,limit: limit, interval: interval});

    return candles;
}