'use strict';

const ti = require('technicalindicators');

const INTERVAL_MS = {
  '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
  '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

function checkRsi(rsi, spec) {
  if (rsi == null || !Number.isFinite(rsi)) return false;
  const v = Number(spec.value);
  if (spec.operator === '<') return rsi < v;
  if (spec.operator === '<=') return rsi <= v;
  if (spec.operator === '>') return rsi > v;
  if (spec.operator === '>=') return rsi >= v;
  return false;
}

function computeRsi(candles, period) {
  const closes = candles.map(c => c.close);
  const arr = ti.RSI.calculate({ values: closes, period });
  return arr.length ? arr[arr.length - 1] : null;
}

function computeMa(candles, period) {
  const closes = candles.map(c => c.close);
  const arr = ti.SMA.calculate({ values: closes, period });
  return arr.length ? arr[arr.length - 1] : null;
}

function lastCandle(candles) {
  return candles[candles.length - 1];
}

function prevCandle(candles) {
  return candles.length >= 2 ? candles[candles.length - 2] : null;
}

/** Intervalos necessários para avaliar a config */
function getRequiredSpecs(config) {
  const specs = new Map();
  const add = (interval, limit) => {
    specs.set(interval, Math.max(specs.get(interval) ?? 0, limit));
  };

  if (config.kind === 'rsi') {
    add(config.entryRsi.interval, config.entryRsi.period + 50);
    if (config.entryMaFilter?.enabled) {
      add(config.entryMaFilter.interval, config.entryMaFilter.period + 10);
    }
  } else {
    add(config.entryMa.interval, config.entryMa.period + config.entryMa.aboveMaCandles + 10);
  }
  add(config.exitRsi.interval, config.exitRsi.period + 50);
  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

function checkMaFilter(close, ma, filter) {
  if (!filter?.enabled || ma == null) return true;
  if (filter.mode === 'strict_above') return close > ma;
  if (filter.mode === 'touch') {
    const tol = (filter.tolerancePct ?? 0.5) / 100;
    return close >= ma * (1 - tol);
  }
  return close > ma;
}

function checkMaEntry(candles, config) {
  const em = config.entryMa;
  const period = em.period;
  if (candles.length < period + em.aboveMaCandles + 2) {
    return { allowed: false, reason: 'INSUFFICIENT_DATA' };
  }

  const last  = lastCandle(candles);
  const prev  = prevCandle(candles);
  const ma    = computeMa(candles, period);
  const prevMa = computeMa(candles.slice(0, -1), period);
  if (ma == null || prevMa == null) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

  const tol = (em.tolerancePct ?? 0.5) / 100;

  if (em.aboveMaEnabled) {
    const n = em.aboveMaCandles ?? 3;
    for (let i = 1; i <= n; i++) {
      const slice = candles.slice(0, -i);
      const c = slice[slice.length - 1];
      const m = computeMa(slice, period);
      if (!m || c.close <= m) return { allowed: false, reason: 'ABOVE_MA_CANDLES' };
    }
  }

  if (em.trigger === 'above') {
    return last.close > ma
      ? { allowed: true, ma, close: last.close }
      : { allowed: false, reason: 'NOT_ABOVE_MA' };
  }

  if (em.trigger === 'touch') {
    const near = last.low <= ma * (1 + tol) && last.close >= ma * (1 - tol);
    return near
      ? { allowed: true, ma, close: last.close }
      : { allowed: false, reason: 'NO_MA_TOUCH' };
  }

  // cross_up (padrão)
  const crossed = prev.close <= prevMa * (1 + tol) && last.close > ma;
  return crossed
    ? { allowed: true, ma, close: last.close }
    : { allowed: false, reason: 'NO_MA_CROSS' };
}

function evaluateEntry(config, cMap) {
  if (config.kind === 'rsi') {
    const entryCandles = cMap[config.entryRsi.interval] ?? [];
    const entryRsi = computeRsi(entryCandles, config.entryRsi.period);
    const last = lastCandle(entryCandles);
    if (!last || entryRsi == null) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

    if (!checkRsi(entryRsi, config.entryRsi)) {
      return { allowed: false, reason: 'RSI_ENTRY', entryRsi, close: last.close };
    }

    let maFilter = null;
    if (config.entryMaFilter?.enabled) {
      const maCandles = cMap[config.entryMaFilter.interval] ?? [];
      const ma = computeMa(maCandles, config.entryMaFilter.period);
      maFilter = ma;
      if (!checkMaFilter(last.close, ma, config.entryMaFilter)) {
        return {
          allowed: false, reason: 'MA_FILTER',
          entryRsi, close: last.close, ma,
          distPct: ma ? ((last.close - ma) / ma * 100) : null,
        };
      }
    }

    return { allowed: true, entryRsi, close: last.close, ma: maFilter };
  }

  const maCandles = cMap[config.entryMa.interval] ?? [];
  const maCheck = checkMaEntry(maCandles, config);
  if (!maCheck.allowed) return maCheck;

  const exitCandles = cMap[config.exitRsi.interval] ?? [];
  const exitRsi = computeRsi(exitCandles, config.exitRsi.period);

  return {
    allowed: true,
    entryRsi: exitRsi,
    close: maCheck.close,
    ma: maCheck.ma,
    entryKind: 'ma',
  };
}

function evaluateExit(config, cMap, entryPrice) {
  const exitCandles = cMap[config.exitRsi.interval] ?? [];
  const exitRsi = computeRsi(exitCandles, config.exitRsi.period);
  const last = lastCandle(exitCandles);

  if (config.stopLoss?.enabled && entryPrice && last) {
    const floor = entryPrice * (1 - config.stopLoss.maxLossPct / 100);
    if (last.close <= floor) {
      return {
        exit: true,
        reason: 'STOP_LOSS',
        exitRsi,
        close: last.close,
        dropPct: ((last.close - entryPrice) / entryPrice * 100),
      };
    }
  }

  if (checkRsi(exitRsi, config.exitRsi)) {
    return { exit: true, reason: 'RSI_EXIT', exitRsi, close: last?.close };
  }

  return { exit: false, exitRsi, close: last?.close };
}

function getFinestPollInterval(config) {
  const ivs = getRequiredSpecs(config).map(s => s.interval);
  return ivs.reduce((a, b) =>
    (INTERVAL_MS[a] ?? 1e12) <= (INTERVAL_MS[b] ?? 1e12) ? a : b);
}

module.exports = {
  checkRsi,
  computeRsi,
  computeMa,
  getRequiredSpecs,
  evaluateEntry,
  evaluateExit,
  getFinestPollInterval,
  INTERVAL_MS,
};
