'use strict';

/**
 * Sugere piso (maxDipPct) e teto (maxAbovePct) adaptativos para filtros MA do MA-Cross.
 *
 * Piso: analyzeAdaptiveDip nos candles da MA (episódios abaixo da MA).
 * Teto: varre cruzamentos históricos MA9/21, mede % acima da MA filtro e simula o trade
 *       — escolhe o limiar que maximiza benefício líquido (prejuízo evitado − lucro perdido).
 */

const { analyzeAdaptiveDip, lastMa } = require('../amap/adaptiveMaDip');
const {
  getRequiredSpecs, getFinestPollInterval, checkMaCrossover, evaluateExit,
  buildMaTimeSeries, maValueAt,
} = require('./strategyEngine');
const { normalizeMaCrossConfig, toEngineConfig } = require('./tradeConfigSchema');

const FEE_RATE = 0.002;

const DEFAULT_OPTS = {
  defaultDipPct:   4,
  defaultAbovePct: 4,
  minAbovePct:     1,
  maxAbovePct:     15,
  minSignalsInZone: 2,
  sweepStep:       0.5,
  minEpisodes:     3,
};

function sliceCMap(fullMap, openTime) {
  const out = {};
  for (const [iv, candles] of Object.entries(fullMap)) {
    out[iv] = candles.filter(c => c.openTime <= openTime);
  }
  return out;
}

function maDistPct(close, ma) {
  if (ma == null || ma <= 0) return null;
  return parseFloat((((close / ma) - 1) * 100).toFixed(2));
}

function simulateForwardTrade(scanCandles, startIdx, entryPrice, config, cMap) {
  const position = { entryPrice: entryPrice * (1 + FEE_RATE), peakPrice: entryPrice };
  const evalOpts = { closedOnly: true };
  const entryOpenTime = scanCandles[startIdx].openTime;

  for (let j = startIdx + 1; j < scanCandles.length; j++) {
    const c = scanCandles[j];
    const slice = sliceCMap(cMap, c.openTime);
    const high = c.high != null ? parseFloat(c.high) : parseFloat(c.close);
    position.peakPrice = Math.max(position.peakPrice, high, parseFloat(c.close));
    const exit = evaluateExit(config, slice, position.entryPrice, {
      ...evalOpts,
      peakPrice: position.peakPrice,
      entryOpenTime,
    });
    if (!exit.exit) continue;
    const exitPrice = exit.close * (1 - FEE_RATE);
    const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    return { pnlPct: parseFloat(pnlPct.toFixed(2)), exitReason: exit.reason };
  }
  return { pnlPct: null, exitReason: 'OPEN' };
}

function collectCrossSignals(cMap, config) {
  const scanIv = getFinestPollInterval(config);
  const scanCandles = cMap[scanIv] ?? [];
  const entry = config.entry ?? {};
  const signals = [];
  const warmup = Math.max(30, (entry.ma2?.period ?? 21) + 5);

  for (let i = warmup; i < scanCandles.length; i++) {
    const c = scanCandles[i];
    const slice = sliceCMap(cMap, c.openTime);
    const cross = checkMaCrossover({
      candles1: slice[entry.ma1?.interval ?? scanIv] ?? [],
      period1: entry.ma1?.period ?? 9,
      interval1: entry.ma1?.interval ?? scanIv,
      candles2: slice[entry.ma2?.interval ?? scanIv] ?? [],
      period2: entry.ma2?.period ?? 21,
      interval2: entry.ma2?.interval ?? scanIv,
      direction: entry.direction ?? 'cross_up',
      tolerancePct: entry.tolerancePct ?? 0,
      closedOnly: true,
    });
    if (!cross.crossed) continue;

    const forward = simulateForwardTrade(scanCandles, i, cross.close, config, cMap);
    signals.push({
      entryTime: c.openTime,
      close: cross.close,
      pnlPct: forward.pnlPct,
      exitReason: forward.exitReason,
    });
  }
  return signals;
}

function enrichSignalsWithMaDist(signals, cMap, filter) {
  const maSeries = buildMaTimeSeries(cMap[filter.interval] ?? [], filter.period);
  return signals.map(sig => {
    const ma = maValueAt(maSeries, sig.entryTime);
    const aboveMaPct = maDistPct(sig.close, ma);
    const belowMaPct = aboveMaPct != null && aboveMaPct < 0 ? Math.abs(aboveMaPct) : 0;
    return {
      ...sig,
      ma,
      aboveMaPct: aboveMaPct != null ? Math.max(0, aboveMaPct) : null,
      belowMaPct,
    };
  }).filter(s => s.ma != null);
}

function netBenefitAtThreshold(signals, threshold) {
  let saved = 0;
  let missed = 0;
  let inZone = 0;
  for (const s of signals) {
    if (s.aboveMaPct == null || s.aboveMaPct < threshold) continue;
    if (s.pnlPct == null) continue;
    inZone++;
    if (s.pnlPct < 0) saved += Math.abs(s.pnlPct);
    else missed += s.pnlPct;
  }
  return { netBenefit: saved - missed, saved, missed, inZone };
}

function sweepBestAboveThreshold(signals, opts) {
  let best = { threshold: opts.defaultAbovePct, netBenefit: -Infinity, inZone: 0 };
  for (let t = opts.minAbovePct; t <= opts.maxAbovePct; t += opts.sweepStep) {
    const r = netBenefitAtThreshold(signals, t);
    if (r.inZone < opts.minSignalsInZone) continue;
    if (r.netBenefit > best.netBenefit) {
      best = { threshold: parseFloat(t.toFixed(1)), ...r };
    }
  }
  return best;
}

function medianPositiveStretch(signals) {
  const stretches = signals.map(s => s.aboveMaPct).filter(p => p != null && p > 0).sort((a, b) => a - b);
  if (!stretches.length) return null;
  const mid = Math.floor((stretches.length - 1) / 2);
  return stretches.length % 2 ? stretches[mid] : (stretches[mid] + stretches[mid + 1]) / 2;
}

function suggestFloor(candles, filter, adaptiveOpts, opts) {
  const o = { ...DEFAULT_OPTS, ...adaptiveOpts, ...opts };
  const analysis = analyzeAdaptiveDip(candles, filter.period, {
    defaultPct:  o.defaultDipPct ?? filter.maxDipPct ?? 4,
    maxPct:      Math.min(filter.maxDipPct ?? o.defaultDipPct ?? 4, o.maxPct ?? 8),
    minPct:      o.minPct ?? 0.5,
    minEpisodes: o.minEpisodes ?? 3,
  });
  const close = candles?.length ? candles[candles.length - 1].close : null;
  const ma = lastMa(candles, filter.period);
  const floor = ma != null ? ma * (1 - analysis.dipPct / 100) : null;
  return {
    suggestedMaxDipPct: analysis.dipPct,
    usedDefault: analysis.usedDefault,
    reason: analysis.reason,
    episodeCount: analysis.episodeCount ?? analysis.episodes?.length ?? 0,
    avgRawDipPct: analysis.avgRaw ?? null,
    currentMa: ma,
    currentPrice: close,
    floor,
    dipNowPct: ma != null && close != null ? parseFloat(((ma - close) / ma * 100).toFixed(2)) : null,
  };
}

function suggestCeilingFromEnriched(enriched, filter, opts) {
  const o = { ...DEFAULT_OPTS, ...opts };
  if (!enriched.length) {
    return {
      suggestedMaxAbovePct: o.defaultAbovePct,
      usedDefault: true,
      reason: 'sem_sinais',
      signalCount: 0,
      maPeriod: filter.period,
      maInterval: filter.interval,
    };
  }

  const sweep = sweepBestAboveThreshold(enriched, o);
  const medianPos = medianPositiveStretch(enriched);
  const usedDefault = sweep.inZone < o.minSignalsInZone;

  const suggestedMaxAbovePct = usedDefault
    ? (medianPos != null
      ? Math.max(o.minAbovePct, Math.min(o.maxAbovePct, parseFloat(medianPos.toFixed(1))))
      : o.defaultAbovePct)
    : sweep.threshold;

  return {
    suggestedMaxAbovePct,
    usedDefault,
    reason: usedDefault ? 'poucos_sinais_na_zona' : null,
    signalCount: enriched.length,
    signalsInZone: enriched.filter(s => s.aboveMaPct >= suggestedMaxAbovePct).length,
    maPeriod: filter.period,
    maInterval: filter.interval,
    medianStretchPct: medianPos != null ? parseFloat(medianPos.toFixed(2)) : null,
    sweepNetBenefit: usedDefault ? null : parseFloat(sweep.netBenefit.toFixed(2)),
    sweepSavedPct: usedDefault ? null : sweep.saved,
    sweepMissedPct: usedDefault ? null : sweep.missed,
  };
}

/**
 * @param {object} cMap
 * @param {object} config — engine config normalizado
 * @param {object} filter — filtro MA alvo (period, interval, maxDipPct, maxAbovePct)
 */
function suggestMaCrossFilterBounds(cMap, config, filter, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const candles = cMap[filter.interval] ?? [];
  const floorReport = suggestFloor(candles, filter, config.adaptiveOpts, o);

  const signals = collectCrossSignals(cMap, config);
  const enriched = enrichSignalsWithMaDist(signals, cMap, filter);
  const ceilingBase = suggestCeilingFromEnriched(enriched, filter, o);

  const close = candles?.length ? candles[candles.length - 1].close : null;
  const ma = lastMa(candles, filter.period);
  const aboveNowPct = maDistPct(close, ma);
  const ceiling = ma != null
    ? ma * (1 + ceilingBase.suggestedMaxAbovePct / 100)
    : null;

  return {
    filter: { period: filter.period, interval: filter.interval },
    floor: floorReport,
    ceiling: {
      ...ceilingBase,
      currentMa: ma,
      currentPrice: close,
      ceiling,
      aboveNowPct,
      stretchedNow: aboveNowPct != null && aboveNowPct > ceilingBase.suggestedMaxAbovePct,
    },
    signalCount: signals.length,
  };
}

function buildMaCrossBoundsReport(cMap, body = {}, filterIdx = 0) {
  const normalized = normalizeMaCrossConfig(body);
  const config = toEngineConfig(normalized);
  const filters = (config.maFilters ?? []).filter(f => f.enabled && f.mode === 'adaptive');
  const filter = filters[filterIdx] ?? filters[0] ?? normalized.maFilters[0];
  if (!filter) {
    return { error: 'nenhum filtro adaptativo configurado' };
  }
  return suggestMaCrossFilterBounds(cMap, config, filter);
}

module.exports = {
  suggestMaCrossFilterBounds,
  buildMaCrossBoundsReport,
  collectCrossSignals,
  DEFAULT_OPTS,
};
