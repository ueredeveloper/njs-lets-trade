'use strict';

const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { buildMaTimeSeries } = require('./movingAverage');
const {
  intervalMs,
  maValueAt,
  detectCrossAtPair,
} = require('../bot/ma-cross/strategyEngine');

const CANDLE_LIMIT = 3000;

function areConsecutiveCandles(prev, candle, intervalIv) {
  if (!prev || !candle) return false;
  const ms = intervalMs(intervalIv);
  return Number(candle.openTime) - Number(prev.openTime) === ms;
}

function candleClose(c) {
  return parseFloat(c.close);
}

function pctChange(entry, exit) {
  if (!entry || !Number.isFinite(entry)) return 0;
  return parseFloat((((exit - entry) / entry) * 100).toFixed(2));
}

function iso(ms) {
  return new Date(ms).toISOString();
}

/** Varre candles e devolve índices onde MA1 cruza MA2 na direção pedida. */
function findCrossIndices(candles, period1, period2, direction, intervalIv, tolerancePct = 0) {
  if (!candles?.length) return [];
  const series1 = buildMaTimeSeries(candles, period1);
  const series2 = buildMaTimeSeries(candles, period2);
  const warmup = Math.max(period1, period2);
  const hits = [];

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i];
    const prev = candles[i - 1];
    if (!areConsecutiveCandles(prev, candle, intervalIv)) continue;

    const ma1 = maValueAt(series1, candle.openTime);
    const ma2 = maValueAt(series2, candle.openTime);
    const prevMa1 = maValueAt(series1, prev.openTime);
    const prevMa2 = maValueAt(series2, prev.openTime);

    if (!detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, direction, tolerancePct)) continue;

    hits.push({
      index: i,
      openTime: Number(candle.openTime),
      closeTime: Number(candle.closeTime ?? (Number(candle.openTime) + intervalMs(intervalIv))),
      close: candleClose(candle),
      ma1,
      ma2,
    });
  }
  return hits;
}

function buildOccurrence(entry, exit) {
  return {
    startDate: iso(entry.openTime),
    endDate: iso(exit.openTime),
    entryPrice: entry.close,
    exitPrice: exit.close,
    entryMa1: entry.ma1 != null ? parseFloat(entry.ma1.toFixed(4)) : null,
    entryMa2: entry.ma2 != null ? parseFloat(entry.ma2.toFixed(4)) : null,
    exitMa1: exit.ma1 != null ? parseFloat(exit.ma1.toFixed(4)) : null,
    exitMa2: exit.ma2 != null ? parseFloat(exit.ma2.toFixed(4)) : null,
    appreciationPercent: pctChange(entry.close, exit.close),
  };
}

function analyseSameInterval(candles, period1, period2, intervalIv, tolerancePct) {
  const entries = findCrossIndices(candles, period1, period2, 'cross_up', intervalIv, tolerancePct);
  const exits = findCrossIndices(candles, period1, period2, 'cross_down', intervalIv, tolerancePct);
  const occurrences = [];
  let exitPtr = 0;

  for (const entry of entries) {
    while (exitPtr < exits.length && exits[exitPtr].openTime <= entry.openTime) {
      exitPtr++;
    }
    if (exitPtr >= exits.length) break;
    occurrences.push(buildOccurrence(entry, exits[exitPtr]));
    exitPtr++;
  }

  let openOccurrence = null;
  const lastEntry = entries[entries.length - 1];
  if (lastEntry) {
    const closed = occurrences.some((o) => o.startDate === iso(lastEntry.openTime));
    const hasExitAfter = exits.some((e) => e.openTime > lastEntry.openTime);
    if (!closed && hasExitAfter === false) {
      const lastCandle = candles[candles.length - 1];
      openOccurrence = {
        isOpen: true,
        startDate: iso(lastEntry.openTime),
        endDate: null,
        entryPrice: lastEntry.close,
        exitPrice: null,
        entryMa1: lastEntry.ma1 != null ? parseFloat(lastEntry.ma1.toFixed(4)) : null,
        entryMa2: lastEntry.ma2 != null ? parseFloat(lastEntry.ma2.toFixed(4)) : null,
        exitMa1: null,
        exitMa2: null,
        appreciationPercent: pctChange(lastEntry.close, candleClose(lastCandle)),
      };
    }
  }

  return { occurrences, openOccurrence };
}

function analyseDifferentIntervals(entryCandles, exitCandles, period1, period2, entryIv, exitIv, tolerancePct) {
  const entries = findCrossIndices(entryCandles, period1, period2, 'cross_up', entryIv, tolerancePct);
  const exits = findCrossIndices(exitCandles, period1, period2, 'cross_down', exitIv, tolerancePct);
  const occurrences = [];
  let exitPtr = 0;

  for (const entry of entries) {
    while (exitPtr < exits.length && exits[exitPtr].openTime <= entry.openTime) {
      exitPtr++;
    }
    if (exitPtr >= exits.length) break;
    occurrences.push(buildOccurrence(entry, exits[exitPtr]));
    exitPtr++;
  }

  let openOccurrence = null;
  const lastEntry = entries[entries.length - 1];
  if (lastEntry) {
    const alreadyClosed = occurrences.some((o) => o.startDate === iso(lastEntry.openTime));
    const hasLaterExit = exits.some((e) => e.openTime > lastEntry.openTime);
    if (!alreadyClosed && !hasLaterExit) {
      const lastExitCandle = exitCandles[exitCandles.length - 1];
      openOccurrence = {
        isOpen: true,
        startDate: iso(lastEntry.openTime),
        endDate: null,
        entryPrice: lastEntry.close,
        exitPrice: null,
        entryMa1: lastEntry.ma1 != null ? parseFloat(lastEntry.ma1.toFixed(4)) : null,
        entryMa2: lastEntry.ma2 != null ? parseFloat(lastEntry.ma2.toFixed(4)) : null,
        exitMa1: null,
        exitMa2: null,
        appreciationPercent: pctChange(lastEntry.close, candleClose(lastExitCandle)),
      };
    }
  }

  return { occurrences, openOccurrence };
}

/**
 * Estatísticas de ciclos MA: entrada no cruzamento MA1↑MA2, saída no cruzamento MA1↓MA2.
 *
 * @param {string} symbol
 * @param {object} [options]
 * @param {string} [options.entryInterval='15m']
 * @param {string} [options.exitInterval]  — padrão = entryInterval
 * @param {number} [options.period1=9]
 * @param {number} [options.period2=21]
 * @param {number} [options.tolerancePct=0]
 * @param {string|null} [options.source]
 */
async function analyseMaCrossStats(symbol, options = {}) {
  const {
    entryInterval = '15m',
    exitInterval = entryInterval,
    period1 = 9,
    period2 = 21,
    tolerancePct = 0,
    source = null,
  } = options;

  const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
  const sameIv = entryInterval === exitInterval;

  const [entryResult, exitResult] = await Promise.allSettled([
    fetchCandles(symbol, entryInterval, CANDLE_LIMIT),
    sameIv ? Promise.resolve(null) : fetchCandles(symbol, exitInterval, CANDLE_LIMIT),
  ]);

  if (entryResult.status === 'rejected') throw entryResult.reason;
  const entryCandles = entryResult.value;
  if (!entryCandles?.length) throw new Error(`sem candles para ${symbol} ${entryInterval}`);

  let exitCandles = entryCandles;
  if (!sameIv) {
    if (exitResult.status === 'rejected') throw exitResult.reason;
    exitCandles = exitResult.value;
    if (!exitCandles?.length) throw new Error(`sem candles para ${symbol} ${exitInterval}`);
  }

  const { occurrences, openOccurrence } = sameIv
    ? analyseSameInterval(entryCandles, period1, period2, entryInterval, tolerancePct)
    : analyseDifferentIntervals(
      entryCandles, exitCandles, period1, period2, entryInterval, exitInterval, tolerancePct,
    );

  const total = occurrences.length;
  const avgAppreciationPercent = total > 0
    ? parseFloat((occurrences.reduce((s, o) => s + o.appreciationPercent, 0) / total).toFixed(2))
    : 0;

  return {
    symbol,
    entryInterval,
    exitInterval,
    period1,
    period2,
    entryLabel: `EMA${period1} cruza ↑ EMA${period2}`,
    exitLabel: `EMA${period1} cruza ↓ EMA${period2}`,
    totalCandles: entryCandles.length,
    totalExitCandles: exitCandles.length,
    totalOccurrences: total,
    avgAppreciationPercent,
    occurrences,
    openOccurrence,
  };
}

module.exports = analyseMaCrossStats;
