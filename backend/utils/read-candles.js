const fs = require('node:fs/promises');

async function readCandles(symbol, interval, callback) {
    console.log('read candles', symbol, interval)

    let path = `./backend/data/${symbol}-${interval}.json`;

    console.log(path)

    fs.readFile(path, 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            callback(err, null);
            return;
        }
        try {
            const dataArray = JSON.parse(data); // Parse the JSON string into an array
            callback(null, dataArray);
        } catch (parseErr) {
            console.error('Error parsing JSON:', parseErr);
            callback(parseErr, null);
        }
    });
}
module.exports = readCandles;