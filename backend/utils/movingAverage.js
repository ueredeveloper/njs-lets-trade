'use strict';

const { EMA } = require('technicalindicators');

function candleClose(c) {
  return parseFloat(c.close);
}

/** Série EMA completa a partir de closes numéricos. */
function calculateMa(values, period) {
  if (!values?.length || values.length < period) return [];
  return EMA.calculate({ values, period });
}

/** Último valor EMA a partir de candles. */
function computeMa(candles, period) {
  if (!candles?.length || candles.length < period) return null;
  const arr = calculateMa(candles.map(candleClose), period);
  return arr.length ? arr[arr.length - 1] : null;
}

/** [{ openTime, ma }] — alinhado ao candle de referência (índice period-1+i). */
function buildMaTimeSeries(candles, period) {
  if (!candles?.length || candles.length < period) return [];
  const maArr = calculateMa(candles.map(candleClose), period);
  return maArr.map((ma, i) => ({
    openTime: candles[period - 1 + i].openTime,
    ma,
  }));
}

/** Alias usado em bots/backtests AMAP. */
function computeMaSeries(candles, period) {
  return buildMaTimeSeries(candles, period);
}

function maLabel(period, interval) {
  return `EMA${period}(${interval})`;
}

module.exports = {
  calculateMa,
  computeMa,
  buildMaTimeSeries,
  computeMaSeries,
  maLabel,
};
