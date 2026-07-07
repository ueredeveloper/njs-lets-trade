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

/** Prestes a cruzar: gap encolhendo e dentro do limite % (MA ainda não cruzou). */
function checkMaCrossApproaching({
  candles1, period1, interval1,
  candles2, period2, interval2,
  mode, proximityPct = 1,
  closedOnly = true,
}) {
  const c1 = closedOnly ? closedCandlesOnly(candles1) : candles1;
  const c2 = closedOnly ? closedCandlesOnly(candles2) : candles2;

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

  const last = sigCandles[sigCandles.length - 1];
  const prev = sigCandles[sigCandles.length - 2];

  const ma1     = maValueAt(series1, last.openTime);
  const ma2     = maValueAt(series2, last.openTime);
  const prevMa1 = maValueAt(series1, prev.openTime);
  const prevMa2 = maValueAt(series2, prev.openTime);

  if ([ma1, ma2, prevMa1, prevMa2].some(v => v == null)) {
    return { matched: false, reason: 'MA_ALIGN_FAIL', ma1, ma2 };
  }

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
    close: last.close,
    openTime: last.openTime,
    reason: matched ? null : (mode === 'near_up' ? 'NOT_NEAR_UP' : 'NOT_NEAR_DOWN'),
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
    return checkMaCrossApproaching({
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

  const fixed = filter.fixedDipPct != null ? Number(filter.fixedDipPct) : null;
  const cap = filter.maxDipPct ?? adaptiveOpts.maxPct ?? 8;
  const dip = fixed ?? adaptiveDipPct ?? adaptiveOpts.defaultPct ?? 3;
  const effectiveDip = Math.min(dip, cap);
  const floor = ma * (1 - effectiveDip / 100);

  if (close < floor) {
    return { allowed: false, reason: 'BELOW_ADAPTIVE_FLOOR', ma, floor, dipPct: effectiveDip, filterId: filter.id };
  }

  const fixedAbove = filter.fixedAbovePct != null ? Number(filter.fixedAbovePct) : null;
  const capAbove = filter.maxAbovePct ?? adaptiveOpts.maxAbovePct ?? 8;
  const stretch = fixedAbove ?? adaptiveStretchPct ?? adaptiveOpts.defaultAbovePct ?? 4;
  const effectiveAbove = Math.min(stretch, capAbove);

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

  const rsiConds = (config.exit?.rsi?.conditions ?? []).filter(c => c.enabled);
  for (const c of rsiConds) {
    add(c.interval, c.period + 50);
  }

  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

function evaluateMaFilters(close, config, cMap, adaptiveDips, adaptiveStretches = {}) {
  for (const f of activeMaFilters(config)) {
    const filtCandles = cMap[f.interval] ?? [];
    const key = `${f.period}_${f.interval}`;
    const pf = checkPriceFilter(
      close, filtCandles, f, adaptiveDips[key], config.adaptiveOpts, adaptiveStretches[key],
    );
    if (!pf.allowed) return pf;
  }
  return { allowed: true };
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

  const dirLbl = entry.direction === 'cross_down' ? '↓' : '↑';
  return {
    allowed: true,
    ma1: cross.ma1, ma2: cross.ma2, close: cross.close,
    crossOpenTime: cross.openTime,
    entryDesc: `${crossLabel(entry.ma1)} ${dirLbl} ${crossLabel(entry.ma2)}`,
  };
}

/**
 * Após N candles do sinal: pullback (close vs MA21) + teto MA2 + filtros MA.
 * pending: { signalOpenTime, signalClose }
 */
function extensionAboveMa2(close, ma2) {
  if (ma2 == null || ma2 <= 0) return null;
  return ((parseFloat(close) / ma2) - 1) * 100;
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

  const entryIdx = idx + wait;
  const lastIdx = candles.length - 1;
  if (lastIdx < entryIdx) {
    return {
      ready: false,
      reason: 'WAITING_CANDLES',
      waited: lastIdx - idx,
      need: wait,
      cancel: false,
    };
  }
  if (lastIdx > entryIdx) {
    return { ready: false, reason: 'ENTRY_WINDOW_PASSED', cancel: true };
  }

  const signal = candles[idx];
  const entryCandle = candles[entryIdx];
  const close = parseFloat(entryCandle.close);
  const signalClose = parseFloat(pending.signalClose ?? signal.close);

  const c2 = closedCandlesOnly(cMap[entry.ma2.interval] ?? []);
  const ma2AtEntry = maValueAt(buildMaTimeSeries(c2, entry.ma2.period), entryCandle.openTime);
  const ma2AtSignal = maValueAt(buildMaTimeSeries(c2, entry.ma2.period), signal.openTime);
  const aboveEntryPct = extensionAboveMa2(close, ma2AtEntry);
  const aboveSignalPct = extensionAboveMa2(signalClose, ma2AtSignal);

  if (requirePullback) {
    if (aboveEntryPct == null || aboveSignalPct == null) {
      return { ready: false, reason: 'FILTER_NO_MA', cancel: true, close, ma2: ma2AtEntry };
    }
    // Pullback = candle de entrada mais próximo da MA21 que no sinal
    if (aboveEntryPct >= aboveSignalPct) {
      return {
        ready: false,
        reason: 'NO_PULLBACK',
        cancel: true,
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
      cancel: true,
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
      cancel: true,
      close,
      filterMa: filterCheck.ma,
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
        exitDesc: `${maLabel(exMa.ma1.period, exMa.ma1.interval)} ${dirLbl} ${maLabel(exMa.ma2.period, exMa.ma2.interval)}`,
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

  return {
    ok: true,
    ma1: liveMa1 ?? ma1, ma2: liveMa2 ?? ma2,
    gapUpPct: round(nearUp.matched ? nearUp.gapPct : liveGapUpPct ?? gapUpPct),
    gapDownPct: round(nearDown.matched ? nearDown.gapPct : liveGapDownPct ?? gapDownPct),
    crossUpAgeMin: crossUp.crossTime != null ? round(crossUp.ageMin) : null,
    crossDownAgeMin: crossDown.crossTime != null ? round(crossDown.ageMin) : null,
    crossUpHeld: crossUp.matched === true,
    crossDownHeld: crossDown.matched === true,
    approachingUp: nearUp.matched === true,
    approachingDown: nearDown.matched === true,
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
  evaluateMaCrossSignal,
  checkPriceFilter,
  checkRsi,
  getRequiredSpecs,
  evaluateEntry,
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
