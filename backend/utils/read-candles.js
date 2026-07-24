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
            // JSON inválido — pode ser corrupção real ou uma leitura no meio de uma escrita
            // concorrente (candleDiskWarmup/getCandles gravam o mesmo arquivo). Não sobrescreve
            // o arquivo aqui: quem trata ENOENT (getCandles, getGateCandles) já busca dados
            // frescos na API e grava o array completo — sobrescrever com [] nesta função apagaria
            // o histórico salvo por causa de uma corrida passageira, sem nunca reidratar os dados.
            const e = new Error(`Candle file corrupt or mid-write: ${filePath}`);
            e.code = 'ENOENT';
            throw e;
        }
        throw err;
    }
}

module.exports = readCandles;
