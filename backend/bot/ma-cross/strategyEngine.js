'use strict';

const ti = require('technicalindicators');
const { analyzeAdaptiveDip, analyzeAdaptiveStretch } = require('../amap/adaptiveMaDip');
const { computeMa, buildMaTimeSeries, maLabel } = require('../../utils/movingAverage');

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

function candleClose(c) {
  return parseFloat(c.close);
}

function computeRsi(candles, period) {
  if (!candles?.length || candles.length < period + 2) return null;
  const closes = candles.map(candleClose);
  const arr = ti.RSI.calculate({ values: closes, period });
  return arr.length ? arr[arr.length - 1] : null;
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

function detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, direction, tolerancePct = 0) {
  if ([prevMa1, prevMa2, ma1, ma2].some(v => v == null)) return false;
  const tol = (tolerancePct ?? 0) / 100;
  if (direction === 'cross_up') {
    const wasBelow = prevMa1 <= prevMa2 * (1 + tol);
    return wasBelow && prevMa1 <= prevMa2 && ma1 > ma2;
  }
  if (direction === 'cross_down') {
    const wasAbove = prevMa1 >= prevMa2 * (1 - tol);
    return wasAbove && prevMa1 >= prevMa2 && ma1 < ma2;
  }
  return false;
}

function areConsecutiveCandles(prev, candle, intervalIv) {
  if (!prev || !candle) return false;
  const ms = intervalMs(intervalIv);
  return Number(candle.openTime) - Number(prev.openTime) === ms;
}

function isDirectionHeld(ma1, ma2, direction) {
  if (ma1 == null || ma2 == null) return false;
  if (direction === 'cross_up') return ma1 > ma2;
  if (direction === 'cross_down') return ma1 < ma2;
  return false;
}

/** Gap máximo (%) para tratar cruzamento ainda “válido” como reversão (gap encolhendo). */
const CROSS_REVERSE_PROXIMITY_PCT = 0.1;

/**
 * Localiza o cruzamento MA mais recente e verifica idade temporal.
 * maxAgeMin: 'last' = só o último candle fechado; número = cruzou há no máximo N minutos.
 * Rejeita se a direção ainda vale mas o gap está encolhendo (prestes a cruzar o sentido oposto).
 */
function findRecentMaCross({
  candles1, period1, interval1,
  candles2, period2, interval2,
  direction, tolerancePct = 0,
  maxAgeMin = 'last',
  closedOnly = true,
  now = Date.now(),
}) {
  const lastCandleOnly = maxAgeMin === 'last' || maxAgeMin === 0 || maxAgeMin === '0';
  const useClosed = closedOnly || lastCandleOnly;
  const c1 = useClosed ? closedCandlesOnly(candles1) : candles1;
  const c2 = useClosed ? closedCandlesOnly(candles2) : candles2;

  const sigIv = finestInterval(interval1, interval2);
  const sigCandles = sigIv === interval1 ? c1 : c2;
  if (!sigCandles || sigCandles.length < 3) {
    return { matched: false, reason: 'INSUFFICIENT_DATA' };
  }

  const series1 = buildMaTimeSeries(c1, period1);
  const series2 = buildMaTimeSeries(c2, period2);
  if (series1.length < 2 || series2.length < 2) {
    return { matched: false, reason: 'INSUFFICIENT_MA' };
  }

  const lastIdx = sigCandles.length - 1;
  const last = sigCandles[lastIdx];
  const lastMa1 = maValueAt(series1, last.openTime);
  const lastMa2 = maValueAt(series2, last.openTime);

  const maxAgeMs = lastCandleOnly ? null : Number(maxAgeMin) * 60_000;

  const scanFrom = lastCandleOnly ? lastIdx : lastIdx;
  const scanTo = lastCandleOnly ? lastIdx : 1;

  for (let i = scanFrom; i >= scanTo; i--) {
    const candle = sigCandles[i];
    const prev = sigCandles[i - 1];
    if (!areConsecutiveCandles(prev, candle, sigIv)) continue;

    const ma1 = maValueAt(series1, candle.openTime);
    const ma2 = maValueAt(series2, candle.openTime);
    const prevMa1 = maValueAt(series1, prev.openTime);
    const prevMa2 = maValueAt(series2, prev.openTime);

    if (!detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, direction, tolerancePct)) continue;

    const crossOpenTime = candle.openTime;
    const crossAt = candle.closeTime ?? (crossOpenTime + intervalMs(sigIv));
    const ageMs = Math.max(0, now - crossAt);

    if (!lastCandleOnly && maxAgeMs != null && Number.isFinite(maxAgeMs) && ageMs > maxAgeMs) {
      return {
        matched: false,
        reason: 'CROSS_TOO_OLD',
        crossTime: crossAt,
        crossOpenTime,
        ageMs,
        ageMin: ageMs / 60_000,
        ma1: lastMa1,
        ma2: lastMa2,
      };
    }

    const held = isDirectionHeld(lastMa1, lastMa2, direction);
    if (!held) {
      return {
        matched: false,
        kind: 'crossed',
        crossTime: crossAt,
        crossOpenTime,
        ageMs,
        ageMin: ageMs / 60_000,
        ma1: lastMa1,
        ma2: lastMa2,
        prevMa1,
        prevMa2,
        close: last.close,
        openTime: last.openTime,
        reason: 'REVERSED_AFTER_CROSS',
      };
    }

    // Ainda do lado certo, mas gap encolhendo → já está virando (ex.: TAO ↑ fraco prestes a ↓)
    const reverseMode = direction === 'cross_up' ? 'near_down' : 'near_up';
    const reversing = checkMaCrossApproaching({
      candles1, period1, interval1,
      candles2, period2, interval2,
      mode: reverseMode,
      proximityPct: CROSS_REVERSE_PROXIMITY_PCT,
      closedOnly: useClosed,
    });
    if (reversing.matched) {
      return {
        matched: false,
        kind: 'crossed',
        crossTime: crossAt,
        crossOpenTime,
        ageMs,
        ageMin: ageMs / 60_000,
        ma1: lastMa1,
        ma2: lastMa2,
        gapPct: reversing.gapPct,
        prevMa1,
        prevMa2,
        close: last.close,
        openTime: last.openTime,
        reason: 'REVERSING',
      };
    }

    return {
      matched: true,
      kind: 'crossed',
      crossTime: crossAt,
      crossOpenTime,
      ageMs,
      ageMin: ageMs / 60_000,
      ma1: lastMa1,
      ma2: lastMa2,
      prevMa1,
      prevMa2,
      close: last.close,
      openTime: last.openTime,
      reason: null,
    };
  }

  return {
    matched: false,
    reason: direction === 'cross_up' ? 'NO_CROSS_UP' : 'NO_CROSS_DOWN',
    ma1: lastMa1,
    ma2: lastMa2,
    close: last.close,
    openTime: last.openTime,
  };
}

function checkMaCrossover({
  candles1, period1, interval1,
  candles2, period2, interval2,
  direction, tolerancePct = 0,
  closedOnly = true,
}) {
  const r = findRecentMaCross({
    candles1, period1, interval1,
    candles2, period2, interval2,
    direction,
    tolerancePct,
    maxAgeMin: 'last',
    closedOnly,
  });
  return {
    crossed: r.matched,
    ma1: r.ma1,
    ma2: r.ma2,
    prevMa1: r.prevMa1,
    prevMa2: r.prevMa2,
    close: r.close,
    openTime: r.openTime,
    reason: r.matched ? null : (r.reason ?? (direction === 'cross_up' ? 'NO_CROSS_UP' : 'NO_CROSS_DOWN')),
  };
}

function readMaCrossPair({
  candles1, period1, interval1,
  candles2, period2, interval2,
  closedOnly = true,
}) {
  const c1 = closedOnly ? closedCandlesOnly(candles1) : candles1;
  const c2 = closedOnly ? closedCandlesOnly(candles2) : candles2;

  const sigIv = finestInterval(interval1, interval2);
  const sigCandles = sigIv === interval1 ? c1 : c2;
  if (!sigCandles || sigCandles.length < 3) {
    return { ok: false, reason: 'INSUFFICIENT_DATA' };
  }

  const series1 = buildMaTimeSeries(c1, period1);
  const series2 = buildMaTimeSeries(c2, period2);
  if (series1.length < 2 || series2.length < 2) {
    return { ok: false, reason: 'INSUFFICIENT_MA' };
  }

  const last = sigCandles[sigCandles.length - 1];
  const prev = sigCandles[sigCandles.length - 2];

  const ma1     = maValueAt(series1, last.openTime);
  const ma2     = maValueAt(series2, last.openTime);
  const prevMa1 = maValueAt(series1, prev.openTime);
  const prevMa2 = maValueAt(series2, prev.openTime);

  if ([ma1, ma2, prevMa1, prevMa2].some(v => v == null)) {
    return { ok: false, reason: 'MA_ALIGN_FAIL', ma1, ma2 };
  }

  return {
    ok: true,
    ma1, ma2, prevMa1, prevMa2,
    close: last.close,
    openTime: last.openTime,
  };
}

/** Screening: MA ainda do lado certo e gap dentro do limite % (sem exigir momentum). */
function checkMaCrossNearProximity({
  candles1, period1, interval1,
  candles2, period2, interval2,
  mode, proximityPct = 1,
  closedOnly = true,
}) {
  const pair = readMaCrossPair({
    candles1, period1, interval1,
    candles2, period2, interval2,
    closedOnly,
  });
  if (!pair.ok) {
    return { matched: false, reason: pair.reason, ma1: pair.ma1, ma2: pair.ma2 };
  }

  const { ma1, ma2, close, openTime } = pair;
  const prox = Math.max(0, proximityPct ?? 0) / 100;
  let matched = false;
  let gapPct = null;

  if (mode === 'near_up') {
    if (ma1 < ma2 && ma2 > 0) {
      gapPct = ((ma2 - ma1) / ma2) * 100;
      matched = gapPct / 100 <= prox;
    }
  } else if (mode === 'near_down') {
    if (ma1 > ma2 && ma2 > 0) {
      gapPct = ((ma1 - ma2) / ma2) * 100;
      matched = gapPct / 100 <= prox;
    }
  }

  return {
    matched,
    kind: 'approaching',
    ma1, ma2, gapPct,
    close,
    openTime,
    reason: matched ? null : (mode === 'near_up' ? 'NOT_NEAR_UP' : 'NOT_NEAR_DOWN'),
  };
}

/** Prestes a cruzar com momentum: gap encolhendo e MA rápida na direção do cruzamento. */
function checkMaCrossApproaching({
  candles1, period1, interval1,
  candles2, period2, interval2,
  mode, proximityPct = 1,
  closedOnly = true,
}) {
  const pair = readMaCrossPair({
    candles1, period1, interval1,
    candles2, period2, interval2,
    closedOnly,
  });
  if (!pair.ok) {
    return { matched: false, reason: pair.reason, ma1: pair.ma1, ma2: pair.ma2 };
  }

  const { ma1, ma2, prevMa1, prevMa2, close, openTime } = pair;
  const prox = Math.max(0, proximityPct ?? 0) / 100;
  let matched = false;
  let gapPct = null;

  if (mode === 'near_up') {
    if (ma1 < ma2 && ma2 > 0) {
      gapPct = ((ma2 - ma1) / ma2) * 100;
      const gap = ma2 - ma1;
      const prevGap = prevMa2 - prevMa1;
      const ma1Rising = ma1 > prevMa1;
      matched = gapPct / 100 <= prox && gap < prevGap && ma1Rising;
    }
  } else if (mode === 'near_down') {
    if (ma1 > ma2 && ma2 > 0) {
      gapPct = ((ma1 - ma2) / ma2) * 100;
      const gap = ma1 - ma2;
      const prevGap = prevMa1 - prevMa2;
      const ma1Falling = ma1 < prevMa1;
      matched = gapPct / 100 <= prox && gap < prevGap && ma1Falling;
    }
  }

  return {
    matched,
    kind: 'approaching',
    ma1, ma2, gapPct,
    close,
    openTime,
    reason: matched ? null : (mode === 'near_up' ? 'NOT_NEAR_UP' : 'NOT_NEAR_DOWN'),
  };
}

/** Posição relativa: EMA rápida acima ou abaixo da lenta (sem exigir cruzamento). */
function checkMaPosition({
  candles1, period1, interval1,
  candles2, period2, interval2,
  compare = 'above',
  tolerancePct = 0,
  closedOnly = true,
}) {
  const pair = readMaCrossPair({
    candles1, period1, interval1,
    candles2, period2, interval2,
    closedOnly,
  });
  if (!pair.ok) {
    return { matched: false, reason: pair.reason, ma1: pair.ma1, ma2: pair.ma2 };
  }

  const { ma1, ma2, close, openTime } = pair;
  const tol = Math.max(0, tolerancePct ?? 0) / 100;
  const gapPct = ma2 > 0 ? Math.round(((ma1 - ma2) / ma2) * 10000) / 100 : null;
  const wantBelow = compare === 'below' || compare === 'bellow';

  let matched;
  if (wantBelow) {
    matched = ma1 < ma2 * (1 + tol);
  } else {
    matched = ma1 > ma2 * (1 - tol);
  }

  return {
    matched,
    kind: 'position',
    ma1, ma2, gapPct,
    close,
    openTime,
    direction: ma1 >= ma2 ? 'up' : 'down',
    reason: matched ? null : (wantBelow ? 'MA1_NOT_BELOW' : 'MA1_NOT_ABOVE'),
  };
}

function evaluateMaCrossSignal({
  candles1, period1, interval1,
  candles2, period2, interval2,
  mode, tolerancePct = 0, maxAgeMin = 'last', proximityPct = 1,
  closedOnly = true,
  now,
}) {
  if (mode === 'near_up' || mode === 'near_down') {
    return checkMaCrossNearProximity({
      candles1, period1, interval1,
      candles2, period2, interval2,
      mode,
      proximityPct,
      closedOnly,
    });
  }

  return findRecentMaCross({
    candles1, period1, interval1,
    candles2, period2, interval2,
    direction: mode,
    tolerancePct,
    maxAgeMin,
    closedOnly,
    now,
  });
}

function checkPriceFilter(close, filterCandles, filter, adaptiveDipPct, adaptiveOpts = {}, adaptiveStretchPct = null) {
  if (!filter?.enabled || filter.mode === 'off') return { allowed: true };

  const ma = computeMa(filterCandles, filter.period);
  if (ma == null) return { allowed: false, reason: 'FILTER_NO_MA', ma, filterId: filter.id };

  const distPct = ((close - ma) / ma) * 100;
  const mode = filter.mode ?? 'strict_above';

  if (mode === 'below') {
    const ceil = ma * (1 + (filter.tolerancePct ?? 0) / 100);
    return close < ceil
      ? { allowed: true, ma, distPct }
      : { allowed: false, reason: 'NOT_BELOW_MA', ma, filterId: filter.id };
  }

  if (mode === 'strict_above') {
    const floor = ma * (1 - (filter.tolerancePct ?? 0) / 100);
    return close > floor
      ? { allowed: true, ma, distPct }
      : { allowed: false, reason: 'NOT_ABOVE_MA', ma, filterId: filter.id };
  }

  // mode === 'adaptive': maxDipPct / maxAbovePct são a banda escolhida (fixa),
  // não um teto sobre cálculo histórico por moeda. fixed* sobrescreve se preenchido.
  const fixed = filter.fixedDipPct != null && filter.fixedDipPct !== ''
    ? Number(filter.fixedDipPct) : null;
  const effectiveDip = Number.isFinite(fixed)
    ? fixed
    : Number(filter.maxDipPct ?? adaptiveOpts.defaultPct ?? 3);
  const floor = ma * (1 - effectiveDip / 100);

  if (close < floor) {
    return { allowed: false, reason: 'BELOW_ADAPTIVE_FLOOR', ma, floor, dipPct: effectiveDip, filterId: filter.id };
  }

  const fixedAbove = filter.fixedAbovePct != null && filter.fixedAbovePct !== ''
    ? Number(filter.fixedAbovePct) : null;
  const effectiveAbove = Number.isFinite(fixedAbove)
    ? fixedAbove
    : Number(filter.maxAbovePct ?? 0);

  if (effectiveAbove > 0) {
    const ceiling = ma * (1 + effectiveAbove / 100);
    if (close > ceiling) {
      return {
        allowed: false,
        reason: 'ABOVE_ADAPTIVE_CEILING',
        ma, ceiling, abovePct: effectiveAbove, distPct, filterId: filter.id,
      };
    }
  }

  return {
    allowed: true, ma, floor, ceiling: effectiveAbove > 0 ? ma * (1 + effectiveAbove / 100) : null,
    dipPct: effectiveDip, abovePct: effectiveAbove > 0 ? effectiveAbove : null, distPct,
  };
}

function crossLabel(leg) {
  return maLabel(leg.period, leg.interval);
}

function activeMaFilters(config) {
  if (config.maFiltersEnabled === false) return [];
  return (config.maFilters ?? []).filter(f => f.enabled && f.mode !== 'off');
}

function checkEntryMaxAboveMa2(close, ma2, maxAboveMaPct) {
  const cap = Number(maxAboveMaPct);
  if (!cap || cap <= 0 || ma2 == null || ma2 <= 0) return { allowed: true };

  const cl = parseFloat(close);
  const abovePct = ((cl / ma2) - 1) * 100;
  if (abovePct > cap) {
    return {
      allowed: false,
      reason: 'ABOVE_MA2_MAX',
      aboveMa2Pct: abovePct,
      maxAboveMaPct: cap,
      ma2,
    };
  }
  return { allowed: true, aboveMa2Pct: abovePct, maxAboveMaPct: cap, ma2 };
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

  const trend = config.entryTrendMa;
  if (trend?.enabled !== false) {
    add(trend.ma1?.interval ?? '1h', (trend.ma1?.period ?? 9) + 30);
    if ((trend.ma2?.interval ?? '1h') !== (trend.ma1?.interval ?? '1h')) {
      add(trend.ma2.interval, (trend.ma2?.period ?? 21) + 30);
    }
  }

  const bbf = config.entryBbFilter;
  if (bbf?.enabled) {
    add(bbf.interval ?? '4h', (bbf.period ?? 20) + 10);
  }

  const exBbUpper = config.exit?.bbUpper;
  if (exBbUpper?.enabled) {
    add(exBbUpper.interval ?? '4h', (exBbUpper.period ?? 20) + 10);
  }

  const rsiConds = (config.exit?.rsi?.conditions ?? []).filter(c => c.enabled);
  for (const c of rsiConds) {
    add(c.interval, c.period + 50);
  }

  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

function evaluateEntryBbFilter(config, cMap, opts = {}) {
  const bb = config.entryBbFilter;
  if (!bb?.enabled) return { allowed: true };

  const closedOnly = opts.closedOnly !== false;
  const iv = bb.interval ?? '4h';
  const raw = cMap[iv] ?? [];
  const candles = closedOnly ? closedCandlesOnly(raw) : raw;

  if (candles.length < bb.period) {
    return { allowed: false, reason: 'BB_FILTER_NO_DATA', bbInterval: iv };
  }

  const closes = candles.map(c => parseFloat(c.close));
  const results = ti.BollingerBands.calculate({ period: bb.period, values: closes, stdDev: bb.stdDev ?? 2 });
  if (!results.length) return { allowed: false, reason: 'BB_FILTER_NO_DATA', bbInterval: iv };

  const lastBb = results[results.length - 1];
  const close  = closes[closes.length - 1];
  const range  = lastBb.upper - lastBb.lower;
  if (range <= 0) return { allowed: true };

  const pctB   = (close - lastBb.lower) / range;
  const maxPctB = bb.maxPctB ?? 0.3;

  if (pctB > maxPctB) {
    return {
      allowed: false,
      reason:  'BB_FILTER_ABOVE',
      pctB, maxPctB,
      lower:   lastBb.lower,
      upper:   lastBb.upper,
      middle:  lastBb.middle,
      bbInterval: iv,
    };
  }

  return {
    allowed: true,
    pctB, maxPctB,
    lower:   lastBb.lower,
    upper:   lastBb.upper,
    middle:  lastBb.middle,
    bbInterval: iv,
  };
}

function evaluateEntryTrendMa(config, cMap, opts = {}) {
  const trend = config.entryTrendMa;
  if (!trend?.enabled) return { allowed: true };

  const ma1Leg = trend.ma1 ?? { period: 9, interval: '1h' };
  const ma2Leg = trend.ma2 ?? { period: 21, interval: '1h' };
  const closedOnly = opts.closedOnly !== false;

  const c1raw = cMap[ma1Leg.interval] ?? [];
  const c2raw = ma1Leg.interval === ma2Leg.interval ? c1raw : (cMap[ma2Leg.interval] ?? []);
  const c1 = closedOnly ? closedCandlesOnly(c1raw) : c1raw;
  const c2 = closedOnly ? closedCandlesOnly(c2raw) : c2raw;

  const refIv = finestInterval(ma1Leg.interval, ma2Leg.interval);
  const refCandles = refIv === ma1Leg.interval ? c1 : c2;
  if (!refCandles?.length) {
    return { allowed: false, reason: 'HTF_TREND_NO_DATA' };
  }

  const refTime = opts.referenceOpenTime != null
    ? Number(opts.referenceOpenTime)
    : Number(refCandles[refCandles.length - 1].openTime);

  const series1 = buildMaTimeSeries(c1, ma1Leg.period);
  const series2 = buildMaTimeSeries(c2, ma2Leg.period);
  const ma1 = maValueAt(series1, refTime);
  const ma2 = maValueAt(series2, refTime);

  if (ma1 == null || ma2 == null) {
    return { allowed: false, reason: 'HTF_TREND_NO_MA', trendMa1: ma1, trendMa2: ma2 };
  }

  const tolerancePct = Math.max(0, Number(trend.tolerancePct ?? 0));
  const gapPct = ((ma1 / ma2) - 1) * 100;
  const floor = ma2 * (1 - tolerancePct / 100);

  if (ma1 < floor) {
    return {
      allowed: false,
      reason: 'HTF_TREND_BELOW',
      trendMa1: ma1,
      trendMa2: ma2,
      gapPct,
      tolerancePct,
      trendDesc: `${crossLabel(ma1Leg)} abaixo de ${crossLabel(ma2Leg)} (tol ${tolerancePct}%)`,
    };
  }

  return { allowed: true, trendMa1: ma1, trendMa2: ma2, gapPct, tolerancePct };
}

function evaluateMaFilters(close, config, cMap, adaptiveDips, adaptiveStretches = {}) {
  const details = [];
  for (const f of activeMaFilters(config)) {
    const filtCandles = cMap[f.interval] ?? [];
    const key = `${f.period}_${f.interval}`;
    const pf = checkPriceFilter(
      close, filtCandles, f, adaptiveDips[key], config.adaptiveOpts, adaptiveStretches[key],
    );
    if (!pf.allowed) return pf;
    details.push({ filter: f, ...pf });
  }
  return { allowed: true, details };
}

function pullbackEntryEnabled(config) {
  return config.execution?.pullbackEntry?.enabled !== false;
}

function signalInterval(entry) {
  return intervalMs(entry.ma1.interval) <= intervalMs(entry.ma2.interval)
    ? entry.ma1.interval
    : entry.ma2.interval;
}

/** Cruzamento MA — sem teto MA2 (usado para iniciar fase PENDING). */
function evaluateCrossSignal(config, cMap, adaptiveDips = {}, opts = {}) {
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
      crossOpenTime: cross.openTime,
    };
  }

  const trendCheck = evaluateEntryTrendMa(config, cMap, opts);
  if (!trendCheck.allowed) {
    return {
      allowed: false,
      reason: trendCheck.reason,
      ma1: cross.ma1, ma2: cross.ma2,
      close: cross.close,
      crossOpenTime: cross.openTime,
      trendMa1: trendCheck.trendMa1,
      trendMa2: trendCheck.trendMa2,
      trendDesc: trendCheck.trendDesc,
    };
  }

  const bbCheck = evaluateEntryBbFilter(config, cMap, opts);
  if (!bbCheck.allowed) {
    return {
      allowed: false,
      reason: bbCheck.reason,
      ma1: cross.ma1, ma2: cross.ma2,
      close: cross.close,
      crossOpenTime: cross.openTime,
      pctB: bbCheck.pctB,
      maxPctB: bbCheck.maxPctB,
      bbInterval: bbCheck.bbInterval,
    };
  }

  const dirLbl = entry.direction === 'cross_down' ? '↓' : '↑';
  return {
    allowed: true,
    ma1: cross.ma1, ma2: cross.ma2, close: cross.close,
    crossOpenTime: cross.openTime,
    entryDesc: `${crossLabel(entry.ma1)} ${dirLbl} ${crossLabel(entry.ma2)}`,
    trendMa1: trendCheck.trendMa1, trendMa2: trendCheck.trendMa2, trendGapPct: trendCheck.gapPct,
    pctB: bbCheck.pctB, bbUpper: bbCheck.upper, bbLower: bbCheck.lower, bbMiddle: bbCheck.middle,
    bbInterval: bbCheck.bbInterval,
  };
}

/**
 * Janela de até N candles após o sinal: entrada no 1º candle que passar
 * (pullback vs MA21 + teto MA2 + filtros MA). Não precisa esperar o N-ésimo
 * se o 1º (ou intermediário) já qualificar.
 * pending: { signalOpenTime, signalClose }
 */
function extensionAboveMa2(close, ma2) {
  if (ma2 == null || ma2 <= 0) return null;
  return ((parseFloat(close) / ma2) - 1) * 100;
}

function evaluatePullbackCandle(config, cMap, adaptiveDips, adaptiveStretches, {
  entryCandle, signal, signalClose, requirePullback,
}) {
  const entry = config.entry;
  const close = parseFloat(entryCandle.close);
  const c2 = closedCandlesOnly(cMap[entry.ma2.interval] ?? []);
  const ma2AtEntry = maValueAt(buildMaTimeSeries(c2, entry.ma2.period), entryCandle.openTime);
  const ma2AtSignal = maValueAt(buildMaTimeSeries(c2, entry.ma2.period), signal.openTime);
  const aboveEntryPct = extensionAboveMa2(close, ma2AtEntry);
  const aboveSignalPct = extensionAboveMa2(signalClose, ma2AtSignal);

  if (requirePullback) {
    if (aboveEntryPct == null || aboveSignalPct == null) {
      return { ready: false, reason: 'FILTER_NO_MA', close, ma2: ma2AtEntry };
    }
    // Pullback = candle de entrada mais próximo da MA21 que no sinal
    if (aboveEntryPct >= aboveSignalPct) {
      return {
        ready: false,
        reason: 'NO_PULLBACK',
        close,
        ma2: ma2AtEntry,
        aboveMa2Pct: aboveEntryPct,
        signalAboveMa2Pct: aboveSignalPct,
        pullbackVsMa2Pct: aboveEntryPct - aboveSignalPct,
      };
    }
  }

  const ma2Cap = checkEntryMaxAboveMa2(close, ma2AtEntry, entry.maxAboveMaPct);
  if (!ma2Cap.allowed) {
    return {
      ready: false,
      reason: ma2Cap.reason,
      close,
      ma2: ma2AtEntry,
      aboveMa2Pct: ma2Cap.aboveMa2Pct,
    };
  }

  const filterCheck = evaluateMaFilters(close, config, cMap, adaptiveDips, adaptiveStretches);
  if (!filterCheck.allowed) {
    return {
      ready: false,
      reason: filterCheck.reason,
      close,
      filterMa: filterCheck.ma,
    };
  }

  const trendCheck = evaluateEntryTrendMa(config, cMap);
  if (!trendCheck.allowed) {
    return {
      ready: false,
      reason: trendCheck.reason,
      close,
      trendMa1: trendCheck.trendMa1,
      trendMa2: trendCheck.trendMa2,
      trendDesc: trendCheck.trendDesc,
    };
  }

  const bbCheck = evaluateEntryBbFilter(config, cMap);
  if (!bbCheck.allowed) {
    return {
      ready: false,
      reason: bbCheck.reason,
      close,
      pctB: bbCheck.pctB,
      maxPctB: bbCheck.maxPctB,
      bbInterval: bbCheck.bbInterval,
    };
  }

  const dirLbl = entry.direction === 'cross_down' ? '↓' : '↑';
  return {
    ready: true,
    close,
    ma1: maValueAt(buildMaTimeSeries(closedCandlesOnly(cMap[entry.ma1.interval] ?? []), entry.ma1.period), entryCandle.openTime),
    ma2: ma2AtEntry,
    signalClose,
    aboveMa2Pct: ma2Cap.aboveMa2Pct,
    signalAboveMa2Pct: aboveSignalPct,
    pullbackVsMa2Pct: aboveSignalPct != null && aboveEntryPct != null
      ? aboveEntryPct - aboveSignalPct
      : null,
    entryDesc: `${crossLabel(entry.ma1)} ${dirLbl} ${crossLabel(entry.ma2)} (pullback)`,
    entryOpenTime: entryCandle.openTime,
    maFilterDetails: filterCheck.details,
    trendMa1: trendCheck.trendMa1, trendMa2: trendCheck.trendMa2, trendGapPct: trendCheck.gapPct,
    pctB: bbCheck.pctB, bbUpper: bbCheck.upper, bbLower: bbCheck.lower, bbMiddle: bbCheck.middle,
    bbInterval: bbCheck.bbInterval,
  };
}

function evaluatePullbackReady(config, cMap, adaptiveDips, pending, adaptiveStretches = {}) {
  if (!pending?.signalOpenTime) {
    return { ready: false, reason: 'NO_PENDING_SIGNAL', cancel: true };
  }

  const entry = config.entry;
  const pb = config.execution?.pullbackEntry ?? {};
  const wait = Math.max(1, Number(pb.waitCandles ?? 2));
  const requirePullback = pb.requirePullback !== false;
  const sigIv = signalInterval(entry);
  const candles = closedCandlesOnly(cMap[sigIv] ?? []);
  const signalOpenTime = Number(pending.signalOpenTime);
  const idx = candles.findIndex(c => Number(c.openTime) === signalOpenTime);

  if (idx < 0) {
    return { ready: false, reason: 'SIGNAL_LOST', cancel: true };
  }

  const windowEnd = idx + wait;
  const lastIdx = candles.length - 1;
  if (lastIdx <= idx) {
    return {
      ready: false,
      reason: 'WAITING_CANDLES',
      waited: 0,
      need: wait,
      cancel: false,
    };
  }
  if (lastIdx > windowEnd) {
    return { ready: false, reason: 'ENTRY_WINDOW_PASSED', cancel: true };
  }

  const signal = candles[idx];
  const signalClose = parseFloat(pending.signalClose ?? signal.close);
  const evalEnd = Math.min(lastIdx, windowEnd);
  let lastReject = null;

  // Entrada precoce: 1º candle da janela [idx+1 .. idx+wait] que passar
  for (let entryIdx = idx + 1; entryIdx <= evalEnd; entryIdx++) {
    const result = evaluatePullbackCandle(config, cMap, adaptiveDips, adaptiveStretches, {
      entryCandle: candles[entryIdx],
      signal,
      signalClose,
      requirePullback,
    });
    if (result.ready) {
      return {
        ...result,
        waited: entryIdx - idx,
        need: wait,
      };
    }
    lastReject = result;
  }

  // Ainda faltam candles na janela → segue aguardando (não cancela no 1º rejeite)
  if (lastIdx < windowEnd) {
    return {
      ready: false,
      reason: 'WAITING_CANDLES',
      waited: lastIdx - idx,
      need: wait,
      cancel: false,
      lastRejectReason: lastReject?.reason ?? null,
      aboveMa2Pct: lastReject?.aboveMa2Pct,
      signalAboveMa2Pct: lastReject?.signalAboveMa2Pct,
    };
  }

  // Último candle da janela também falhou → cancela
  return {
    ready: false,
    reason: lastReject?.reason ?? 'NO_PULLBACK',
    cancel: true,
    close: lastReject?.close,
    ma2: lastReject?.ma2,
    filterMa: lastReject?.filterMa,
    aboveMa2Pct: lastReject?.aboveMa2Pct,
    signalAboveMa2Pct: lastReject?.signalAboveMa2Pct,
    pullbackVsMa2Pct: lastReject?.pullbackVsMa2Pct,
    waited: wait,
    need: wait,
  };
}

function evaluateEntry(config, cMap, adaptiveDips = {}, opts = {}) {
  const adaptiveStretches = opts.adaptiveStretches ?? computeAdaptiveStretches(config, cMap);
  const crossSignal = evaluateCrossSignal(config, cMap, adaptiveDips, opts);
  if (!crossSignal.allowed) return crossSignal;

  const { close, ma1, ma2 } = crossSignal;
  const filterCheck = evaluateMaFilters(close, config, cMap, adaptiveDips, adaptiveStretches);
  if (!filterCheck.allowed) {
    return {
      allowed: false,
      reason: filterCheck.reason,
      ma1, ma2, close,
      filterMa: filterCheck.ma, distPct: filterCheck.distPct, floor: filterCheck.floor,
    };
  }

  const ma2Cap = checkEntryMaxAboveMa2(close, ma2, config.entry.maxAboveMaPct);
  if (!ma2Cap.allowed) {
    return {
      allowed: false,
      reason: ma2Cap.reason,
      ma1, ma2, close,
      aboveMa2Pct: ma2Cap.aboveMa2Pct,
      maxAboveMaPct: ma2Cap.maxAboveMaPct,
    };
  }

  return {
    allowed: true,
    ma1, ma2, close,
    crossOpenTime: crossSignal.crossOpenTime,
    entryDesc: crossSignal.entryDesc,
    maFilterDetails: filterCheck.details,
    trendMa1: crossSignal.trendMa1, trendMa2: crossSignal.trendMa2, trendGapPct: crossSignal.trendGapPct,
    pctB: crossSignal.pctB, bbUpper: crossSignal.bbUpper, bbLower: crossSignal.bbLower,
    bbMiddle: crossSignal.bbMiddle, bbInterval: crossSignal.bbInterval,
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

/**
 * Preço rompendo a banda superior da Bollinger Bands (topo) → sinal de venda.
 * A banda é ancorada nos candles já fechados (evita que ela "persiga" o preço ao
 * vivo), mas a comparação usa o preço atual do candle em formação — não espera o
 * fechamento do candle para reagir a um rompimento (que no timeframe 4h poderia
 * levar horas). breakoutPct exige que o preço fique N% acima da banda (não só
 * tocando) para confirmar o rompimento e evitar vendas por um toque raso.
 */
function evaluateBbUpperExit(config, cMap, opts = {}) {
  const bb = config.exit?.bbUpper;
  if (!bb?.enabled) return { hit: false };

  const closedOnly = opts.closedOnly !== false;
  const iv = bb.interval ?? '4h';
  const raw = cMap[iv] ?? [];
  const candles = closedOnly ? closedCandlesOnly(raw) : raw;

  if (candles.length < bb.period) return { hit: false };

  const closes = candles.map(c => parseFloat(c.close));
  const results = ti.BollingerBands.calculate({ period: bb.period, values: closes, stdDev: bb.stdDev ?? 2 });
  if (!results.length) return { hit: false };

  const lastBb = results[results.length - 1];
  const close  = closedOnly ? parseFloat(raw.at(-1)?.close ?? closes.at(-1)) : closes[closes.length - 1];
  const threshold = lastBb.upper * (1 + (bb.breakoutPct ?? 0) / 100);

  if (close >= threshold) {
    return { hit: true, close, upper: lastBb.upper, lower: lastBb.lower, middle: lastBb.middle, bbInterval: iv, threshold };
  }
  return { hit: false, close, upper: lastBb.upper, threshold, bbInterval: iv };
}

/** Vende quando o ganho desde a entrada atinge o alvo (sugerido do histórico BB fundo→topo). */
function evaluateBbTakeProfitExit(config, entryPrice, lastClose) {
  const tp = config.exit?.bbTakeProfit;
  if (!tp?.enabled || !entryPrice || lastClose == null) return { hit: false };

  const gainPct = ((lastClose - entryPrice) / entryPrice) * 100;
  if (gainPct >= tp.targetPct) {
    return { hit: true, gainPct, targetPct: tp.targetPct };
  }
  return { hit: false, gainPct, targetPct: tp.targetPct };
}

/**
 * Piso do stop-loss. Com trailing ativo, sobe a cada degrau de trailStepPct
 * (padrão = maxLossPct): preço +5% → piso sobe para (novo degrau − maxLossPct).
 */
function computeStopLossFloor(entryPrice, peakPrice, stopLoss = {}) {
  const maxLossPct = stopLoss.maxLossPct ?? 5;
  if (!entryPrice || entryPrice <= 0) return null;

  const trailing = stopLoss.trailing !== false;
  const peak = peakPrice != null ? Math.max(entryPrice, peakPrice) : entryPrice;

  if (!trailing || !stopLoss.enabled) {
    return entryPrice * (1 - maxLossPct / 100);
  }

  const stepPct = Math.max(0.5, Number(stopLoss.trailStepPct ?? maxLossPct));
  const risePct = ((peak - entryPrice) / entryPrice) * 100;
  const steps = Math.floor(Math.max(0, risePct) / stepPct);
  const anchorPrice = entryPrice * (1 + (steps * stepPct) / 100);
  return anchorPrice * (1 - maxLossPct / 100);
}

const EXIT_REASON_BY_KIND = {
  ma:           'MA_CROSS_EXIT',
  rsi:          'RSI_EXIT',
  bbUpper:      'BB_UPPER_EXIT',
  bbTakeProfit: 'BB_TAKE_PROFIT_EXIT',
};

function evaluateExit(config, cMap, entryPrice, opts = {}) {
  const closedOnly = opts.closedOnly !== false;
  const c1 = cMap[config.exit?.maCross?.ma1?.interval] ?? [];
  const c2 = cMap[config.exit?.maCross?.ma2?.interval] ?? [];
  const lastClose = c1.at(-1)?.close ?? c2.at(-1)?.close
    ?? cMap[config.exit?.bbUpper?.interval]?.at(-1)?.close
    ?? cMap[config.entry?.ma1?.interval]?.at(-1)?.close;

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
        exitDesc: `${maLabel(exMa.ma1.period, exMa.ma1.interval)} ${dirLbl} ${maLabel(exMa.ma2.period, exMa.ma2.interval)}`,
        ma1: cross.ma1, ma2: cross.ma2, close: cross.close,
      });
    }
  }

  const rsiExit = evaluateRsiExit(config, cMap);
  if (rsiExit.hit) {
    signals.push({ kind: 'rsi', exitRsi: rsiExit.exitRsi, results: rsiExit.results });
  }

  const bbUpperExit = evaluateBbUpperExit(config, cMap, { closedOnly });
  if (bbUpperExit.hit) {
    const bbu = config.exit.bbUpper;
    const breakoutTxt = bbu.breakoutPct ? ` +${bbu.breakoutPct}%` : '';
    signals.push({
      kind: 'bbUpper',
      close: bbUpperExit.close,
      exitDesc: `BB(${bbu.period},${bbu.stdDev}) ${bbu.interval} banda superior${breakoutTxt}`,
    });
  }

  const bbTpExit = evaluateBbTakeProfitExit(config, entryPrice, lastClose);
  if (bbTpExit.hit) {
    signals.push({
      kind: 'bbTakeProfit',
      close: lastClose,
      gainPct: bbTpExit.gainPct,
      exitDesc: `alvo BB histórico +${bbTpExit.targetPct}%`,
    });
  }

  const logic = config.exit?.logic ?? 'any';
  const enabledKinds = ['ma', 'rsi', 'bbUpper', 'bbTakeProfit'].filter(kind => (
    kind === 'ma' ? exMa?.enabled : config.exit?.[kind]?.enabled
  ));

  let tacticalExit = false;
  if (enabledKinds.length > 1) {
    tacticalExit = logic === 'all'
      ? enabledKinds.every(kind => signals.some(s => s.kind === kind))
      : signals.length > 0;
  } else if (enabledKinds.length === 1) {
    tacticalExit = signals.length > 0;
  }

  if (tacticalExit) {
    const primary = signals[0];
    return {
      exit: true,
      reason: EXIT_REASON_BY_KIND[primary.kind] ?? 'MA_CROSS_EXIT',
      close: primary.close ?? lastClose,
      exitRsi: primary.exitRsi,
      exitDesc: primary.exitDesc,
      ma1: primary.ma1,
      ma2: primary.ma2,
      gainPct: primary.gainPct,
    };
  }

  if (config.stopLoss?.enabled && entryPrice && lastClose != null) {
    const peakPrice = opts.peakPrice != null ? opts.peakPrice : entryPrice;
    const floor = computeStopLossFloor(entryPrice, peakPrice, config.stopLoss);
    if (floor != null && lastClose <= floor) {
      return {
        exit: true,
        reason: 'STOP_LOSS',
        close: lastClose,
        dropPct: ((lastClose - entryPrice) / entryPrice) * 100,
        stopFloor: floor,
        peakPrice,
      };
    }
    return {
      exit: false,
      close: lastClose,
      exitRsi: rsiExit.exitRsi,
      stopFloor: floor,
      peakPrice,
    };
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

function computeAdaptiveStretches(config, cMap) {
  const stretches = {};
  const opts = config.adaptiveOpts ?? {};
  for (const f of activeMaFilters(config)) {
    if (f.mode !== 'adaptive') continue;
    const candles = cMap[f.interval] ?? [];
    const { stretchPct } = analyzeAdaptiveStretch(candles, f.period, {
      defaultPct:  opts.defaultAbovePct ?? 4,
      maxPct:      Math.min(f.maxAbovePct ?? opts.maxAbovePct ?? 8, opts.maxAbovePct ?? 8),
      minPct:      opts.minAbovePct ?? 0.5,
      minEpisodes: opts.minEpisodes ?? 3,
    });
    stretches[`${f.period}_${f.interval}`] = stretchPct;
  }
  return stretches;
}

function getFinestPollInterval(config) {
  const ivs = getRequiredSpecs(config).map(s => s.interval);
  if (!ivs.length) return '15m';
  return ivs.reduce((a, b) => (intervalMs(a) <= intervalMs(b) ? a : b));
}

/**
 * Detecta o último flip de lado (ma1 vs ma2) usando os candles AO VIVO, ignorando buracos na série.
 * findRecentMaCross exige candles consecutivos e usa só candles fechados, então perde cruzamentos
 * frescos (candle atual) e séries com gaps. Este fallback fecha essas duas lacunas para o display.
 */
function detectLiveSideFlip({
  candles1, period1, interval1,
  candles2, period2, interval2,
  now = Date.now(),
}) {
  const sigIv = finestInterval(interval1, interval2);
  const sigCandles = sigIv === interval1 ? candles1 : candles2;
  if (!sigCandles?.length || sigCandles.length < 2) return null;

  const series1 = buildMaTimeSeries(candles1, period1);
  const series2 = buildMaTimeSeries(candles2, period2);
  if (!series1.length || !series2.length) return null;

  const points = [];
  for (const c of sigCandles) {
    const m1 = maValueAt(series1, c.openTime);
    const m2 = maValueAt(series2, c.openTime);
    if (m1 == null || m2 == null) continue;
    const diff = m1 - m2;
    if (diff === 0) continue;
    points.push({
      sign: diff > 0 ? 1 : -1,
      closeTime: c.closeTime ?? (c.openTime + intervalMs(sigIv)),
    });
  }
  if (points.length < 2) return null;

  const curSign = points[points.length - 1].sign;
  for (let i = points.length - 1; i >= 1; i--) {
    if (points[i].sign === curSign && points[i - 1].sign !== curSign) {
      return {
        direction: curSign > 0 ? 'up' : 'down',
        crossAt: points[i].closeTime,
        ageMin: Math.max(0, now - points[i].closeTime) / 60_000,
      };
    }
  }
  return null; // mesmo lado durante toda a janela → sem cruzamento recente
}

/** Métricas para sort de favoritos: gap até cruzar ↑/↓ e idade do último cruzamento. */
function getMaCrossMetrics({
  candles1, period1, interval1,
  candles2, period2, interval2,
  tolerancePct = 0,
  proximityPct = 1,
  crossLookbackMin = 1440,
  now = Date.now(),
}) {
  const c1 = closedCandlesOnly(candles1);
  const c2 = closedCandlesOnly(candles2);
  const sigIv = finestInterval(interval1, interval2);
  const sigCandles = sigIv === interval1 ? c1 : c2;

  if (!sigCandles?.length || sigCandles.length < 3) {
    return { ok: false, reason: 'INSUFFICIENT_DATA' };
  }

  const series1 = buildMaTimeSeries(c1, period1);
  const series2 = buildMaTimeSeries(c2, period2);
  if (series1.length < 1 || series2.length < 1) {
    return { ok: false, reason: 'INSUFFICIENT_MA' };
  }

  const last = sigCandles[sigCandles.length - 1];
  const ma1 = maValueAt(series1, last.openTime);
  const ma2 = maValueAt(series2, last.openTime);
  if (ma1 == null || ma2 == null) {
    return { ok: false, reason: 'INSUFFICIENT_MA' };
  }

  let gapUpPct = null;
  let gapDownPct = null;
  if (ma1 < ma2 && ma2 > 0) gapUpPct = ((ma2 - ma1) / ma2) * 100;
  if (ma1 > ma2 && ma2 > 0) gapDownPct = ((ma1 - ma2) / ma2) * 100;

  const crossUp = findRecentMaCross({
    candles1: c1, period1, interval1,
    candles2: c2, period2, interval2,
    direction: 'cross_up', tolerancePct,
    maxAgeMin: crossLookbackMin, closedOnly: true, now,
  });
  const crossDown = findRecentMaCross({
    candles1: c1, period1, interval1,
    candles2: c2, period2, interval2,
    direction: 'cross_down', tolerancePct,
    maxAgeMin: crossLookbackMin, closedOnly: true, now,
  });

  const round = (v) => (v != null ? Math.round(v * 100) / 100 : null);

  const prox = Math.max(0, proximityPct ?? 1);
  const nearUp = checkMaCrossApproaching({
    candles1, period1, interval1,
    candles2, period2, interval2,
    mode: 'near_up', proximityPct: prox, closedOnly: false,
  });
  const nearDown = checkMaCrossApproaching({
    candles1, period1, interval1,
    candles2, period2, interval2,
    mode: 'near_down', proximityPct: prox, closedOnly: false,
  });
  const nearUpListed = checkMaCrossNearProximity({
    candles1, period1, interval1,
    candles2, period2, interval2,
    mode: 'near_up', proximityPct: prox, closedOnly: true,
  });
  const nearDownListed = checkMaCrossNearProximity({
    candles1, period1, interval1,
    candles2, period2, interval2,
    mode: 'near_down', proximityPct: prox, closedOnly: true,
  });

  const liveSig = sigIv === interval1 ? candles1 : candles2;
  const liveLast = liveSig[liveSig.length - 1];
  const liveSeries1 = buildMaTimeSeries(candles1, period1);
  const liveSeries2 = buildMaTimeSeries(candles2, period2);
  const liveMa1 = maValueAt(liveSeries1, liveLast.openTime);
  const liveMa2 = maValueAt(liveSeries2, liveLast.openTime);
  let liveGapUpPct = null;
  let liveGapDownPct = null;
  if (liveMa1 != null && liveMa2 != null && liveMa2 > 0) {
    if (liveMa1 < liveMa2) liveGapUpPct = ((liveMa2 - liveMa1) / liveMa2) * 100;
    if (liveMa1 > liveMa2) liveGapDownPct = ((liveMa1 - liveMa2) / liveMa2) * 100;
  }

  // Lado ao vivo manda: fecha o atraso de 1 candle entre os flags "held" (só candles fechados)
  // e o gap/approaching (calculados ao vivo). Sem isso, um símbolo que cruzou no candle atual
  // continua mostrando o badge do estado anterior (ex.: BEL "cruzou ↑" mesmo já estando abaixo).
  const liveSide = (liveMa1 != null && liveMa2 != null && liveMa1 !== liveMa2)
    ? (liveMa1 > liveMa2 ? 'up' : 'down')
    : null;

  let crossUpHeld = crossUp.matched === true;
  let crossDownHeld = crossDown.matched === true;
  let crossUpAgeMin = crossUp.crossTime != null ? round(crossUp.ageMin) : null;
  let crossDownAgeMin = crossDown.crossTime != null ? round(crossDown.ageMin) : null;

  if (liveSide === 'down') crossUpHeld = false;
  if (liveSide === 'up') crossDownHeld = false;

  // Fallback ao vivo para séries com buracos (candles faltando): findRecentMaCross ignora pares
  // não consecutivos e perde o cruzamento. Aqui detectamos o flip real ignorando gaps.
  const liveFlip = detectLiveSideFlip({
    candles1, period1, interval1,
    candles2, period2, interval2,
    now,
  });
  if (liveFlip && liveFlip.ageMin <= crossLookbackMin) {
    if (liveFlip.direction === 'up' && liveSide === 'up') {
      if (!crossUpHeld || crossUpAgeMin == null || liveFlip.ageMin < crossUpAgeMin) {
        crossUpHeld = true;
        crossUpAgeMin = round(liveFlip.ageMin);
      }
      crossDownHeld = false;
    } else if (liveFlip.direction === 'down' && liveSide === 'down') {
      if (!crossDownHeld || crossDownAgeMin == null || liveFlip.ageMin < crossDownAgeMin) {
        crossDownHeld = true;
        crossDownAgeMin = round(liveFlip.ageMin);
      }
      crossUpHeld = false;
    }
  }

  return {
    ok: true,
    ma1: liveMa1 ?? ma1, ma2: liveMa2 ?? ma2,
    gapUpPct: round(nearUpListed.matched ? nearUpListed.gapPct : liveGapUpPct ?? gapUpPct),
    gapDownPct: round(nearDownListed.matched ? nearDownListed.gapPct : liveGapDownPct ?? gapDownPct),
    crossUpAgeMin,
    crossDownAgeMin,
    crossUpHeld,
    crossDownHeld,
    approachingUp: nearUp.matched === true,
    approachingDown: nearDown.matched === true,
    nearUpListed: nearUpListed.matched === true,
    nearDownListed: nearDownListed.matched === true,
    proximityPct: prox,
  };
}

module.exports = {
  INTERVAL_MS,
  intervalMs,
  computeMa,
  computeRsi,
  buildMaTimeSeries,
  maValueAt,
  closedCandlesOnly,
  detectCrossAtPair,
  findRecentMaCross,
  checkMaCrossover,
  checkMaCrossApproaching,
  checkMaCrossNearProximity,
  checkMaPosition,
  evaluateMaCrossSignal,
  checkPriceFilter,
  checkRsi,
  getRequiredSpecs,
  evaluateEntry,
  evaluateEntryBbFilter,
  evaluateEntryTrendMa,
  evaluateExit,
  computeStopLossFloor,
  computeAdaptiveDips,
  computeAdaptiveStretches,
  getFinestPollInterval,
  getMaCrossMetrics,
  checkEntryMaxAboveMa2,
  evaluateCrossSignal,
  evaluatePullbackReady,
  pullbackEntryEnabled,
};
