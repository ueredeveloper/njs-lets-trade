const fs = require('node:fs/promises');
async function writeCandles(symbol, interval, candles) {

  fs.writeFile(`./backend/data/${symbol}-${interval}.json`, JSON.stringify(candles), (err) => {
    if (err) throw err;
  })
}
module.exports = writeCandles;
