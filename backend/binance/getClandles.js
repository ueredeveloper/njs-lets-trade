const fs = require('node:fs');
const getClient = require('./getClient');
const writeCandles = require('../utils/write-candles');
const readCandles = require('../utils/read-candles');


module.exports = getClandles = async function (symbol, interval, limit) {

    console.log('get clandles ', symbol, interval, limit)

    let client = await getClient();
    let candles = await client.candles({ symbol: symbol, interval: interval, limit: limit });


    await readCandles(symbol, interval, (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return;
        }

        console.log('read candles in getCandles ', data)

    });

    writeCandles(symbol, interval, candles)




    return candles;
}