const getClient = require('./getClient');
const writeCandles = require('../utils/write-candles');
const readCandles = require('../utils/read-candles');
const convertIntervalToMiliseconds = require('../utils/convert-interval-to-miliseconds');

/**
 * Lê o banco de dados, busca candles atualizados e retorna candles solicitados de acordo com o símbolo, intervalo  e 
 * limite.
 * @param {string} symbol - O símbolo da moeda, BTC => BTCUSDT.
 * @param {string} interval - O intervalo, se 1h (uma hora), 4h, 15 (quinze minutos) etc.
 * @param {integer} limit - O limite de candles solicitados.
 */

let i  = 0
module.exports = getClandles = async function (symbol, interval, limit) {

    
// remove cíclical error

    /**
     * Como temos os valores das moedas salvos, vamos buscar apenas os valores novos, assim, ao inves de pedir
     * 200 ou 300 períodos para a api, pediremos apenas os últimos valores necessários.
     */

    let dbCandles;
    try {
        // Leitura do db desktop em json
        dbCandles = await readCandles(symbol, interval);
    } catch (error) {
        // Caso não haja ainda o arquivo, cria o arquivo
        if (error.code === 'ENOENT') {
            writeCandles(symbol, interval, [])
            dbCandles = [];
        } else {
            // Outro erro, vamos lançá-lo novamente
            throw error;
        }
    }

    // Data atual, no momento da solicitação.
    const currentTimestamp = Date.now();
    // Diferença entre a data atual e data do último candle salvo no banco desktop.
    let dbLastItemOpenTime;

    if (dbCandles.length > 0) {

        dbLastItemOpenTime = dbCandles.slice(-1)[0].openTime;
    } else {
        dbLastItemOpenTime = Date.now();
    }


    const timeDifference = currentTimestamp - dbLastItemOpenTime;
    // Período solicitado em milisegundos
    let miliseconds = await convertIntervalToMiliseconds(interval);
    // Limite de candles necessários para atualizar o banco
    const limitForUpdateDb = Math.floor(timeDifference / miliseconds);

    // Símbolo e limite de atualizações
    console.log(i, 'symbol',  symbol, 'update len ', limitForUpdateDb);
    i++;

    // Caso o tamanho da array maior que mil, deletar o valor mais antigo. A array não pode ultrapassar mil registros.
    if (dbCandles.length > 1000) {
        dbCandles = dbCandles.slice(-999)
    }
    /** Se a solicitação for maior do que o que existe no banco, atualiza todo o banco com o tamanho da solicitação */
    if (limit > dbCandles.length) {

        let client = await getClient();
        let candles = await client.candles({ symbol: symbol, interval: interval, limit: limit });

        writeCandles(symbol, interval, candles)

        return candles;

    } else {

        /** Se o limite de atualizações de candle for  maior que zero */
        if (limitForUpdateDb > 0) {

            let client = await getClient();
            let candles = await client.candles({ symbol: symbol, interval: interval, limit: limitForUpdateDb });

            // Busca candles para atualizar banco
            candles.forEach(candle => dbCandles.push(candle));

            // Retirar valores repetidos a partir do atributo openTime
            let uniqueItems = [];

            // Verificar para não ter repetições de candles ao salvar
            dbCandles.forEach(item => {
                // Use INT_CD as the key to check uniqueness
                uniqueItems[item.openTime] = item;
            });
            let uniqueArray = Object.values(uniqueItems);

            writeCandles(symbol, interval, uniqueArray)

        } else {
           
            let client = await getClient();
            let candles = await client.candles({ symbol: symbol, interval: interval, limit: 1 });

            // Busca candles para atualizar banco
            candles.forEach(candle => {

                dbCandles.pop()
                dbCandles.push(candle)
            });

            // Retirar valores repetidos a partir do atributo openTime
            let uniqueItems = [];

            // Verificar para não ter repetições de candles ao salvar
            dbCandles.forEach(item => {
                // Use INT_CD as the key to check uniqueness
                uniqueItems[item.openTime] = item;
            });
            let uniqueArray = Object.values(uniqueItems);

            writeCandles(symbol, interval, uniqueArray)
        }
        return dbCandles.slice(-limit);
    }



}