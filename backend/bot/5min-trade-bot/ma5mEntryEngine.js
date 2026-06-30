'use strict';

/**
 * Entrada MA50 5m (contexto: acima MA50 1h) + sugestão de RSI de saída por histórico.
 */

const ti = require('technicalindicators');
const { scoreTrades, pickBestSweep, percentile } = require('../amap/entrySuggestShared');
const { buildMaSeries, maAt, maThreshold, normalizeMaFilters } = require('./maFilter');
const { computeRsiSeries, RSI_PERIOD } = require('./suggest5mRsi');
const { normalizeEntryPaths, hasEntryPath } = require('./entryPathsConfig');

const MA5M_PERIOD   = 50;
const MA1H_PERIOD   = 50;
const MA1H_INTERVAL = '1h';
const MAX_FORWARD   = 288; // ~24h em 5m
const EXIT_MIN      = 65;
const EXIT_MAX      = 85;
const EXIT_STEP     = 1;
const COOLDOWN_BARS = 24; // 2h

function checkMa50_5mTrigger({ close, low, prevClose, ma, trigger = 'touch', tolerancePct = 0.5 }) {
  if (ma == null || close == null) return { triggered: false, reason: 'ma_indisponivel' };

  const tol = Math.max(0, Number(tolerancePct) || 0) / 100;

  if (trigger === 'cross_up') {
    if (prevClose != null && prevClose < ma && close >= ma) {
      return { triggered: true, ma, trigger };
    }
    return { triggered: false, reason: 'sem_cruzamento', ma, trigger };
  }

  const nearClose = Math.abs(close - ma) / ma <= tol;
  const wickTouch = low != null && low <= ma * (1 + tol) && close >= ma * (1 - tol * 2);
  if (nearClose || wickTouch) return { triggered: true, ma, trigger };

  return { triggered: false, reason: 'sem_toque', ma, trigger };
}

function isAboveMa50_1h(price, openTime, ma1hSeries, tolerancePct = 0) {
  const ma = maAt(ma1hSeries, openTime);
  if (ma == null) return { ok: false, ma: null };
  const threshold = maThreshold(ma, 'above', tolerancePct);
  return { ok: price >= threshold, ma, threshold };
}

function buildExitCandidates(anchor = 73) {
  const values = new Set();
  for (let v = EXIT_MIN; v <= EXIT_MAX; v += EXIT_STEP) values.add(v);
  if (Number.isFinite(anchor)) values.add(Math.round(anchor));
  return [...values].sort((a, b) => a - b);
}

/**
 * Episódios: toque MA50 5m com preço acima MA50 1h (tolerância do filtro).
 */
function collectMa5mTouchEpisodes(candles5m, candles1h, maFilters, trigger = 'touch') {
  if (!candles5m?.length || candles5m.length < MA5M_PERIOD + 5) {
    return { episodes: [], ma5mSeries: [], rsiSeries: [] };
  }

  const maCfg = normalizeMaFilters(maFilters);
  const active1h = maCfg.enabled
    ? maCfg.filters.find(f => f.enabled && f.mode === 'above')
    : { period: MA1H_PERIOD, interval: MA1H_INTERVAL, tolerancePct: 0 };
  const tol1h = active1h?.tolerancePct ?? 0;

  const ma5mSeries = buildMaSeries(candles5m, MA5M_PERIOD);
  const ma1hSeries = candles1h?.length >= MA1H_PERIOD
    ? buildMaSeries(candles1h, MA1H_PERIOD)
    : [];
  const rsiSeries  = computeRsiSeries(candles5m, RSI_PERIOD);

  const episodes = [];
  let lastEntryIdx = -COOLDOWN_BARS;

  for (let i = MA5M_PERIOD; i < candles5m.length; i++) {
    const c    = candles5m[i];
    const prev = candles5m[i - 1];
    const ma5m = maAt(ma5mSeries, c.openTime);
    if (ma5m == null) continue;

    const ctx1h = isAboveMa50_1h(c.close, c.openTime, ma1hSeries, tol1h);
    if (!ctx1h.ok) continue;

    const touch = checkMa50_5mTrigger({
      close: c.close,
      low: c.low,
      prevClose: prev.close,
      ma: ma5m,
      trigger,
      tolerancePct: 0.5,
    });
    if (!touch.triggered) continue;
    if (i - lastEntryIdx < COOLDOWN_BARS) continue;

    const rsiPt = rsiSeries.find(p => p.openTime === c.openTime);
    const forward = [];
    for (let j = i + 1; j < Math.min(candles5m.length, i + 1 + MAX_FORWARD); j++) {
      const fc = candles5m[j];
      const fr = rsiSeries.find(p => p.openTime === fc.openTime);
      if (fr?.rsi != null) forward.push({ openTime: fc.openTime, close: fc.close, rsi: fr.rsi });
    }

    episodes.push({
      entryIdx: i,
      entryTime: c.openTime,
      entryPrice: c.close,
      entryRsi: rsiPt?.rsi ?? null,
      ma5m,
      peakRsi: forward.reduce((m, p) => Math.max(m, p.rsi ?? 0), rsiPt?.rsi ?? 0),
      forward,
    });
    lastEntryIdx = i;
  }

  return { episodes, ma5mSeries, ma1hSeries, rsiSeries, episodeCount: episodes.length };
}

function simulateMa5mExitEpisodes(episodes, exitRsi) {
  const trades = [];
  for (const ep of episodes) {
    let exitPrice = null;
    let exitRsiVal = null;
    let barsHeld = 0;

    for (const pt of ep.forward) {
      barsHeld++;
      if (pt.rsi > exitRsi) {
        exitPrice  = pt.close;
        exitRsiVal = pt.rsi;
        break;
      }
    }
    if (exitPrice == null && ep.forward.length) {
      const last = ep.forward[ep.forward.length - 1];
      exitPrice  = last.close;
      exitRsiVal = last.rsi;
    }
    if (exitPrice == null) continue;

    const pnlPct = ep.entryPrice > 0
      ? parseFloat(((exitPrice - ep.entryPrice) / ep.entryPrice * 100).toFixed(2))
      : 0;
    trades.push({
      pnlPct,
      peakExitRsi: ep.peakRsi,
      exitRsi: exitRsiVal,
      barsHeld,
      hitTarget: exitRsiVal != null && exitRsiVal > exitRsi,
    });
  }
  return trades;
}

function suggestMa5mExitRsi(candles5m, candles1h, maFilters, trigger = 'touch', anchorExit = 73) {
  const { episodes, episodeCount } = collectMa5mTouchEpisodes(
    candles5m, candles1h, maFilters, trigger,
  );

  if (!episodes.length) {
    return {
      ok: false,
      reason: 'poucos_episodios',
      episodeCount: 0,
      suggestedExitRsi: anchorExit,
      label: 'MA50 5m',
    };
  }

  const peaks = episodes.map(e => e.peakRsi).filter(Number.isFinite).sort((a, b) => a - b);
  const medianPeak = percentile(peaks, 0.5);
  const p75Peak    = percentile(peaks, 0.75);

  const sweep = [];
  for (const exitRsi of buildExitCandidates(anchorExit)) {
    const trades = simulateMa5mExitEpisodes(episodes, exitRsi);
    const stats  = scoreTrades(trades);
    const hitRate = trades.length
      ? parseFloat((trades.filter(t => t.hitTarget).length / trades.length * 100).toFixed(1))
      : 0;
    sweep.push({
      exitRsi,
      hitRatePct: hitRate,
      medianPeakRsi: medianPeak,
      ...stats,
    });
  }

  const { best, usedDefault } = pickBestSweep(sweep, 'exitRsi', anchorExit, { minTrades: 2 });
  let suggested = best?.exitRsi ?? anchorExit;

  if (medianPeak != null && suggested > medianPeak + 2) {
    suggested = Math.max(EXIT_MIN, Math.round(medianPeak));
  }
  if (p75Peak != null && suggested > p75Peak + 1) {
    suggested = Math.min(suggested, Math.round(p75Peak));
  }
  suggested = Math.max(EXIT_MIN, Math.min(EXIT_MAX, suggested));

  const bestRow = sweep.find(s => s.exitRsi === suggested) ?? best;

  return {
    ok: true,
    suggestedExitRsi: suggested,
    anchorExit,
    usedDefault,
    episodeCount,
    medianPeakRsi: medianPeak,
    p75PeakRsi: p75Peak,
    sweep,
    bestStats: bestRow,
    description:
      `${episodeCount} toques MA50 5m acima MA50 1h → pico RSI mediano ${medianPeak?.toFixed(1) ?? '—'} · ` +
      `sugerido saída RSI>${suggested}`,
  };
}

function evaluateEntryPathsSignal({
  entryPaths, rsi, rsiBuy, ma5mTrigger, ma1hOk, recoveryOk,
}) {
  const cfg = normalizeEntryPaths(entryPaths);
  if (!hasEntryPath(cfg)) {
    return { ok: false, reason: 'nenhum_caminho', path: null };
  }

  const baseOk = ma1hOk !== false && recoveryOk !== false;
  const rsiSignal = cfg.rsi.enabled && Number(rsi) < Number(rsiBuy);
  const maSignal  = cfg.ma50_5m.enabled && ma5mTrigger?.triggered === true;

  if (!baseOk) {
    return {
      ok: false,
      reason: !ma1hOk ? 'ma1h' : 'recovery',
      path: null,
      rsiSignal,
      maSignal,
    };
  }

  if (cfg.rsi.enabled && cfg.ma50_5m.enabled) {
    const ok = cfg.combine === 'all' ? (rsiSignal && maSignal) : (rsiSignal || maSignal);
    let path = null;
    if (ok) path = maSignal && !rsiSignal ? 'ma50_5m' : (rsiSignal && !maSignal ? 'rsi' : (maSignal ? 'ma50_5m' : 'rsi'));
    if (ok && cfg.combine === 'all') path = 'ma50_5m'; // prefer track ma path when both required
    if (ok && rsiSignal && !maSignal) path = 'rsi';
    return { ok, path, rsiSignal, maSignal, combine: cfg.combine };
  }

  if (cfg.ma50_5m.enabled) {
    return { ok: maSignal, path: maSignal ? 'ma50_5m' : null, rsiSignal, maSignal };
  }

  return { ok: rsiSignal, path: rsiSignal ? 'rsi' : null, rsiSignal, maSignal };
}

function resolveExitRsi(state) {
  return Number(state.rsi_sell ?? 70);
}

module.exports = {
  MA5M_PERIOD,
  checkMa50_5mTrigger,
  collectMa5mTouchEpisodes,
  suggestMa5mExitRsi,
  evaluateEntryPathsSignal,
  resolveExitRsi,
  simulateMa5mExitEpisodes,
};
