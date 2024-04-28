const fs = require('node:fs');
const getClient = require('./getClient');
const writeCandles = require('../utils/write-candles');
const readCandles = require('../utils/read-candles');
const convertIntervalToMiliseconds = require('../utils/convert-interval-to-miliseconds');


module.exports = getClandles = async function (symbol, interval, limit) {

    /**
     * Como temos os valores das moedas salvos, vamos buscar apenas os valores novos, assim, ao inves de pedir
     * 200 ou 300 períodos para a api, pediremos apenas os últimos valores necessários.
     */

    let dbCandles = await readCandles(symbol, interval, (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return;
        }

        return data;

    });
    // Data atual, no momento da solicitação.
    const currentTimestamp = Date.now();
    // Diferença entre a data atual e data do último candle salvo no banco desktop.
    let dbLastOpenTime = dbCandles.slice(-1)[0].openTime;

    const timeDifference = currentTimestamp - dbLastOpenTime;
    // Período solicitado em milisegundos
    let miliseconds = await convertIntervalToMiliseconds(interval);
    // Limite de candles necessários para atualizar o banco
    const limitForUpdateDb = Math.floor(timeDifference / miliseconds);

    console.log(limitForUpdateDb)

    if (limitForUpdateDb > 0) {

        let client = await getClient();
        let candles = await client.candles({ symbol: symbol, interval: interval, limit: limitForUpdateDb });


        candles.forEach(candle => dbCandles.push(candle));


        writeCandles(symbol, interval, dbCandles)

    }


    return dbCandles.slice(-limit);
}