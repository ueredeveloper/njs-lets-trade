'use strict';

/**
 * Mediana de intervalos entre sinais RSI<buy e toques MA50 5m (acima MA50 1h).
 * O usuário escolhe qual mediana usar como cooldown entre caminhos (OR).
 */

const { percentile } = require('../amap/entrySuggestShared');
const { buildMaSeries, maAt, maThreshold, normalizeMaFilters } = require('./maFilter');
const { computeRsiSeries, RSI_PERIOD } = require('./suggest5mRsi');
const { checkMa50_5mTrigger, MA5M_PERIOD } = require('./ma5mEntryEngine');

const MA1H_PERIOD   = 50;
const MA1H_INTERVAL = '1h';
const BAR_MS        = 5 * 60 * 1000;
const MIN_HOURS     = 0.5;
const MAX_HOURS     = 48;
const DEFAULT_HOURS = 2;

function isAboveMa50_1h(price, openTime, ma1hSeries, tolerancePct = 0) {
  const ma = maAt(ma1hSeries, openTime);
  if (ma == null) return false;
  const threshold = maThreshold(ma, 'above', tolerancePct);
  return price >= threshold;
}

function collectRsiEntryTimes(candles5m, candles1h, maFilters, rsiBuy) {
  if (!candles5m?.length || candles5m.length < RSI_PERIOD + 5) return [];

  const maCfg = normalizeMaFilters(maFilters);
  const active1h = maCfg.enabled
    ? maCfg.filters.find(f => f.enabled && f.mode === 'above')
    : { period: MA1H_PERIOD, interval: MA1H_INTERVAL, tolerancePct: 0 };
  const tol1h = active1h?.tolerancePct ?? 0;

  const ma1hSeries = candles1h?.length >= MA1H_PERIOD
    ? buildMaSeries(candles1h, MA1H_PERIOD)
    : [];
  const rsiSeries  = computeRsiSeries(candles5m, RSI_PERIOD);
  const times = [];
  let lastAt = -999 * BAR_MS;

  for (let i = 1; i < rsiSeries.length; i++) {
    const prev = rsiSeries[i - 1];
    const cur  = rsiSeries[i];
    if (prev.rsi == null || cur.rsi == null) continue;
    if (prev.rsi >= rsiBuy && cur.rsi < rsiBuy) {
      if (!isAboveMa50_1h(cur.close, cur.openTime, ma1hSeries, tol1h)) continue;
      if (cur.openTime - lastAt < 2 * BAR_MS) continue;
      times.push(cur.openTime);
      lastAt = cur.openTime;
    }
  }
  return times;
}

function collectMa5mTouchTimes(candles5m, candles1h, maFilters, trigger = 'touch', tolerancePct = 0.5) {
  if (!candles5m?.length || candles5m.length < MA5M_PERIOD + 5) return [];

  const maCfg = normalizeMaFilters(maFilters);
  const active1h = maCfg.enabled
    ? maCfg.filters.find(f => f.enabled && f.mode === 'above')
    : { period: MA1H_PERIOD, interval: MA1H_INTERVAL, tolerancePct: 0 };
  const tol1h = active1h?.tolerancePct ?? 0;

  const ma5mSeries = buildMaSeries(candles5m, MA5M_PERIOD);
  const ma1hSeries = candles1h?.length >= MA1H_PERIOD
    ? buildMaSeries(candles1h, MA1H_PERIOD)
    : [];
  const times = [];
  let lastAt = -24 * BAR_MS;

  for (let i = MA5M_PERIOD; i < candles5m.length; i++) {
    const c    = candles5m[i];
    const prev = candles5m[i - 1];
    const ma5m = maAt(ma5mSeries, c.openTime);
    if (ma5m == null) continue;
    if (!isAboveMa50_1h(c.close, c.openTime, ma1hSeries, tol1h)) continue;

    const touch = checkMa50_5mTrigger({
      close: c.close,
      low: c.low,
      prevClose: prev?.close,
      ma: ma5m,
      trigger,
      tolerancePct,
    });
    if (!touch.triggered) continue;
    if (c.openTime - lastAt < 24 * BAR_MS) continue;
    times.push(c.openTime);
    lastAt = c.openTime;
  }
  return times;
}

function gapsHours(sortedTimes) {
  const gaps = [];
  for (let i = 1; i < sortedTimes.length; i++) {
    gaps.push((sortedTimes[i] - sortedTimes[i - 1]) / 3_600_000);
  }
  return gaps;
}

function clampHours(h) {
  if (!Number.isFinite(h)) return null;
  return Math.max(MIN_HOURS, Math.min(MAX_HOURS, parseFloat(h.toFixed(1))));
}

function medianGapHours(gaps) {
  if (!gaps.length) return null;
  return percentile([...gaps].sort((a, b) => a - b), 0.5);
}

function fmtEveryHours(h) {
  if (h == null) return '—';
  return `${h}h em ${h}h`;
}

function suggestEntryPathTiming(candles5m, candles1h, maFilters, rsiBuy, trigger = 'touch', tolerancePct = 0.5) {
  const rsiTimes = collectRsiEntryTimes(candles5m, candles1h, maFilters, rsiBuy);
  const maTimes  = collectMa5mTouchTimes(candles5m, candles1h, maFilters, trigger, tolerancePct);

  const rsiGapH = gapsHours(rsiTimes);
  const maGapH  = gapsHours(maTimes);

  const medRsiGap = medianGapHours(rsiGapH);
  const medMaGap  = medianGapHours(maGapH);

  const rsiCooldownHours = clampHours(medRsiGap);
  const maCooldownHours  = clampHours(medMaGap);

  const ok = rsiGapH.length >= 1 || maGapH.length >= 1;

  const rsiCalc = rsiCooldownHours != null
    ? `De ${fmtEveryHours(rsiCooldownHours)} o RSI<${rsiBuy} bate — mediana de ${rsiGapH.length} intervalo(s) entre ${rsiTimes.length} sinais (5m, acima MA50 1h)`
    : rsiTimes.length >= 1
      ? `Apenas ${rsiTimes.length} sinal RSI — precisa de 2+ para medir intervalo`
      : 'Sem sinais RSI<buy no histórico';

  const maCalc = maCooldownHours != null
    ? `De ${fmtEveryHours(maCooldownHours)} o preço toca MA50 5m — mediana de ${maGapH.length} intervalo(s) entre ${maTimes.length} toques (5m, acima MA50 1h)`
    : maTimes.length >= 1
      ? `Apenas ${maTimes.length} toque MA — precisa de 2+ para medir intervalo`
      : 'Sem toques MA50 5m no histórico';

  return {
    ok,
    rsiCooldownHours,
    maCooldownHours,
    rsiEpisodeCount: rsiTimes.length,
    rsiIntervalCount: rsiGapH.length,
    ma5mEpisodeCount: maTimes.length,
    maIntervalCount: maGapH.length,
    rsiCalc,
    maCalc,
    // legado — não usar no UI
    medianHoursBetweenRsi: medRsiGap,
    medianHoursBetweenMa5m: medMaGap,
  };
}

module.exports = {
  suggestEntryPathTiming,
  collectRsiEntryTimes,
  collectMa5mTouchTimes,
  DEFAULT_PATH_COOLDOWN_HOURS: DEFAULT_HOURS,
};
