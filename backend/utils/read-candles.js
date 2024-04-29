const fs = require('node:fs/promises');
const path = require('path');

/**

Lê os dados das velas de um arquivo JSON.
@param {string} symbol - O símbolo do ativo financeiro para o qual deseja-se ler os dados das velas.
@param {string} interval - O intervalo de tempo das velas (por exemplo, '1m' para 1 minuto, '1h' para 1 hora, etc.).
@returns {Array} Um array contendo os dados das velas lidos do arquivo JSON.
*/
async function readCandles(symbol, interval) {

    const filePath = path.join(__dirname, '..', 'data', `${symbol}-${interval}.json`);

    try {
        const data = await fs.readFile(filePath, 'utf8');
        const dataArray = JSON.parse(data); // Parse the JSON string into an array
        return dataArray;
    } catch (err) {
        console.error('Error reading file:', err);
        throw err;
    }
}

module.exports = readCandles;
