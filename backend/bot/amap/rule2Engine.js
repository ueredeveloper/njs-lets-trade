'use strict';

/**
 * Regra 2 — Entrada MA50 1h (toque/cruzamento) sem filtros compartilhados da regra 1.
 * Saída: RSI 1h > 70 + stop adaptativo na própria MA de entrada (dip histórico).
 */

const { analyzeAdaptiveDip, lastMa } = require('./adaptiveMaDip');
const { checkRsi, checkMaEntryTrigger, maKey } = require('./strategyEngine');

function rule2Active(config) {
  return config?.rule2?.enabled === true;
}

function getRule2RequiredSpecs(rule2) {
  if (!rule2?.enabled) return [];
  const em = rule2.entryMa;
  const specs = new Map();
  const add = (interval, limit) => {
    specs.set(interval, Math.max(specs.get(interval) ?? 0, limit));
  };
  add(em.interval, em.period + 80);
  add(rule2.exitRsi.interval, rule2.exitRsi.period + 50);
  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

function computeRule2AdaptiveDip(candles, rule2) {
  const em = rule2.entryMa;
  const opts = rule2.adaptiveOpts ?? {};
  if (em.fixedDipPct != null && em.fixedDipPct !== '') {
    return Number(em.fixedDipPct);
  }
  return analyzeAdaptiveDip(candles, em.period, opts).dipPct;
}

function getRule2StopFloor(maSnap, adaptiveDip, rule2) {
  const em = rule2.entryMa;
  const key = maKey(em.period, em.interval);
  const md = maSnap[key];
  if (!md?.ma) return null;
  const dipPct = adaptiveDip ?? rule2.adaptiveOpts?.defaultPct ?? 3;
  return {
    floor: md.ma * (1 - dipPct / 100),
    dipPct,
    ma: md.ma,
    period: em.period,
    interval: em.interval,
    key,
  };
}

function evaluateRule2Entry({ close, low, prevClose, entryTimeMs, rule2, maSnap }) {
  if (!rule2Active({ rule2 })) {
    return { allowed: false, reason: 'RULE_OFF', entryKind: 'rule2' };
  }

  const fakeConfig = { entryMa: { ...rule2.entryMa, enabled: true } };
  const mt = checkMaEntryTrigger({ close, low, prevClose, maSnap, config: fakeConfig });
  if (!mt.triggered) {
    return { allowed: false, reason: 'NO_ENTRY_SIGNAL', entryKind: 'rule2', maTrigger: mt };
  }

  return { allowed: true, reason: null, entryKind: 'rule2', maTrigger: mt };
}

function evaluateRule2Exit({ close, exitRsi, maSnap, adaptiveDip, rule2 }) {
  if (rule2.stopLoss?.adaptiveEnabled !== false) {
    const floor = getRule2StopFloor(maSnap, adaptiveDip, rule2);
    if (floor && close < floor.floor) {
      return {
        exit: true,
        reason: 'stop_loss_adaptive',
        stopLossLevel: floor.floor,
        dipPct: floor.dipPct,
        adaptiveKey: floor.key,
        adaptiveMa: floor.ma,
        period: floor.period,
        interval: floor.interval,
      };
    }
  }

  if (checkRsi(exitRsi, rule2.exitRsi)) {
    return { exit: true, reason: 'rsi' };
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
  getRule2RequiredSpecs,
  computeRule2AdaptiveDip,
  getRule2StopFloor,
  evaluateRule2Entry,
  evaluateRule2Exit,
  shouldRule2ImmediateEntry,
  getRule2EntryDiscount,
  buildRule2MaSnapshot,
};
