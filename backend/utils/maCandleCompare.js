'use strict';

/** Mesma tolerância de createMovingAverageFilter.js no frontend (±1,51%). */

function maAboveCandleClose(ma, candle) {
  const close = parseFloat(candle.close);
  const pct   = ((close - ma) / ma) * 100;
  return ma > close || pct <= 1.51;
}

function maBelowCandleClose(ma, candle) {
  const close = parseFloat(candle.close);
  const pct   = ((close - ma) / ma) * 100;
  return ma < close || pct >= -1.51;
}

function checkMaVsCandle(ma, candle, compare, candleField = 'close') {
  if (ma == null || !candle) return false;
  const ref = { close: parseFloat(candle[candleField] ?? candle.close) };
  return compare === 'above' || compare === 'a'
    ? maAboveCandleClose(ma, ref)
    : maBelowCandleClose(ma, ref);
}

module.exports = { maAboveCandleClose, maBelowCandleClose, checkMaVsCandle };
