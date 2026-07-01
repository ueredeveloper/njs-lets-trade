'use strict';

const ti = require('technicalindicators');
const { analyzeAdaptiveDip } = require('../amap/adaptiveMaDip');

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

function intervalMs(iv) {
  return INTERVAL_MS[iv] ?? 3_600_000;
}

function finestInterval(a, b) {
  return intervalMs(a) <= intervalMs(b) ? a : b;
}

function computeMa(candles, period) {
  if (!candles?.length || candles.length < period) return null;
  const closes = candles.map(c => c.close);
  const arr = ti.SMA.calculate({ values: closes, period });
  return arr.length ? arr[arr.length - 1] : null;
}

function computeRsi(candles, period) {
  if (!candles?.length || candles.length < period + 2) return null;
  const closes = candles.map(c => c.close);
  const arr = ti.RSI.calculate({ values: closes, period });
  return arr.length ? arr[arr.length - 1] : null;
}

function buildMaTimeSeries(candles, period) {
  if (!candles?.length || candles.length < period) return [];
  const closes = candles.map(c => c.close);
  const maArr = ti.SMA.calculate({ values: closes, period });
  return maArr.map((ma, i) => ({
    openTime: candles[period - 1 + i].openTime,
    ma,
  }));
}

function maValueAt(series, openTime) {
  if (!series?.length) return null;
  let best = null;
  for (const pt of series) {
    if (pt.openTime <= openTime) best = pt.ma;
    else break;
  }
  return best;
}

function checkRsi(rsi, spec) {
  if (rsi == null || !Number.isFinite(rsi)) return false;
  const v = Number(spec.value);
  if (spec.operator === '<') return rsi < v;
  if (spec.operator === '<=') return rsi <= v;
  if (spec.operator === '>') return rsi > v;
  if (spec.operator === '>=') return rsi >= v;
  return false;
}

function closedCandlesOnly(candles) {
  if (!candles?.length || candles.length < 3) return candles ?? [];
  return candles.slice(0, -1);
}

function checkMaCrossover({
  candles1, period1, interval1,
  candles2, period2, interval2,
  direction, tolerancePct = 0,
  closedOnly = true,
}) {
  const c1 = closedOnly ? closedCandlesOnly(candles1) : candles1;
  const c2 = closedOnly ? closedCandlesOnly(candles2) : candles2;

  const sigIv = finestInterval(interval1, interval2);
  const sigCandles = sigIv === interval1 ? c1 : c2;
  if (!sigCandles || sigCandles.length < 3) {
    return { crossed: false, reason: 'INSUFFICIENT_DATA' };
  }

  const series1 = buildMaTimeSeries(c1, period1);
  const series2 = buildMaTimeSeries(c2, period2);
  if (series1.length < 2 || series2.length < 2) {
    return { crossed: false, reason: 'INSUFFICIENT_MA' };
  }

  const last = sigCandles[sigCandles.length - 1];
  const prev = sigCandles[sigCandles.length - 2];

  const ma1     = maValueAt(series1, last.openTime);
  const ma2     = maValueAt(series2, last.openTime);
  const prevMa1 = maValueAt(series1, prev.openTime);
  const prevMa2 = maValueAt(series2, prev.openTime);

  if ([ma1, ma2, prevMa1, prevMa2].some(v => v == null)) {
    return { crossed: false, reason: 'MA_ALIGN_FAIL', ma1, ma2, prevMa1, prevMa2 };
  }

  const tol = (tolerancePct ?? 0) / 100;
  let crossed = false;

  if (direction === 'cross_up') {
    crossed = prevMa1 <= prevMa2 * (1 + tol) && ma1 > ma2;
  } else if (direction === 'cross_down') {
    crossed = prevMa1 >= prevMa2 * (1 - tol) && ma1 < ma2;
  }

  return {
    crossed,
    ma1, ma2, prevMa1, prevMa2,
    close: last.close,
    openTime: last.openTime,
    reason: crossed ? null : (direction === 'cross_up' ? 'NO_CROSS_UP' : 'NO_CROSS_DOWN'),
  };
}

function checkPriceFilter(close, filterCandles, filter, adaptiveDipPct, adaptiveOpts = {}) {
  if (!filter?.enabled || filter.mode === 'off') return { allowed: true };

  const ma = computeMa(filterCandles, filter.period);
  if (ma == null) return { allowed: false, reason: 'FILTER_NO_MA', ma, filterId: filter.id };

  const mode = filter.mode ?? 'strict_above';

  if (mode === 'below') {
    const ceil = ma * (1 + (filter.tolerancePct ?? 0) / 100);
    return close < ceil
      ? { allowed: true, ma, distPct: ((close - ma) / ma) * 100 }
      : { allowed: false, reason: 'NOT_BELOW_MA', ma, filterId: filter.id };
  }

  if (mode === 'strict_above') {
    const floor = ma * (1 - (filter.tolerancePct ?? 0) / 100);
    return close > floor
      ? { allowed: true, ma, distPct: ((close - ma) / ma) * 100 }
      : { allowed: false, reason: 'NOT_ABOVE_MA', ma, filterId: filter.id };
  }

  const fixed = filter.fixedDipPct != null ? Number(filter.fixedDipPct) : null;
  const cap = filter.maxDipPct ?? adaptiveOpts.maxPct ?? 8;
  const dip = fixed ?? adaptiveDipPct ?? adaptiveOpts.defaultPct ?? 3;
  const effectiveDip = Math.min(dip, cap);
  const floor = ma * (1 - effectiveDip / 100);

  return close >= floor
    ? { allowed: true, ma, floor, dipPct: effectiveDip, distPct: ((close - ma) / ma) * 100 }
    : { allowed: false, reason: 'BELOW_ADAPTIVE_FLOOR', ma, floor, filterId: filter.id };
}

function crossLabel(leg) {
  return `MA${leg.period}(${leg.interval})`;
}

function activeMaFilters(config) {
  if (config.maFiltersEnabled === false) return [];
  return (config.maFilters ?? []).filter(f => f.enabled && f.mode !== 'off');
}

function getRequiredSpecs(config) {
  const specs = new Map();
  const add = (interval, limit) => {
    specs.set(interval, Math.max(specs.get(interval) ?? 0, limit));
  };

  const entry = config.entry;
  if (entry?.enabled !== false) {
    add(entry.ma1.interval, entry.ma1.period + 30);
    if (entry.ma2.interval !== entry.ma1.interval) {
      add(entry.ma2.interval, entry.ma2.period + 30);
    }
  }

  const exMa = config.exit?.maCross;
  if (exMa?.enabled) {
    add(exMa.ma1.interval, exMa.ma1.period + 30);
    if (exMa.ma2.interval !== exMa.ma1.interval) {
      add(exMa.ma2.interval, exMa.ma2.period + 30);
    }
  }

  for (const f of activeMaFilters(config)) {
    add(f.interval, f.period + 60);
  }

  const rsiConds = (config.exit?.rsi?.conditions ?? []).filter(c => c.enabled);
  for (const c of rsiConds) {
    add(c.interval, c.period + 50);
  }

  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

function evaluateMaFilters(close, config, cMap, adaptiveDips) {
  for (const f of activeMaFilters(config)) {
    const filtCandles = cMap[f.interval] ?? [];
    const key = `${f.period}_${f.interval}`;
    const pf = checkPriceFilter(close, filtCandles, f, adaptiveDips[key], config.adaptiveOpts);
    if (!pf.allowed) return pf;
  }
  return { allowed: true };
}

function evaluateEntry(config, cMap, adaptiveDips = {}, opts = {}) {
  const closedOnly = opts.closedOnly !== false;
  if (config.entry?.enabled === false) {
    return { allowed: false, reason: 'ENTRY_OFF' };
  }

  const entry = config.entry;
  const c1 = cMap[entry.ma1.interval] ?? [];
  const c2 = cMap[entry.ma2.interval] ?? [];

  const cross = checkMaCrossover({
    candles1: c1, period1: entry.ma1.period, interval1: entry.ma1.interval,
    candles2: c2, period2: entry.ma2.period, interval2: entry.ma2.interval,
    direction: entry.direction ?? 'cross_up',
    tolerancePct: entry.tolerancePct ?? 0,
    closedOnly,
  });

  if (!cross.crossed) {
    return {
      allowed: false,
      reason: cross.reason,
      ma1: cross.ma1, ma2: cross.ma2,
      close: cross.close ?? c1.at(-1)?.close,
    };
  }

  const close = cross.close;
  const filterCheck = evaluateMaFilters(close, config, cMap, adaptiveDips);
  if (!filterCheck.allowed) {
    return {
      allowed: false,
      reason: filterCheck.reason,
      ma1: cross.ma1, ma2: cross.ma2, close,
      filterMa: filterCheck.ma, distPct: filterCheck.distPct, floor: filterCheck.floor,
    };
  }

  const dirLbl = entry.direction === 'cross_down' ? '↓' : '↑';
  return {
    allowed: true,
    ma1: cross.ma1, ma2: cross.ma2, close,
    entryDesc: `${crossLabel(entry.ma1)} ${dirLbl} ${crossLabel(entry.ma2)}`,
  };
}

function evaluateRsiExit(config, cMap) {
  const rsiBlock = config.exit?.rsi;
  if (!rsiBlock?.enabled) return { hit: false };

  const active = (rsiBlock.conditions ?? []).filter(c => c.enabled);
  if (!active.length) return { hit: false };

  const results = active.map(cond => {
    const candles = cMap[cond.interval] ?? [];
    const rsi = computeRsi(candles, cond.period);
    return { cond, rsi, hit: checkRsi(rsi, cond) };
  });

  const logic = rsiBlock.logic ?? 'any';
  const hit = logic === 'all'
    ? results.every(r => r.hit)
    : results.some(r => r.hit);

  return {
    hit,
    exitRsi: results[0]?.rsi,
    results,
  };
}

function evaluateExit(config, cMap, entryPrice, opts = {}) {
  const closedOnly = opts.closedOnly !== false;
  const c1 = cMap[config.exit?.maCross?.ma1?.interval] ?? [];
  const c2 = cMap[config.exit?.maCross?.ma2?.interval] ?? [];
  const lastClose = c1.at(-1)?.close ?? c2.at(-1)?.close;

  const signals = [];

  const exMa = config.exit?.maCross;
  if (exMa?.enabled) {
    const cross = checkMaCrossover({
      candles1: cMap[exMa.ma1.interval] ?? [],
      period1: exMa.ma1.period, interval1: exMa.ma1.interval,
      candles2: cMap[exMa.ma2.interval] ?? [],
      period2: exMa.ma2.period, interval2: exMa.ma2.interval,
      direction: exMa.direction ?? 'cross_down',
      tolerancePct: exMa.tolerancePct ?? 0,
      closedOnly,
    });
    if (cross.crossed) {
      const dirLbl = exMa.direction === 'cross_up' ? '↑' : '↓';
      signals.push({
        kind: 'ma',
        exitDesc: `MA${exMa.ma1.period}(${exMa.ma1.interval}) ${dirLbl} MA${exMa.ma2.period}(${exMa.ma2.interval})`,
        ma1: cross.ma1, ma2: cross.ma2, close: cross.close,
      });
    }
  }

  const rsiExit = evaluateRsiExit(config, cMap);
  if (rsiExit.hit) {
    signals.push({ kind: 'rsi', exitRsi: rsiExit.exitRsi, results: rsiExit.results });
  }

  const logic = config.exit?.logic ?? 'any';
  const maOn  = exMa?.enabled;
  const rsiOn = config.exit?.rsi?.enabled;

  let tacticalExit = false;
  if (maOn && rsiOn) {
    tacticalExit = logic === 'all'
      ? signals.some(s => s.kind === 'ma') && signals.some(s => s.kind === 'rsi')
      : signals.length > 0;
  } else if (maOn || rsiOn) {
    tacticalExit = signals.length > 0;
  }

  if (tacticalExit) {
    const primary = signals[0];
    return {
      exit: true,
      reason: primary.kind === 'rsi' ? 'RSI_EXIT' : 'MA_CROSS_EXIT',
      close: primary.close ?? lastClose,
      exitRsi: primary.exitRsi,
      exitDesc: primary.exitDesc,
      ma1: primary.ma1,
      ma2: primary.ma2,
    };
  }

  if (config.stopLoss?.enabled && entryPrice && lastClose != null) {
    const floor = entryPrice * (1 - config.stopLoss.maxLossPct / 100);
    if (lastClose <= floor) {
      return {
        exit: true,
        reason: 'STOP_LOSS',
        close: lastClose,
        dropPct: ((lastClose - entryPrice) / entryPrice) * 100,
      };
    }
  }

  return { exit: false, close: lastClose, exitRsi: rsiExit.exitRsi };
}

function computeAdaptiveDips(config, cMap) {
  const dips = {};
  const opts = config.adaptiveOpts ?? {};
  for (const f of activeMaFilters(config)) {
    if (f.mode !== 'adaptive') continue;
    const candles = cMap[f.interval] ?? [];
    const { dipPct } = analyzeAdaptiveDip(candles, f.period, {
      defaultPct:  opts.defaultPct ?? 3,
      maxPct:      Math.min(f.maxDipPct ?? opts.maxPct ?? 8, opts.maxPct ?? 8),
      minPct:      opts.minPct ?? 0.5,
      minEpisodes: opts.minEpisodes ?? 3,
    });
    dips[`${f.period}_${f.interval}`] = dipPct;
  }
  return dips;
}

function getFinestPollInterval(config) {
  const ivs = getRequiredSpecs(config).map(s => s.interval);
  if (!ivs.length) return '15m';
  return ivs.reduce((a, b) => (intervalMs(a) <= intervalMs(b) ? a : b));
}

module.exports = {
  INTERVAL_MS,
  intervalMs,
  computeMa,
  computeRsi,
  buildMaTimeSeries,
  maValueAt,
  closedCandlesOnly,
  checkMaCrossover,
  checkPriceFilter,
  checkRsi,
  getRequiredSpecs,
  evaluateEntry,
  evaluateExit,
  computeAdaptiveDips,
  getFinestPollInterval,
};
