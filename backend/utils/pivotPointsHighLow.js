'use strict';

/**
 * Pivot Points High/Low, estilo TradingView: marca cada pivô de topo/fundo
 * confirmado (leftBars candles antes e rightBars candles depois, todos já
 * fechados) — um marcador por pivô, sem agrupar em zonas. Compare com
 * detectSupportResistance (backend/utils/supportResistance.js), que agrupa
 * pivôs próximos em zonas de suporte/resistência com contagem de toques.
 */
function detectPivotPointsHighLow(candles, opts = {}) {
  const leftBars = opts.leftBars ?? 10;
  const rightBars = opts.rightBars ?? 10;

  if (!Array.isArray(candles) || candles.length < leftBars + rightBars + 1) return [];

  const highs = candles.map(c => parseFloat(c.high));
  const lows = candles.map(c => parseFloat(c.low));

  const pivots = [];
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const windowHighs = highs.slice(i - leftBars, i + rightBars + 1);
    if (highs[i] === Math.max(...windowHighs)) {
      pivots.push({ type: 'high', price: highs[i], time: Number(candles[i].openTime) });
    }
    const windowLows = lows.slice(i - leftBars, i + rightBars + 1);
    if (lows[i] === Math.min(...windowLows)) {
      pivots.push({ type: 'low', price: lows[i], time: Number(candles[i].openTime) });
    }
  }

  return pivots.sort((a, b) => a.time - b.time);
}

module.exports = { detectPivotPointsHighLow };
