'use strict';

/**
 * Regra 1 — Entrada RSI (15m) + filtros MA/extensão.
 * Saída própria: RSI 15m > 70 + stop MA fixa e/ou adaptativa (configurável, ex. MA50 4h / MA50 1h).
 * Independente da regra 2.
 */

const { analyzeAdaptiveDip, lastMa } = require('./adaptiveMaDip');
const {
  checkRsi,
  checkMaFilters,
  checkExtension,
  getExtensionIntervals,
  computeAdaptiveDips,
  buildMaSnapshot,
  getStopLossMa,
  checkStopLossHits,
  stopLossFixedActive,
  stopLossAdaptiveActive,
  maKey,
} = require('./strategyEngine');

function rule1Active(config) {
  return config?.rule1?.enabled !== false;
}

function getRule1RequiredSpecs(rule1) {
  const specs = new Map();
  const add = (interval, limit) => {
    specs.set(interval, Math.max(specs.get(interval) ?? 0, limit));
  };
  if (!rule1) return [];
  add(rule1.entryRsi.interval, rule1.entryRsi.period + 50);
  add(rule1.exitRsi.interval, rule1.exitRsi.period + 50);
  for (const f of rule1.maFilters ?? []) {
    add(f.interval, f.period + 60);
  }
  if (rule1.extension?.enabled) {
    const { threeInterval, fourInterval } = getExtensionIntervals(rule1.extension);
    add(threeInterval, 60);
    add(fourInterval, 60);
    add(rule1.extension.maInterval, (rule1.extension.maPeriod ?? 50) + 10);
  }
  if (stopLossFixedActive(rule1)) {
    add(rule1.stopLoss.interval, rule1.stopLoss.period + 10);
  }
  if (stopLossAdaptiveActive(rule1)) {
    const sl = rule1.stopLoss;
    add(sl.adaptiveInterval ?? '1h', (sl.adaptivePeriod ?? 50) + 80);
  }
  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

function applyRule1EntryFilters({ close, entryTimeMs, rule1, maSnap, adaptiveDips, cMap }) {
  const maCheck = checkMaFilters({
    close, maFilters: rule1.maFilters, maSnap, adaptiveDips,
  });
  if (!maCheck.allowed) return maCheck;

  if (rule1.extension?.enabled) {
    const extP = rule1.extension.maPeriod ?? 50;
    const extIv = rule1.extension.maInterval;
    const extKey = maKey(extP, extIv);
    const md = maSnap[extKey];
    const { threeInterval, fourInterval } = getExtensionIntervals(rule1.extension);
    const confirmCandles = cMap ? {
      three: cMap[threeInterval],
      four: cMap[fourInterval],
    } : { three: md?.candles, four: md?.candles };
    const extCheck = checkExtension(close, md?.ma, confirmCandles, rule1.extension, entryTimeMs);
    if (!extCheck.allowed) return extCheck;
  }

  return { allowed: true, reason: null };
}

function evaluateRule1Entry({ entryRsi, close, low, prevClose, entryTimeMs, rule1, maSnap, adaptiveDips, cMap }) {
  if (!rule1Active({ rule1 })) {
    return { allowed: false, reason: 'RULE_OFF', entryKind: 'rule1' };
  }
  if (!checkRsi(entryRsi, rule1.entryRsi)) {
    return { allowed: false, reason: 'NO_ENTRY_SIGNAL', entryKind: 'rule1' };
  }
  const filterResult = applyRule1EntryFilters({
    close, entryTimeMs, rule1, maSnap, adaptiveDips, cMap,
  });
  if (!filterResult.allowed) {
    return { ...filterResult, entryKind: 'rule1' };
  }
  return { allowed: true, reason: null, entryKind: 'rule1' };
}

/** Dip % para stop adaptativo da regra 1 (MA dedicada, não os filtros de entrada) */
function computeRule1StopAdaptiveDip(cMap, rule1) {
  const sl = rule1?.stopLoss;
  if (!sl || !stopLossAdaptiveActive(rule1)) return null;
  if (sl.adaptiveFixedDipPct != null && sl.adaptiveFixedDipPct !== '') {
    return Number(sl.adaptiveFixedDipPct);
  }
  const period = sl.adaptivePeriod ?? 50;
  const interval = sl.adaptiveInterval ?? '1h';
  const candles = cMap[interval];
  if (!candles?.length) return rule1.adaptiveOpts?.defaultPct ?? 3;
  return analyzeAdaptiveDip(candles, period, rule1.adaptiveOpts).dipPct;
}

/** Pisos de stop adaptativo — só a MA configurada em stopLoss.adaptivePeriod/Interval */
function getRule1AdaptiveStopFloors(maSnap, stopDipPct, rule1) {
  if (!stopLossAdaptiveActive(rule1)) return [];
  const sl = rule1.stopLoss;
  const period = sl.adaptivePeriod ?? 50;
  const interval = sl.adaptiveInterval ?? '1h';
  const key = maKey(period, interval);
  const md = maSnap[key];
  if (!md?.ma) return [];
  const dipPct = stopDipPct ?? rule1.adaptiveOpts?.defaultPct ?? 3;
  return [{
    floor: md.ma * (1 - dipPct / 100),
    dipPct,
    ma: md.ma,
    period,
    interval,
    key,
  }];
}

function evaluateRule1Exit({ close, exitRsi, rule1, maSnap, stopDipPct }) {
  const stopLossMa = getStopLossMa(maSnap, rule1);
  const adaptiveFloors = getRule1AdaptiveStopFloors(maSnap, stopDipPct, rule1);
  const stopHit = checkStopLossHits(close, stopLossMa, adaptiveFloors, rule1);
  if (stopHit) return stopHit;
  if (checkRsi(exitRsi, rule1.exitRsi)) {
    return { exit: true, reason: 'rsi' };
  }
  return { exit: false };
}

function shouldRule1ImmediateEntry(rule1) {
  return !!(rule1?.immediateEntry);
}

function getRule1EntryDiscount(rule1) {
  const v = rule1?.entryDiscount ?? 0.001;
  return Math.min(0.1, Math.max(0.0001, v));
}

function buildRule1MaSnapshot(cMap, rule1) {
  const fakeConfig = {
    maFilters: rule1.maFilters,
    extension: rule1.extension,
    stopLoss: rule1.stopLoss,
    entryMa: { enabled: false },
  };
  const snap = buildMaSnapshot(cMap, fakeConfig);
  if (stopLossAdaptiveActive(rule1)) {
    const sl = rule1.stopLoss;
    const period = sl.adaptivePeriod ?? 50;
    const interval = sl.adaptiveInterval ?? '1h';
    const key = maKey(period, interval);
    if (!snap[key]) {
      const candles = cMap[interval];
      if (candles?.length) {
        snap[key] = { ma: lastMa(candles, period), candles, period, interval };
      }
    }
  }
  return snap;
}

/** Dips dos filtros de entrada (não usados no stop) */
function computeRule1EntryAdaptiveDips(cMap, rule1) {
  return computeAdaptiveDips(cMap, { maFilters: rule1.maFilters, adaptiveOpts: rule1.adaptiveOpts });
}

module.exports = {
  rule1Active,
  getRule1RequiredSpecs,
  evaluateRule1Entry,
  evaluateRule1Exit,
  shouldRule1ImmediateEntry,
  getRule1EntryDiscount,
  buildRule1MaSnapshot,
  computeRule1EntryAdaptiveDips,
  computeRule1StopAdaptiveDip,
  getRule1AdaptiveStopFloors,
};
