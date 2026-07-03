'use strict';

/**
 * Regra 2 — Entrada MA (toque/cruzamento) após N candles acima da MA.
 * Saída: uma ou mais condições RSI (OR/AND) + stop adaptativo na MA de entrada.
 */

const { calculateMa } = require('../../utils/movingAverage');
const { analyzeAdaptiveDip, lastMa } = require('./adaptiveMaDip');
const { checkRsi, checkMaEntryTrigger, checkMaFilters, resolveActiveMaFilters, maKey, capStopLossDipPct, applyEntryStopCap } = require('./strategyEngine');

const DEFAULT_EXIT_RSI = { interval: '1h', period: 14, operator: '>', value: 70 };

function rule2Active(config) {
  return config?.rule2?.enabled === true;
}

/** Filtros MA de entrada — mesmos da regra 1 (maConditions / maFilters) */
function getRule2MaEntryFilters(config) {
  const r2 = config?.rule2;
  if (r2?.maEntryFilters?.length) return r2.maEntryFilters;
  return resolveActiveMaFilters(config);
}

/**
 * Os `count` candles imediatamente anteriores ao candle de sinal devem ter close > MA(period).
 * @param {number} [signalOpenTime] — openTime do candle onde o gatilho MA é avaliado
 */
function checkCandlesAboveMa(candles, period, interval, entryTimeMs, count, signalOpenTime) {
  if (!count || count <= 0) return { allowed: true };
  if (!candles?.length) {
    return { allowed: false, reason: 'ABOVE_MA_NO_DATA', required: count, got: 0 };
  }

  const signalTime = signalOpenTime ?? candles[candles.length - 1]?.openTime;
  const signalIdx = candles.findIndex(c => c.openTime === signalTime);
  if (signalIdx < 0) {
    return { allowed: false, reason: 'ABOVE_MA_NO_DATA', required: count };
  }

  const prior = candles.slice(Math.max(0, signalIdx - count - 1), Math.max(0, signalIdx - 1));
  if (prior.length < count) {
    return { allowed: false, reason: 'ABOVE_MA_INSUFFICIENT_DATA', required: count, got: prior.length };
  }

  const closes = candles.map(c => c.close);
  const timeToIdx = new Map(candles.map((c, i) => [c.openTime, i]));

  for (const candle of prior) {
    const idx = timeToIdx.get(candle.openTime);
    if (idx == null || idx < period - 1) {
      return { allowed: false, reason: 'ABOVE_MA_INSUFFICIENT_DATA', required: count };
    }
    const sliceCloses = closes.slice(0, idx + 1);
    const maArr = calculateMa(sliceCloses, period);
    const ma = maArr[maArr.length - 1];
    if (candle.close <= ma) {
      return {
        allowed: false,
        reason: 'ABOVE_MA_NOT_MET',
        failedAt: candle.openTime,
        close: candle.close,
        ma,
      };
    }
  }

  return { allowed: true, count };
}

function normalizeExitRsiCondition(c, fallback = DEFAULT_EXIT_RSI) {
  const fb = fallback ?? DEFAULT_EXIT_RSI;
  return {
    enabled:  c?.enabled !== false,
    interval: c?.interval ?? fb.interval,
    period:   Number(c?.period ?? fb.period),
    operator: c?.operator ?? fb.operator,
    value:    Number(c?.value ?? fb.value),
  };
}

/** Lista de condições RSI de saída ativas (migra exitRsi legado). */
function getRule2ExitRsiConditions(rule2) {
  const raw = rule2?.exitRsiConditions;
  if (Array.isArray(raw) && raw.length) {
    return raw.map(c => normalizeExitRsiCondition(c)).filter(c => c.enabled);
  }
  if (rule2?.exitRsi) return [normalizeExitRsiCondition(rule2.exitRsi)];
  return [normalizeExitRsiCondition(DEFAULT_EXIT_RSI)];
}

function getRule2RequiredSpecs(rule2, config) {
  if (!rule2?.enabled) return [];
  const em = rule2.entryMa;
  const specs = new Map();
  const add = (interval, limit) => {
    specs.set(interval, Math.max(specs.get(interval) ?? 0, limit));
  };
  const aboveN = em.aboveMaEnabled === true ? (em.aboveMaCandles ?? 10) : 0;
  add(em.interval, em.period + aboveN + 30);
  for (const c of getRule2ExitRsiConditions(rule2)) {
    add(c.interval, c.period + 50);
  }
  for (const f of getRule2MaEntryFilters(config ?? {})) {
    const filterAboveN = f.aboveMaEnabled === true ? (f.aboveMaCandles ?? 10) : 0;
    add(f.interval, f.period + filterAboveN + 80);
  }
  if (rule2.stopLoss?.adaptiveEnabled !== false) {
    const stopAboveN = rule2.stopLoss?.adaptiveAboveMaEnabled === true
      ? (rule2.stopLoss.adaptiveAboveMaCandles ?? 10) : 0;
    add(em.interval, em.period + stopAboveN + 30);
  }
  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

function computeRule2AdaptiveDip(candles, rule2) {
  const em = rule2.entryMa;
  const opts = rule2.adaptiveOpts ?? {};
  if (em.fixedDipPct != null && em.fixedDipPct !== '') {
    return capStopLossDipPct(Number(em.fixedDipPct));
  }
  return capStopLossDipPct(analyzeAdaptiveDip(candles, em.period, opts).dipPct);
}

function getRule2StopFloor(maSnap, adaptiveDip, rule2) {
  const em = rule2.entryMa;
  const key = maKey(em.period, em.interval);
  const md = maSnap[key];
  if (!md?.ma) return null;
  const dipPct = capStopLossDipPct(adaptiveDip ?? rule2.adaptiveOpts?.defaultPct ?? 3);
  return {
    floor: md.ma * (1 - dipPct / 100),
    dipPct,
    ma: md.ma,
    period: em.period,
    interval: em.interval,
    key,
  };
}

function evaluateRule2Entry({
  close, low, prevClose, entryTimeMs, signalOpenTime, rule2, maSnap,
  maSnapFilters, adaptiveDips, maEntryFilters, filterClose,
}) {
  if (!rule2Active({ rule2 })) {
    return { allowed: false, reason: 'RULE_OFF', entryKind: 'rule2' };
  }

  const priceForFilters = filterClose ?? close;
  const filters = maEntryFilters ?? [];
  if (filters.length) {
    const maCheck = checkMaFilters({
      close: priceForFilters,
      maFilters: filters,
      maSnap: maSnapFilters ?? maSnap,
      adaptiveDips: adaptiveDips ?? {},
      entryTimeMs,
      signalOpenTime,
    });
    if (!maCheck.allowed) {
      return { ...maCheck, entryKind: 'rule2' };
    }
  }

  const em = rule2.entryMa;
  const key = maKey(em.period, em.interval);
  const md = maSnap[key];

  const aboveN = em.aboveMaCandles ?? 10;
  if (em.aboveMaEnabled === true && aboveN > 0) {
    const aboveCheck = checkCandlesAboveMa(
      md?.candles, em.period, em.interval, entryTimeMs, aboveN, signalOpenTime,
    );
    if (!aboveCheck.allowed) {
      return { ...aboveCheck, entryKind: 'rule2' };
    }
  }

  const fakeConfig = { entryMa: { ...em, enabled: true } };
  const mt = checkMaEntryTrigger({ close, low, prevClose, maSnap, config: fakeConfig });
  if (!mt.triggered) {
    return { allowed: false, reason: 'NO_ENTRY_SIGNAL', entryKind: 'rule2', maTrigger: mt };
  }

  return { allowed: true, reason: null, entryKind: 'rule2', maTrigger: mt };
}

/**
 * @param {Record<string, number|null>} exitRsiMap — RSI por intervalo (ex. { '1h': 72, '15m': 81 })
 */
function checkRule2ExitRsiConditions(exitRsiMap, rule2) {
  const conditions = getRule2ExitRsiConditions(rule2);
  if (!conditions.length) return null;

  const logic = rule2.exitRsiLogic ?? 'any';
  const hits = conditions.filter(c => checkRsi(exitRsiMap?.[c.interval], c));

  if (logic === 'all') {
    return hits.length === conditions.length ? hits[0] : null;
  }
  return hits[0] ?? null;
}

function evaluateRule2Exit({ close, exitRsi, exitRsiMap, maSnap, adaptiveDip, rule2, entryPrice }) {
  if (rule2.stopLoss?.adaptiveEnabled !== false) {
    const floor = getRule2StopFloor(maSnap, adaptiveDip, rule2);
    const stopLevel = floor ? applyEntryStopCap(floor.floor, entryPrice) : null;
    if (stopLevel != null && close < stopLevel) {
      const sl = rule2.stopLoss ?? {};
      let stopBlocked = false;
      if (sl.adaptiveAboveMaEnabled === true) {
        const em = rule2.entryMa;
        const md = maSnap[maKey(em.period, em.interval)];
        const count = sl.adaptiveAboveMaCandles ?? 10;
        const signalOpenTime = md?.candles?.at(-1)?.openTime;
        const aboveCheck = checkCandlesAboveMa(
          md?.candles, em.period, em.interval, null, count, signalOpenTime,
        );
        stopBlocked = !aboveCheck.allowed;
      }
      if (!stopBlocked) {
        return {
          exit: true,
          reason: 'stop_loss_adaptive',
          stopLossLevel: stopLevel,
          dipPct: floor.dipPct,
          adaptiveKey: floor.key,
          adaptiveMa: floor.ma,
          period: floor.period,
          interval: floor.interval,
        };
      }
    }
  }

  const map = exitRsiMap ?? (exitRsi != null && rule2.exitRsi
    ? { [rule2.exitRsi.interval]: exitRsi }
    : {});
  const matched = checkRule2ExitRsiConditions(map, rule2);
  if (matched) {
    return {
      exit: true,
      reason: 'rsi',
      exitRsiCondition: matched,
      interval: matched.interval,
      threshold: matched.value,
    };
  }
  return { exit: false };
}

function shouldRule2ImmediateEntry() {
  return false;
}

function getRule2EntryDiscount(rule2) {
  const v = rule2?.entryDiscount ?? rule2?.execution?.entryDiscount ?? 0.02;
  return Math.min(0.1, Math.max(0.0001, v));
}

function buildRule2MaSnapshot(cMap, rule2) {
  const em = rule2.entryMa;
  const iv = em.interval;
  const candles = cMap[iv];
  if (!candles?.length) return {};
  const key = maKey(em.period, iv);
  return {
    [key]: { ma: lastMa(candles, em.period), candles, period: em.period, interval: iv },
  };
}

module.exports = {
  rule2Active,
  getRule2MaEntryFilters,
  getRule2RequiredSpecs,
  getRule2ExitRsiConditions,
  normalizeExitRsiCondition,
  checkCandlesAboveMa,
  checkRule2ExitRsiConditions,
  computeRule2AdaptiveDip,
  getRule2StopFloor,
  evaluateRule2Entry,
  evaluateRule2Exit,
  shouldRule2ImmediateEntry,
  getRule2EntryDiscount,
  buildRule2MaSnapshot,
};
