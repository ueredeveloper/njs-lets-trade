const fs = require('node:fs/promises');
const path = require('path');

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
