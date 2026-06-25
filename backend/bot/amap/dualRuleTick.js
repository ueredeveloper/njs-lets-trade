'use strict';

/**
 * Tick ao vivo — regras 1 (RSI) e 2 (MA50 1h) com estado independente.
 */

const ti = require('technicalindicators');
const { checkMinVolume, isStopLossExit } = require('./strategyEngine');
const { parseRulesState, rulesStateToRowPatch, canAttemptEntry } = require('./rulesState');
const { evaluateEntry, advanceRuleState } = require('./ruleTick');
const {
  buildRule1MaSnapshot, computeRule1EntryAdaptiveDips, computeRule1StopAdaptiveDip, rule1Active,
} = require('./rule1Engine');
const {
  buildRule2MaSnapshot, computeRule2AdaptiveDip, rule2Active,
  getRule2ExitRsiConditions,
} = require('./rule2Engine');

function buildRule2ExitRsiMap(cMap, rule2) {
  const map = {};
  for (const cond of getRule2ExitRsiConditions(rule2)) {
    const candles = cMap[cond.interval];
    map[cond.interval] = computeExitRsi(candles, cond);
  }
  return map;
}

function formatRule2ExitRsiLog(exitRsiMap, rule2) {
  const parts = getRule2ExitRsiConditions(rule2).map(c => {
    const v = exitRsiMap[c.interval];
    return `${c.interval}=${v?.toFixed(1) ?? '—'}`;
  });
  return parts.join(' ');
}

function computeExitRsi(candles, exitRsiCfg) {
  if (!candles?.length || !exitRsiCfg) return null;
  const arr = ti.RSI.calculate({ values: candles.map(c => c.close), period: exitRsiCfg.period });
  return arr.length ? arr[arr.length - 1] : null;
}

async function runDualRuleTick(deps) {
  const {
    rowId, adapter, strategy, log, prevExitRsi, session,
    fetchCandleMap, loadState, saveState,
    checkEntryVolume, processRuleEvents, fmtP,
  } = deps;

  const { config } = strategy;
  const specs = deps.getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);

  const rule1 = config.rule1;
  const rule2 = config.rule2;
  const nowMs = Date.now();

  const r1EntryIv = rule1?.entryRsi?.interval ?? '15m';
  const r1ExitIv  = rule1?.exitRsi?.interval ?? '15m';
  const r2MaIv    = rule2?.entryMa?.interval ?? '1h';

  const entryCandles = cMap[r1EntryIv] ?? cMap['15m'];
  const r1ExitCandles = cMap[r1ExitIv];
  const r2MaCandles   = cMap[r2MaIv];

  if (!entryCandles?.length) {
    log('Dados insuficientes.');
    return { entryRsi: null, exitRsi: prevExitRsi, phase: 'WATCHING' };
  }

  const close    = entryCandles[entryCandles.length - 1].close;
  const candleMs = entryCandles[entryCandles.length - 1]?.openTime ?? null;
  const entryLen = entryCandles.length;
  const rsiCtx = {
    close,
    low: entryCandles[entryLen - 1]?.low ?? close,
    prevClose: entryLen >= 2 ? entryCandles[entryLen - 2].close : null,
  };

  let entryRsi = null;
  if (rule1Active({ rule1 })) {
    const rsiCandles = cMap[r1EntryIv] ?? entryCandles;
    const arr = ti.RSI.calculate({ values: rsiCandles.map(c => c.close), period: rule1.entryRsi.period });
    entryRsi = arr.length ? arr[arr.length - 1] : null;
  }

  const exitRsi1 = computeExitRsi(r1ExitCandles, rule1?.exitRsi ?? config.exitRsi);
  const exitRsi2Map = rule2Active({ rule2 }) ? buildRule2ExitRsiMap(cMap, rule2) : {};
  const exitRsi2 = exitRsi2Map[rule2?.exitRsi?.interval] ?? Object.values(exitRsi2Map)[0] ?? null;
  const exitRsi  = exitRsi1 ?? prevExitRsi;

  const maLen = r2MaCandles?.length ?? 0;
  const maCtx = r2MaCandles ? {
    close: r2MaCandles[maLen - 1]?.close ?? close,
    low: r2MaCandles[maLen - 1]?.low ?? rsiCtx.low,
    prevClose: maLen >= 2 ? r2MaCandles[maLen - 2].close : null,
    openTime: r2MaCandles[maLen - 1]?.openTime,
  } : rsiCtx;

  const maSnap1 = buildRule1MaSnapshot(cMap, rule1);
  const maSnap2 = buildRule2MaSnapshot(cMap, rule2);
  const adaptiveDips1 = session.adaptiveDips ?? computeRule1EntryAdaptiveDips(cMap, rule1);
  const rule1StopDip = session.rule1StopDip ?? computeRule1StopAdaptiveDip(cMap, rule1);
  session.rule1StopDip = rule1StopDip;
  let rule2Dip = session.rule2Dip;
  if (rule2Active({ rule2 }) && r2MaCandles) {
    rule2Dip = computeRule2AdaptiveDip(r2MaCandles, rule2);
    session.rule2Dip = rule2Dip;
  }

  const state = await loadState(rowId);
  if (!state) {
    log('❌ Linha não encontrada.');
    return { entryRsi, exitRsi, phase: 'WATCHING' };
  }

  let rulesState = parseRulesState(state);
  const { capital } = state;

  let volAllowed = true;
  try {
    const volCheck = await checkEntryVolume(adapter, config, session);
    volAllowed = volCheck.allowed;
  } catch { /* ok */ }

  const phases = [];

  for (const ruleId of ['rule1', 'rule2']) {
    const ruleConfig = ruleId === 'rule2' ? rule2 : rule1;
    if (!ruleConfig?.enabled) continue;

    const ruleExitRsi = ruleId === 'rule2' ? exitRsi2 : exitRsi1;
    const ruleExitRsiMap = ruleId === 'rule2' ? exitRsi2Map : null;
    const maSnap = ruleId === 'rule2' ? maSnap2 : maSnap1;
    const adaptiveDips = adaptiveDips1;

    let entryCheck = { allowed: false, reason: 'NO_ENTRY_SIGNAL' };
    if (rulesState[ruleId].phase === 'WATCHING' && canAttemptEntry(ruleId, rulesState)) {
      entryCheck = evaluateEntry(ruleId, {
        ruleConfig, config, entryRsi, close, low: rsiCtx.low, prevClose: rsiCtx.prevClose,
        entryTimeMs: nowMs,
        maSnap,
        maSnapFilters: maSnap1,
        adaptiveDips,
        cMap,
        maCtx,
      });
    }

    const { ruleState, events } = advanceRuleState({
      ruleId, ruleState: rulesState[ruleId], rulesState, ruleConfig, config,
      entryRsi, exitRsi: ruleExitRsi, exitRsiMap: ruleExitRsiMap, close, nowMs,
      entryCheck, volAllowed, maSnap, adaptiveDips, rule2AdaptiveDip: rule2Dip, rule1StopDip,
    });

    rulesState[ruleId] = ruleState;
    phases.push(`${ruleId}:${ruleState.phase}`);

    if (events.length && processRuleEvents) {
      rulesState = await processRuleEvents({
        events, ruleId, rulesState, state, rowId, adapter, config, session, log, capital,
        entryRsi, exitRsi: ruleExitRsi, close, candleMs,
      });
    }
  }

  const patch = rulesStateToRowPatch(rulesState);
  try {
    await saveState(rowId, patch);
  } catch {
    await saveState(rowId, { ...patch, rules_state: undefined });
  }

  const r1Label = rule1Active({ rule1 }) && entryRsi != null ? `R1 RSI=${entryRsi.toFixed(1)}  ` : '';
  const r2Label = rule2Active({ rule2 })
    ? `R2 MA${rule2.entryMa.period}/${rule2.entryMa.interval}  ` : '';
  log(
    `${r1Label}${r2Label}` +
    `saída R1=${exitRsi1?.toFixed(1) ?? '—'} R2=${formatRule2ExitRsiLog(exitRsi2Map, rule2) || '—'}  ` +
    `$${fmtP(close)}  [${phases.join(' | ')}]`,
  );

  const primaryPhase = rulesState.rule1?.phase !== 'WATCHING'
    ? rulesState.rule1.phase
    : (rulesState.rule2?.phase !== 'WATCHING' ? rulesState.rule2.phase : 'WATCHING');

  return { entryRsi, exitRsi, phase: primaryPhase, rulesState };
}

module.exports = { runDualRuleTick, computeExitRsi };
