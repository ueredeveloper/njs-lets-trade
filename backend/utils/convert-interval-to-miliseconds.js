/**

Converte um intervalo de tempo em milissegundos.
@param {string} interval - O intervalo de tempo a ser convertido. Deve ser uma das seguintes opções: '1m', '5m', '15m', '30m', '1h', '4h' ou qualquer outro valor para 8 horas.
@returns {number} O valor do intervalo convertido em milissegundos.
*/

async function convertIntervalToMiliseconds(interval) {

    switch (interval) {
        // 1 minute converted for seconds and then for miliseconds
        case '1m':
            return 1 * 60 * 1000
            break;
        case '5m':
            return 5 * 60 * 1000
            break;
        case '15m':
            return 15 * 60 * 1000
            break;
        case '30m':
            return 30 * 60 * 1000
            break;
        // 1 hour converted for minutes, then seconds, then miliseconds
        case '1h':
            return 1 * 60 * 60 * 1000
            break;
        case '4h':
            return 4 * 60 * 60 * 1000
            break;
        // 8 hours
        default:
            return 8 * 60 * 60 * 1000
    }

}

module.exports = convertIntervalToMiliseconds;