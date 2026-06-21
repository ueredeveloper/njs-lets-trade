'use strict';

/**
 * Utilitários compartilhados para sugestão de parâmetros de entrada (RSI / MA).
 */

const {
  computeAdaptiveDips,
  resolveEntrySignal,
  getEntryScanInterval,
  entryRsiPathActive,
  entryMaPathActive,
  checkRsi,
  maKey,
} = require('./strategyEngine');
const {
  computeRsiSeries,
  exitRsiAt,
  simulateForwardTrade,
} = require('./extensionBacktest');
const { maSnapAt } = require('./amapBacktest');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function rsiAt(rsiSeries, openTime) {
  let best = null;
  for (const point of rsiSeries) {
    if (point.openTime <= openTime) best = point.rsi;
    else break;
  }
  return best;
}

function candleCtxAt(cMap, interval, openTime) {
  const candles = (cMap[interval] ?? []).filter(c => c.openTime <= openTime);
  if (!candles.length) return null;
  const n = candles.length;
  return {
    close: candles[n - 1].close,
    low:   candles[n - 1].low,
    prevClose: n >= 2 ? candles[n - 2].close : null,
    openTime: candles[n - 1].openTime,
  };
}

function buildEntryScanPoints(cMap, config) {
  const scanIv      = getEntryScanInterval(config);
  const scanCandles = cMap[scanIv] ?? [];
  if (!scanCandles.length) return { scanIv, points: [] };

  const entryRsiSeries = computeRsiSeries(
    cMap[config.entryRsi.interval] ?? scanCandles,
    config.entryRsi.period,
  );
  const maPathRsiSeries = entryMaPathActive(config) && config.entryMa.requireRsi
    ? computeRsiSeries(
      cMap[config.entryMa.entryRsi.interval] ?? scanCandles,
      config.entryMa.entryRsi.period,
    )
    : null;

  const minStart = Math.max(
    entryRsiPathActive(config) ? config.entryRsi.period : 0,
    entryMaPathActive(config) ? config.entryMa.period : 0,
    1,
  );

  const points = [];
  for (let i = minStart; i < scanCandles.length; i++) {
    const c = scanCandles[i];
    const rsiCtx = {
      close: c.close,
      low:   c.low,
      prevClose: i > 0 ? scanCandles[i - 1].close : null,
    };
    const maIv  = entryMaPathActive(config) ? config.entryMa.interval : scanIv;
    const maCtx = candleCtxAt(cMap, maIv, c.openTime) ?? rsiCtx;

    points.push({
      openTime: c.openTime,
      close: c.close,
      entryRsi: rsiAt(entryRsiSeries, c.openTime),
      maPathRsi: maPathRsiSeries ? rsiAt(maPathRsiSeries, c.openTime) : null,
      rsiCtx,
      maCtx,
    });
  }
  return { scanIv, points, entryRsiSeries };
}

function findSeriesIdx(series, openTime) {
  let idx = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i].openTime <= openTime) idx = i;
    else break;
  }
  return idx;
}

/** Coleta trades simulados para um caminho de entrada (rsi | ma). */
function collectEntryPathTrades(cMap, config, pathKind) {
  const cfg = {
    ...config,
    entryRsiPath: { enabled: pathKind === 'rsi' },
    entryMa: { ...config.entryMa, enabled: pathKind === 'ma' },
  };

  if (pathKind === 'rsi' && !entryRsiPathActive(cfg)) return [];
  if (pathKind === 'ma' && !entryMaPathActive(cfg)) return [];

  const entryCandles = cMap[cfg.entryRsi.interval];
  const exitCandles  = cMap[cfg.exitRsi.interval];
  if (!entryCandles?.length || !exitCandles?.length) return [];

  const { points, entryRsiSeries } = buildEntryScanPoints(cMap, cfg);
  const exitSeries = cfg.entryRsi.interval === cfg.exitRsi.interval &&
    cfg.entryRsi.period === cfg.exitRsi.period
    ? entryRsiSeries
    : computeRsiSeries(exitCandles, cfg.exitRsi.period);

  const adaptiveDips = computeAdaptiveDips(cMap, cfg);
  const trades       = [];
  const cooldownMs   = 6 * 3_600_000;
  let lastEntryTime  = 0;

  for (const pt of points) {
    const resolved = resolveEntrySignal({
      entryRsi: pt.entryRsi,
      maPathRsi: pt.maPathRsi,
      rsiCtx: pt.rsiCtx,
      maCtx: pt.maCtx,
      close: pt.close,
      low: pt.rsiCtx.low,
      prevClose: pt.rsiCtx.prevClose,
      entryTimeMs: pt.openTime,
      config: cfg,
      maSnap: maSnapAt(cMap, cfg, pt.openTime),
      adaptiveDips,
      cMap,
    });

    if (!resolved.allowed || resolved.entryKind !== pathKind) continue;
    if (pt.openTime - lastEntryTime < cooldownMs) continue;

    const entryIdx = findSeriesIdx(entryRsiSeries, pt.openTime);
    if (entryIdx < 0) continue;

    const forward = simulateForwardTrade(entryIdx, entryRsiSeries, exitSeries, cMap, cfg, adaptiveDips);
    trades.push({
      entryTime: pt.openTime,
      entryPrice: pathKind === 'ma' ? pt.maCtx.close : pt.close,
      entryRsi: pt.entryRsi,
      entryKind: pathKind,
      ...forward,
    });
    lastEntryTime = pt.openTime;
  }

  return trades;
}

function scoreTrades(trades) {
  if (!trades.length) {
    return {
      tradeCount: 0,
      avgPnl: null,
      medianPnl: null,
      winRate: null,
      wins: 0,
    };
  }
  const pnls = trades.map(t => t.pnlPct).sort((a, b) => a - b);
  const wins = pnls.filter(p => p > 0).length;
  return {
    tradeCount: trades.length,
    avgPnl: parseFloat((pnls.reduce((s, p) => s + p, 0) / pnls.length).toFixed(2)),
    medianPnl: percentile(pnls, 0.5),
    winRate: parseFloat(((wins / pnls.length) * 100).toFixed(1)),
    wins,
  };
}

/** Valores candidatos em torno do âncora (ex.: 30 → 22,24,…,38). */
function buildRsiCandidates(anchor, operator, opts = {}) {
  const o = {
    step: 2,
    span: 8,
    minValue: 15,
    maxValue: 45,
    ...opts,
  };
  const values = new Set([anchor]);
  for (let d = -o.span; d <= o.span; d += o.step) {
    values.add(anchor + d);
  }
  let list = [...values].filter(v => v >= o.minValue && v <= o.maxValue).sort((a, b) => a - b);
  if (operator === '>') list = list.reverse();
  return list;
}

function buildToleranceCandidates(anchor, opts = {}) {
  const o = { step: 0.25, span: 1.0, min: 0.1, max: 3, ...opts };
  const values = new Set([anchor]);
  for (let d = -o.span; d <= o.span + 0.001; d += o.step) {
    values.add(parseFloat((anchor + d).toFixed(2)));
  }
  return [...values]
    .filter(v => v >= o.min && v <= o.max)
    .sort((a, b) => a - b);
}

function pickBestSweep(sweep, anchorKey, anchorValue, opts = {}) {
  const o = { minTrades: 3, ...opts };
  const viable = sweep.filter(s => s.tradeCount >= o.minTrades && s.avgPnl != null);
  if (!viable.length) {
    const anchorRow = sweep.find(s => s[anchorKey] === anchorValue) ?? sweep[0];
    return {
      best: anchorRow,
      usedDefault: true,
      reason: viable.length ? 'poucos_trades' : 'sem_trades',
    };
  }

  viable.sort((a, b) => {
    if (b.avgPnl !== a.avgPnl) return b.avgPnl - a.avgPnl;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.tradeCount - a.tradeCount;
  });

  return { best: viable[0], usedDefault: false, reason: null };
}

module.exports = {
  percentile,
  buildEntryScanPoints,
  collectEntryPathTrades,
  scoreTrades,
  buildRsiCandidates,
  buildToleranceCandidates,
  pickBestSweep,
  checkRsi,
  maKey,
};
