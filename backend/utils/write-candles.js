const fs = require('node:fs/promises');
async function writeCandles(symbol, interval, candles) {
  try {
    
    await fs.writeFile(`./backend/data/${symbol}-${interval}.json`,  JSON.stringify(candles));
  } catch (err) {
    console.log(err);
  }
}
module.exports = writeCandles;
