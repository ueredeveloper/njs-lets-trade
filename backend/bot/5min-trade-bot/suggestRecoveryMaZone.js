'use strict';

/**
 * Sugere % acima da MA50 1h para padrões de recuperação (lógica Multi-Trade extension).
 */

const ti = require('technicalindicators');
const { RSI_PERIOD } = require('./suggest5mRsi');
const { lastClosed1hIndex } = require('./recoveryPattern');
const { maThreshold, normalizeMaFilters } = require('./maFilter');

const RECOVERY_MA_REF = { period: 50, interval: '1h' };

const DEFAULT_OPTS = {
  defaultAbovePct: 5,
  minAbovePct:     2,
  maxAbovePct:     15,
  minSignals:      1,
  sweepStep:       0.5,
};

/** MA50 1h fixa — calibragem % só se filtro de entrada MA estiver ligado. */
function recoveryMaRef(maFilters) {
  const cfg = normalizeMaFilters(maFilters);
  const entryAbove = cfg.enabled
    ? cfg.filters.find(f => f.enabled && f.mode === 'above')
    : null;
  return {
    period: RECOVERY_MA_REF.period,
    interval: RECOVERY_MA_REF.interval,
    tolerancePct: entryAbove ? Math.max(0, Number(entryAbove.tolerancePct ?? 0)) : 3,
  };
}

function collectRsiEntrySignals(candles5m, candles1h, maPeriod, maInterval, rsiBuy, rsiSell, tolerancePct) {
  if (!candles5m?.length || !candles1h?.length) return [];

  const completed1h = candles1h.slice(0, -1);
  const closes5m    = candles5m.map(c => c.close);
  const closes1h    = completed1h.map(c => c.close);
  const maArr       = ti.SMA.calculate({ values: closes1h, period: maPeriod });
  const rsiArr      = ti.RSI.calculate({ values: closes5m, period: RSI_PERIOD });

  const signals = [];
  let inDip = false;

  for (let i = 0; i < rsiArr.length; i++) {
    const rsi   = rsiArr[i];
    const idx5m = RSI_PERIOD + i;
    const c5    = candles5m[idx5m];
    if (!c5) continue;

    if (!inDip && rsi < rsiBuy) {
      inDip = true;
      const h1Idx = lastClosed1hIndex(candles1h, c5.openTime ?? 0);
      if (h1Idx < maPeriod - 1) continue;
      const maIdx = h1Idx - (maPeriod - 1);
      const ma    = maArr[maIdx];
      if (!ma) continue;
      const close    = c5.close;
      const floor    = maThreshold(ma, 'above', tolerancePct);
      const abovePct = parseFloat(((close / ma - 1) * 100).toFixed(2));
      signals.push({
        entryPrice: close,
        ma,
        floor,
        abovePct,
        inAbove:    close >= ma * (1 + DEFAULT_OPTS.defaultAbovePct / 100),
        inBetween:  close >= floor && close < ma,
        h1Idx,
        openTime: c5.openTime,
      });
    } else if (inDip && rsi >= rsiSell) {
      inDip = false;
    }
  }
  return signals;
}

function suggestAbovePctFor5m(candles5m, candles1h, maFilters, rsiBuy, rsiSell, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const f = recoveryMaRef(maFilters);
  const { period, interval, tolerancePct: tol } = f;

  const signals = collectRsiEntrySignals(candles5m, candles1h, period, interval, rsiBuy, rsiSell, tol);
  if (!signals.length) {
    return {
      ok: false,
      suggestedAbovePct: o.defaultAbovePct,
      reason: 'sem_sinais',
      maPeriod: period,
      maInterval: interval,
      rsiBuy,
    };
  }

  const stretches = signals.map(s => s.abovePct).filter(p => p > 0).sort((a, b) => a - b);
  const median = stretches.length
    ? stretches[Math.floor(stretches.length / 2)]
    : o.defaultAbovePct;

  let best = { threshold: o.defaultAbovePct, netBenefit: -Infinity, count: 0 };
  for (let t = o.minAbovePct; t <= o.maxAbovePct; t += o.sweepStep) {
    const inZone = signals.filter(s => s.abovePct >= t);
    if (inZone.length < o.minSignals) continue;
    const net = inZone.length;
    if (net > best.netBenefit) {
      best = { threshold: parseFloat(t.toFixed(1)), netBenefit: net, count: inZone.length };
    }
  }

  const suggestedAbovePct = best.count >= o.minSignals
    ? best.threshold
    : Math.max(o.minAbovePct, Math.min(o.maxAbovePct, parseFloat(median.toFixed(1))));

  const lastMa    = signals[signals.length - 1]?.ma;
  const lastPrice = signals[signals.length - 1]?.entryPrice;
  const aboveNowPct = lastMa && lastPrice
    ? parseFloat(((lastPrice / lastMa - 1) * 100).toFixed(2))
    : null;

  return {
    ok: true,
    suggestedAbovePct,
    medianStretchPct: parseFloat(median.toFixed(2)),
    signalCount: signals.length,
    signalsAboveSuggested: signals.filter(s => s.abovePct >= suggestedAbovePct).length,
    signalsBetweenMa: signals.filter(s => s.inBetween).length,
    maPeriod: period,
    maInterval: interval,
    tolerancePct: tol,
    rsiBuy,
    aboveNowPct,
    currentMa: lastMa,
    currentPrice: lastPrice,
    extendedNow: aboveNowPct != null && aboveNowPct >= suggestedAbovePct,
    description:
      `Sugerido +${suggestedAbovePct}% acima MA${period} ${interval} ` +
      `(${signals.length} entradas RSI<${rsiBuy} no histórico 5m)`,
  };
}

module.exports = {
  suggestAbovePctFor5m,
  collectRsiEntrySignals,
  recoveryMaRef,
  RECOVERY_MA_REF,
  DEFAULT_OPTS,
};
