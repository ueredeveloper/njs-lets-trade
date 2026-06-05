const fs   = require('node:fs/promises');
const path = require('path');

const BASE = path.join(__dirname, '..', 'data', 'candlestick');

// Fire-and-forget: rejeições são logadas mas nunca crash o processo
module.exports = function writeCandles(symbol, interval, candles) {
  const filePath = path.join(BASE, `${symbol}-${interval}.json`);
  fs.writeFile(filePath, JSON.stringify(candles)).catch(err =>
    console.error(`[writeCandles] ${symbol}-${interval}:`, err.message)
  );
};
