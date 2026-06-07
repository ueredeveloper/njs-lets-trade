const fs   = require('node:fs/promises');
const path = require('path');

const BASE = path.join(__dirname, '..', 'data', 'candlestick');

// Descarta candles cujo close desvia mais de 5x a mediana do lote.
// Protege contra spikes isolados que corrompem RSI e estatísticas.
function filterOutliers(candles) {
  if (candles.length < 10) return candles;
  const closes = candles.map(c => parseFloat(c.close)).sort((a, b) => a - b);
  const median = closes[Math.floor(closes.length / 2)];
  return candles.filter(c => {
    const ratio = parseFloat(c.close) / median;
    return ratio >= 0.2 && ratio <= 5;
  });
}

// Fire-and-forget: rejeições são logadas mas nunca crash o processo
module.exports = function writeCandles(symbol, interval, candles) {
  const filePath = path.join(BASE, `${symbol}-${interval}.json`);
  const clean = filterOutliers(candles);
  if (clean.length < candles.length) {
    console.warn(`[writeCandles] ${symbol}-${interval}: descartados ${candles.length - clean.length} candle(s) com spike de preço`);
  }
  fs.writeFile(filePath, JSON.stringify(clean)).catch(err =>
    console.error(`[writeCandles] ${symbol}-${interval}:`, err.message)
  );
};
