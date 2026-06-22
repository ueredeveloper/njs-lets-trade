'use strict';

const EMPTY_RULE = () => ({
  phase: 'WATCHING',
  trigger_price: null,
  trigger_rsi: null,
  limit_price: null,
  pending_since: null,
  buy_price: null,
  buy_qty: null,
  buy_usdt: null,
  buy_time: null,
  rsi_entry: null,
  entry_signal_id: null,
});

/** Estado vazio das duas regras */
function createEmptyRulesState() {
  return { rule1: EMPTY_RULE(), rule2: EMPTY_RULE() };
}

/** Carrega rules_state do row ou migra colunas legadas (rule1) */
function parseRulesState(row) {
  if (!row) return createEmptyRulesState();

  let raw = row.rules_state;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (raw?.rule1 || raw?.rule2) {
    return {
      rule1: { ...EMPTY_RULE(), ...raw.rule1 },
      rule2: { ...EMPTY_RULE(), ...raw.rule2 },
    };
  }

  // runtime embutido em trade_config (fallback sem coluna rules_state)
  const tc = typeof row.trade_config === 'string'
    ? JSON.parse(row.trade_config || '{}')
    : (row.trade_config ?? {});
  if (tc._rulesState?.rule1 || tc._rulesState?.rule2) {
    return {
      rule1: { ...EMPTY_RULE(), ...tc._rulesState.rule1 },
      rule2: { ...EMPTY_RULE(), ...tc._rulesState.rule2 },
    };
  }

  // legado: colunas únicas = regra 1
  return {
    rule1: {
      ...EMPTY_RULE(),
      phase: row.phase ?? 'WATCHING',
      trigger_price: row.trigger_price ?? null,
      trigger_rsi: row.trigger_rsi ?? null,
      limit_price: row.limit_price ?? null,
      pending_since: row.pending_since ?? null,
      buy_price: row.buy_price ?? null,
      buy_qty: row.buy_qty ?? null,
      buy_usdt: row.buy_usdt ?? null,
      buy_time: row.buy_time ?? null,
      rsi_entry: row.rsi_entry ?? null,
    },
    rule2: EMPTY_RULE(),
  };
}

/** Sincroniza rule1 com colunas legadas do Supabase */
function rulesStateToRowPatch(rulesState) {
  const r1 = rulesState.rule1 ?? EMPTY_RULE();
  return {
    rules_state: rulesState,
    phase: r1.phase,
    trigger_price: r1.trigger_price,
    trigger_rsi: r1.trigger_rsi,
    limit_price: r1.limit_price,
    pending_since: r1.pending_since,
    buy_price: r1.buy_price,
    buy_qty: r1.buy_qty,
    buy_usdt: r1.buy_usdt,
    buy_time: r1.buy_time,
    rsi_entry: r1.rsi_entry,
  };
}

/** Pode tentar nova entrada nesta regra? */
function canAttemptEntry(ruleId, rulesState) {
  const rs = rulesState?.[ruleId];
  if (!rs) return true;
  return rs.phase === 'WATCHING';
}

/** Regra 1 aberta bloqueia nova entrada na regra 1; regra 2 é independente */
function isRuleActive(ruleId, rulesState) {
  const rs = rulesState?.[ruleId];
  return rs?.phase === 'PENDING' || rs?.phase === 'BOUGHT';
}

function anyRulePendingOrBought(rulesState) {
  return isRuleActive('rule1', rulesState) || isRuleActive('rule2', rulesState);
}

module.exports = {
  EMPTY_RULE,
  createEmptyRulesState,
  parseRulesState,
  rulesStateToRowPatch,
  canAttemptEntry,
  isRuleActive,
  anyRulePendingOrBought,
};
