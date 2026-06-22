'use strict';

/**
 * Sugere o nível de RSI de saída (ex.: > 70 em 15m) a partir do histórico.
 *
 * Para cada entrada simulada, mede o pico de RSI no intervalo de saída durante o trade
 * e compara PnL médio ao sair em vários limiares (65–85).
 */

const {
  computeRsiSeries, maSnapAt, exitRsiAt,
} = require('./extensionBacktest');

/** Evita dependência circular com strategyEngine no load do módulo. */
function engine() {
  return require('./strategyEngine');
}

const DEFAULT_OPTS = {
  defaultExitRsi: 70,
  minExitRsi:     65,
  maxExitRsi:     85,
  minTrades:      3,
  minHitRate:     0.4,
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function hitRate(peaks, threshold) {
  if (!peaks.length) return 0;
  return peaks.filter(p => p >= threshold).length / peaks.length;
}

/** Simula trade a partir da entrada; retorna pico RSI e PnL ao sair em cada limiar. */
function simulateTradePeaks(entryIdx, entrySeries, exitSeries, cMap, config, adaptiveDips, entryKind = null) {
  const { getStopLossMa, evaluateExit } = engine();
  const buyPrice = entrySeries[entryIdx].close;
  let peakExitRsi = 0;
  const byThreshold = {};

  for (let j = entryIdx + 1; j < entrySeries.length; j++) {
    const { openTime, close } = entrySeries[j];
    const exitRsiVal = exitRsiAt(exitSeries, openTime);
    if (exitRsiVal != null) peakExitRsi = Math.max(peakExitRsi, exitRsiVal);

    const maSnap     = maSnapAt(cMap, config, openTime);
    const stopLossMa = getStopLossMa(maSnap, config);
    const exitEval   = evaluateExit({
      close, exitRsi: exitRsiVal, stopLossMa, maSnap, adaptiveDips, config, entryKind,
    });
    if (exitEval.exit && exitEval.reason !== 'rsi') {
      const pnlPct = ((close - buyPrice) / buyPrice) * 100;
      return {
        peakExitRsi: parseFloat(peakExitRsi.toFixed(2)),
        exitReason: exitEval.reason,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        byThreshold,
        stopped: true,
      };
    }

    if (exitRsiVal != null) {
      for (let t = DEFAULT_OPTS.minExitRsi; t <= DEFAULT_OPTS.maxExitRsi; t++) {
        if (byThreshold[t] != null) continue;
        if (exitRsiVal > t) {
          const pnlPct = ((close - buyPrice) / buyPrice) * 100;
          byThreshold[t] = {
            reached: true,
            pnlPct: parseFloat(pnlPct.toFixed(2)),
            exitRsi: exitRsiVal,
          };
        }
      }
    }
  }

  const last = entrySeries[entrySeries.length - 1];
  const pnlPct = ((last.close - buyPrice) / buyPrice) * 100;
  return {
    peakExitRsi: parseFloat(peakExitRsi.toFixed(2)),
    exitReason: 'open',
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    byThreshold,
    stopped: false,
  };
}

function findCandleIdx(candles, openTime) {
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].openTime <= openTime) idx = i;
    else break;
  }
  return idx;
}

/** Trades simulados com entradas pelo caminho MA (regra 2). */
function collectMaTrades(cMap, config) {
  const { collectEntryPathTrades } = require('./entrySuggestShared');
  const em = config.entryMa ?? {};
  const cfg = {
    ...config,
    entryRsiPath: { enabled: false },
    entryMa: { ...em, enabled: true },
    entryRsi: config.entryRsi ?? {
      interval: em.interval ?? '1h',
      period: 14,
      operator: '<',
      value: 30,
    },
    extension: { ...(config.extension ?? {}), enabled: false },
    maFilters: [],
  };

  const maIv = em.interval ?? '1h';
  const scanCandles = cMap[maIv];
  const exitCandles = cMap[config.exitRsi?.interval];
  if (!scanCandles?.length || !exitCandles?.length) return [];

  const exitSeries = computeRsiSeries(exitCandles, config.exitRsi.period);
  const pseudoEntrySeries = scanCandles.map(c => ({
    openTime: c.openTime,
    close: c.close,
    rsi: 0,
  }));

  const { computeAdaptiveDips } = engine();
  const adaptiveDips = computeAdaptiveDips(cMap, cfg);
  const pathTrades = collectEntryPathTrades(cMap, cfg, 'ma');
  const trades = [];

  for (const pt of pathTrades) {
    const idx = findCandleIdx(scanCandles, pt.entryTime);
    if (idx < 0) continue;
    trades.push({
      entryTime: pt.entryTime,
      ...simulateTradePeaks(idx, pseudoEntrySeries, exitSeries, cMap, cfg, adaptiveDips, 'ma'),
    });
  }
  return trades;
}

function collectTrades(cMap, config, opts = {}) {
  const useMa = opts.entryPath === 'ma'
    || (config.entryMa?.enabled === true && config.entryRsiPath?.enabled === false);
  if (useMa) return collectMaTrades(cMap, config);

  const { checkRsi, evaluateEntry, computeAdaptiveDips } = engine();
  const entryCandles = cMap[config.entryRsi.interval];
  const exitCandles  = cMap[config.exitRsi.interval];
  if (!entryCandles?.length) return [];

  const entrySeries = computeRsiSeries(entryCandles, config.entryRsi.period);
  const exitSeries  = config.entryRsi.interval === config.exitRsi.interval &&
    config.entryRsi.period === config.exitRsi.period
    ? entrySeries
    : computeRsiSeries(exitCandles, config.exitRsi.period);

  const adaptiveDips = computeAdaptiveDips(cMap, config);
  const trades       = [];

  for (let i = 0; i < entrySeries.length; i++) {
    const { openTime, close, rsi: entryRsi } = entrySeries[i];
    if (!checkRsi(entryRsi, config.entryRsi)) continue;

    const maSnap = maSnapAt(cMap, config, openTime);
    const check  = evaluateEntry({
      entryRsi, close, entryTimeMs: openTime, config, maSnap, adaptiveDips, cMap,
    });
    if (!check.allowed) continue;

    trades.push({
      entryTime: openTime,
      ...simulateTradePeaks(i, entrySeries, exitSeries, cMap, config, adaptiveDips),
    });
  }

  return trades;
}

function sweepBestThreshold(trades, opts) {
  let best = { threshold: opts.defaultExitRsi, avgPnl: -Infinity, hitRate: 0 };

  for (let t = opts.minExitRsi; t <= opts.maxExitRsi; t++) {
    const reached = trades.filter(tr => tr.byThreshold[t]?.reached);
    const rate    = reached.length / trades.length;
    if (rate < opts.minHitRate) continue;
    const avg = reached.reduce((s, tr) => s + tr.byThreshold[t].pnlPct, 0) / reached.length;
    if (avg > best.avgPnl) {
      best = {
        threshold: t,
        avgPnl: parseFloat(avg.toFixed(2)),
        hitRate: parseFloat((rate * 100).toFixed(1)),
      };
    }
  }
  return best;
}

function suggestExitRsi(cMap, config, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const exitIv = config.exitRsi?.interval ?? '15m';
  const exitP  = config.exitRsi?.period ?? 14;

  const trades = collectTrades(cMap, config, opts);
  if (trades.length < o.minTrades) {
    return {
      suggestedExitRsi: o.defaultExitRsi,
      usedDefault: true,
      reason: trades.length ? 'poucos_trades' : 'sem_trades',
      tradeCount: trades.length,
      exitInterval: exitIv,
      exitPeriod: exitP,
    };
  }

  const peaks     = trades.map(t => t.peakExitRsi).sort((a, b) => a - b);
  const medianPeak = percentile(peaks, 0.5);
  const avgPeak    = parseFloat((peaks.reduce((s, p) => s + p, 0) / peaks.length).toFixed(1));
  const p75Peak    = percentile(peaks, 0.75);

  const sweep = sweepBestThreshold(trades, o);

  // Mediana do pico − 1 (sair um pouco antes do topo típico), ajustado pelo sweep de PnL
  let fromMedian = Math.round(medianPeak - 1);
  const rate75 = hitRate(peaks, 75);
  const rate70 = hitRate(peaks, 70);

  if (rate75 < 0.35) fromMedian = Math.min(fromMedian, 72);
  if (rate70 > 0.8 && medianPeak < 73) fromMedian = Math.max(o.minExitRsi, Math.round(medianPeak - 2));

  let suggested = sweep.avgPnl > -Infinity
    ? Math.round((sweep.threshold + fromMedian) / 2)
    : fromMedian;

  suggested = Math.max(o.minExitRsi, Math.min(o.maxExitRsi, suggested));

  const exitCandles = cMap[exitIv];
  const exitSeries  = computeRsiSeries(exitCandles ?? [], exitP);
  const rsiNow      = exitSeries.length ? exitSeries[exitSeries.length - 1].rsi : null;

  return {
    suggestedExitRsi: suggested,
    usedDefault: false,
    reason: null,
    tradeCount: trades.length,
    exitInterval: exitIv,
    exitPeriod: exitP,
    medianPeakRsi: medianPeak,
    avgPeakRsi: avgPeak,
    p75PeakRsi: p75Peak,
    hitRate70: parseFloat((hitRate(peaks, 70) * 100).toFixed(1)),
    hitRate75: parseFloat((hitRate(peaks, 75) * 100).toFixed(1)),
    hitRate80: parseFloat((hitRate(peaks, 80) * 100).toFixed(1)),
    sweepBestThreshold: sweep.avgPnl > -Infinity ? sweep.threshold : null,
    sweepAvgPnlPct: sweep.avgPnl > -Infinity ? sweep.avgPnl : null,
    sweepHitRatePct: sweep.hitRate || null,
    rsiNow,
    wouldExitNow: rsiNow != null && rsiNow > suggested,
    recommendation: rate75 >= 0.5
      ? 'chega_alto'
      : rate70 >= 0.6
        ? 'garantir_cedo'
        : 'moderado',
  };
}

function buildExitRsiReport(cMap, config, opts) {
  return suggestExitRsi(cMap, config, opts);
}

module.exports = {
  suggestExitRsi,
  buildExitRsiReport,
  collectTrades,
  collectMaTrades,
  simulateTradePeaks,
  hitRate,
  DEFAULT_OPTS,
};
