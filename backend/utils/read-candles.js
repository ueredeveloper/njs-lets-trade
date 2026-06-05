const fs = require('node:fs/promises');
const path = require('path');

/**

Lê os dados das velas de um arquivo JSON.
@param {string} symbol - O símbolo do ativo financeiro para o qual deseja-se ler os dados das velas.
@param {string} interval - O intervalo de tempo das velas (por exemplo, '1m' para 1 minuto, '1h' para 1 hora, etc.).
@returns {Array} Um array contendo os dados das velas lidos do arquivo JSON.
*/
async function readCandles(symbol, interval) {

    const filePath = path.join(__dirname, '..', 'data', 'candlestick', `${symbol}-${interval}.json`);

    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err instanceof SyntaxError) {
            // Arquivo corrompido ou truncado — sobrescreve com array vazio
            // para que getCandles busque dados frescos na Binance
            await fs.writeFile(filePath, '[]', 'utf8').catch(() => {});
            const e = new Error(`Candle file corrupt, reset: ${filePath}`);
            e.code = 'ENOENT';
            throw e;
        }
        throw err;
    }
}

module.exports = readCandles;
