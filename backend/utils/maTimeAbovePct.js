'use strict';

const { SMA } = require('technicalindicators');

/**
 * % de velas com close > SMA(period) no histórico carregado.
 * @returns {{ pctAboveMa: number, met: number, total: number } | null}
 */
function computeMaTimeAbovePct(candles, period = 50) {
  if (!Array.isArray(candles) || candles.length < period) return null;

  const closes = candles.map(c => parseFloat(c.close));
  const maArr  = SMA.calculate({ values: closes, period });
  if (!maArr.length) return null;

  let met = 0;
  for (let i = 0; i < maArr.length; i++) {
    if (closes[period - 1 + i] > maArr[i]) met++;
  }

  const total = maArr.length;
  return {
    pctAboveMa: parseFloat(((met / total) * 100).toFixed(1)),
    met,
    total,
  };
}

module.exports = { computeMaTimeAbovePct };
