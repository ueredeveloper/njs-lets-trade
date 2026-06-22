'use strict';

/**
 * Processa um tick para uma regra (rule1 ou rule2) com estado independente.
 */

const { checkRsi, checkMinVolume, isStopLossExit } = require('./strategyEngine');
const {
  evaluateRule1Entry, evaluateRule1Exit,
  shouldRule1ImmediateEntry, getRule1EntryDiscount,
} = require('./rule1Engine');
const {
  evaluateRule2Entry, evaluateRule2Exit,
  getRule2EntryDiscount,
} = require('./rule2Engine');
const { canAttemptEntry } = require('./rulesState');

function getRuleConfig(config, ruleId) {
  return ruleId === 'rule2' ? config.rule2 : config.rule1;
}

function getEntryDiscount(ruleId, ruleConfig) {
  return ruleId === 'rule2'
    ? getRule2EntryDiscount(ruleConfig)
    : getRule1EntryDiscount(ruleConfig);
}

function shouldImmediate(ruleId, ruleConfig) {
  return ruleId === 'rule2' ? false : shouldRule1ImmediateEntry(ruleConfig);
}

function evaluateEntry(ruleId, ctx) {
  const { ruleConfig, entryRsi, close, low, prevClose, entryTimeMs, maSnap, adaptiveDips, cMap, maCtx } = ctx;
  if (ruleId === 'rule2') {
    return evaluateRule2Entry({
      close: maCtx?.close ?? close,
      low: maCtx?.low ?? low,
      prevClose: maCtx?.prevClose ?? prevClose,
      entryTimeMs, rule2: ruleConfig, maSnap,
    });
  }
  return evaluateRule1Entry({
    entryRsi, close, low, prevClose, entryTimeMs,
    rule1: ruleConfig, maSnap, adaptiveDips, cMap,
  });
}

function evaluateExit(ruleId, ctx) {
  const { ruleConfig, close, exitRsi, maSnap, adaptiveDips, rule2AdaptiveDip } = ctx;
  if (ruleId === 'rule2') {
    return evaluateRule2Exit({ close, exitRsi, maSnap, adaptiveDip: rule2AdaptiveDip, rule2: ruleConfig });
  }
  return evaluateRule1Exit({ close, exitRsi, rule1: ruleConfig, maSnap, stopDipPct: ctx.rule1StopDip });
}

function getExitRsiConfig(ruleId, config) {
  const rc = getRuleConfig(config, ruleId);
  return rc?.exitRsi ?? config.exitRsi;
}

/**
 * Avança o estado de uma regra. Retorna { ruleState, events[] }.
 */
function advanceRuleStateFull(ctx) {
  const {
    ruleId, ruleState, rulesState, ruleConfig, config,
    entryRsi, exitRsi, close, nowMs,
    entryCheck, volAllowed, maSnap, adaptiveDips, rule2AdaptiveDip, rule1StopDip,
  } = ctx;
  const events = [];
  let rs = { ...ruleState };
  const discount = getEntryDiscount(ruleId, ruleConfig);
  const exec = ruleConfig;

  if (rs.phase === 'WATCHING') {
    if (!canAttemptEntry(ruleId, rulesState)) return { ruleState: rs, events };
    if (!entryCheck?.allowed) {
      if (entryCheck?.reason && entryCheck.reason !== 'NO_ENTRY_SIGNAL' && entryCheck.reason !== 'RULE_OFF') {
        events.push({ type: 'blocked', ruleId, reason: entryCheck.reason });
      }
      return { ruleState: rs, events };
    }
    if (!volAllowed) {
      events.push({ type: 'blocked', ruleId, reason: 'VOLUME_LOW' });
      return { ruleState: rs, events };
    }
    if (shouldImmediate(ruleId, ruleConfig)) {
      events.push({ type: 'buy', ruleId, price: close, entryRsi, immediate: true });
      rs = {
        ...rs, phase: 'BOUGHT', buy_price: close, buy_time: new Date(nowMs).toISOString(),
        rsi_entry: entryRsi, trigger_price: null, limit_price: null, pending_since: null,
      };
    } else {
      const limitPrice = parseFloat((close * (1 - discount)).toFixed(8));
      events.push({ type: 'pending', ruleId, triggerPrice: close, limitPrice, entryRsi, discount });
      rs = {
        ...rs, phase: 'PENDING',
        trigger_price: close, limit_price: limitPrice,
        pending_since: new Date(nowMs).toISOString(),
        trigger_rsi: entryRsi,
      };
    }
    return { ruleState: rs, events };
  }

  if (rs.phase === 'PENDING') {
    const triggerPrice = parseFloat(rs.trigger_price);
    const limitPrice   = parseFloat(rs.limit_price);
    const pendingMs    = nowMs - new Date(rs.pending_since).getTime();
    const cancelLine   = triggerPrice * (1 + (exec.pendingCancelPct ?? 0.002));
    const exitCfg      = getExitRsiConfig(ruleId, config);
    const exitRsiHit   = exec.pendingCancelOnExitRsi !== false && checkRsi(exitRsi, exitCfg);

    if (close > cancelLine || pendingMs > (exec.pendingTimeoutMs ?? 30 * 60_000) || exitRsiHit) {
      const reason = exitRsiHit ? 'CANCELLED_EXIT_RSI'
        : close > cancelLine ? 'CANCELLED_RECOVERY' : 'CANCELLED_TIMEOUT';
      events.push({ type: 'cancel', ruleId, reason });
      return {
        ruleState: {
          ...rs, phase: 'WATCHING',
          trigger_price: null, limit_price: null, pending_since: null, trigger_rsi: null,
        },
        events,
      };
    }
    if (close <= limitPrice) {
      if (!volAllowed) {
        events.push({ type: 'blocked', ruleId, reason: 'VOLUME_LOW' });
        return { ruleState: rs, events };
      }
      events.push({ type: 'buy', ruleId, price: close, entryRsi, immediate: false });
      return {
        ruleState: {
          ...rs, phase: 'BOUGHT', buy_price: close, buy_time: new Date(nowMs).toISOString(),
          rsi_entry: entryRsi,
          trigger_price: null, limit_price: null, pending_since: null,
        },
        events,
      };
    }
    return { ruleState: rs, events };
  }

  if (rs.phase === 'BOUGHT') {
    const exitEval = evaluateExit(ruleId, {
      ruleConfig, close, exitRsi, maSnap, adaptiveDips, rule2AdaptiveDip, rule1StopDip,
    });
    if (exitEval.exit) {
      events.push({
        type: 'sell', ruleId, price: close, exitRsi,
        exitReason: exitEval.reason, stopLoss: isStopLossExit(exitEval.reason),
        exitEval,
      });
      return {
        ruleState: {
          ...rs, phase: 'WATCHING',
          buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
        },
        events,
      };
    }
  }

  return { ruleState: rs, events };
}

module.exports = {
  getRuleConfig,
  getEntryDiscount,
  shouldImmediate,
  evaluateEntry,
  evaluateExit,
  getExitRsiConfig,
  advanceRuleState: advanceRuleStateFull,
  checkMinVolume,
};
