'use strict';

/**
 * Rótulos de saída — regra (1/2), tipo (RSI / stop MA fixa / stop adaptativo) e MA envolvida.
 */

function ruleLabel(ruleId) {
  if (ruleId === 'rule2') return 'Regra 2';
  if (ruleId === 'rule1') return 'Regra 1';
  return 'Regra';
}

function ruleShort(ruleId) {
  if (ruleId === 'rule2') return 'R2';
  if (ruleId === 'rule1') return 'R1';
  return 'R?';
}

function maLabel(period, interval) {
  if (period == null && !interval) return 'MA';
  return `MA${period ?? '?'} ${interval ?? '?'}`;
}

function inferRuleId(entryKind, explicitRuleId) {
  if (explicitRuleId) return explicitRuleId;
  if (entryKind === 'ma' || entryKind === 'rule2') return 'rule2';
  if (entryKind === 'rsi' || entryKind === 'rule1') return 'rule1';
  return null;
}

/**
 * @param {{ ruleId?: string, entryKind?: string, exitEval: object, ruleConfig?: object }} ctx
 */
function buildExitReasonDetail({ ruleId, entryKind, exitEval, ruleConfig }) {
  const rid = inferRuleId(entryKind, ruleId);
  const cfg = ruleConfig ?? {};
  const er = cfg.exitRsi ?? {};
  const sl = cfg.stopLoss ?? {};
  const em = cfg.entryMa ?? {};

  const base = {
    ruleId: rid,
    rule: ruleLabel(rid),
    ruleShort: ruleShort(rid),
    reason: exitEval?.reason ?? null,
  };

  if (!exitEval?.reason) {
    return { ...base, label: '—', short: '—' };
  }

  if (exitEval.reason === 'rsi') {
    const iv = er.interval ?? '?';
    const thr = er.value ?? '?';
    return {
      ...base,
      kind: 'rsi',
      interval: iv,
      threshold: thr,
      label: `[${ruleLabel(rid)}] RSI ${iv} > ${thr}`,
      short: `${ruleShort(rid)} · RSI>${thr} (${iv})`,
    };
  }

  if (exitEval.reason === 'stop_loss_ma') {
    const period = exitEval.period ?? sl.period ?? 50;
    const interval = exitEval.interval ?? sl.interval ?? '?';
    return {
      ...base,
      kind: 'stop_fixed',
      period,
      interval,
      ma: maLabel(period, interval),
      label: `[${ruleLabel(rid)}] Stop ${maLabel(period, interval)} (fixa)`,
      short: `${ruleShort(rid)} · stop ${maLabel(period, interval)} fixa`,
    };
  }

  if (exitEval.reason === 'stop_loss_adaptive') {
    const period = exitEval.period
      ?? sl.adaptivePeriod
      ?? em.period
      ?? 50;
    const interval = exitEval.interval
      ?? sl.adaptiveInterval
      ?? em.interval
      ?? '?';
    const dip = exitEval.dipPct != null
      ? ` −${Number(exitEval.dipPct).toFixed(1)}%`
      : '';
    return {
      ...base,
      kind: 'stop_adaptive',
      period,
      interval,
      dipPct: exitEval.dipPct,
      ma: maLabel(period, interval),
      label: `[${ruleLabel(rid)}] Stop ${maLabel(period, interval)} (adapt.${dip})`,
      short: `${ruleShort(rid)} · stop ${maLabel(period, interval)} adapt.`,
    };
  }

  return {
    ...base,
    label: `[${ruleLabel(rid)}] ${exitEval.reason}`,
    short: `${ruleShort(rid)} · ${exitEval.reason}`,
  };
}

/** Grava em exit_reason (JSON compacto) + label legível */
function packExitReasonForDb(detail) {
  if (!detail) return null;
  return JSON.stringify({
    v: 1,
    label: detail.label,
    short: detail.short,
    ruleId: detail.ruleId,
    kind: detail.kind ?? detail.reason,
    period: detail.period,
    interval: detail.interval,
    dipPct: detail.dipPct,
    threshold: detail.threshold,
    reason: detail.reason,
  });
}

function unpackExitReasonFromDb(stored) {
  if (!stored) return null;
  if (typeof stored === 'object') return stored;
  try {
    const p = JSON.parse(stored);
    if (p?.v === 1) return p;
  } catch { /* legado */ }
  return legacyExitReasonLabel(stored);
}

function legacyExitReasonLabel(code) {
  const map = {
    rsi: 'RSI de saída',
    stop_loss_ma: 'Stop MA (fixa)',
    stop_loss_adaptive: 'Stop MA (adaptativo)',
    STOP_LOSS_MA: 'Stop MA (fixa)',
    STOP_LOSS_ADAPTIVE: 'Stop MA (adaptativo)',
    SOLD_RSI: 'RSI de saída',
  };
  return {
    label: map[code] ?? code,
    short: map[code] ?? code,
    reason: code,
    legacy: true,
  };
}

function displayExitReason(storedOrDetail) {
  if (!storedOrDetail) return '—';
  if (typeof storedOrDetail === 'string') {
    const u = unpackExitReasonFromDb(storedOrDetail);
    return u?.label ?? u?.short ?? storedOrDetail;
  }
  return storedOrDetail.label ?? storedOrDetail.short ?? '—';
}

module.exports = {
  ruleLabel,
  ruleShort,
  maLabel,
  inferRuleId,
  buildExitReasonDetail,
  packExitReasonForDb,
  unpackExitReasonFromDb,
  displayExitReason,
  legacyExitReasonLabel,
};
