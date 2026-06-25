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

function fmtDurMs(ms) {
  if (ms == null || ms < 0) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}min` : `${h}h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const x = Number(n);
  if (x < 0.01) return x.toFixed(6);
  if (x < 1) return x.toFixed(4);
  return x.toFixed(2);
}

function fmtPct(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(digits)}%`;
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
    const matched = exitEval.exitRsiCondition ?? cfg.exitRsi ?? {};
    const iv = exitEval.interval ?? matched.interval ?? er.interval ?? '?';
    const thr = exitEval.threshold ?? matched.value ?? er.value ?? '?';
    const op = matched.operator ?? er.operator ?? '>';
    return {
      ...base,
      kind: 'rsi',
      interval: iv,
      threshold: thr,
      label: `[${ruleLabel(rid)}] RSI ${iv} ${op} ${thr}`,
      short: `${ruleShort(rid)} · RSI${op}${thr} (${iv})`,
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

  if (exitEval.reason === 'stop_loss_pct_cap') {
    const maxPct = exitEval.maxLossPct ?? 5;
    return {
      ...base,
      kind: 'stop_pct_cap',
      label: `[${ruleLabel(rid)}] Stop −${maxPct}% da entrada`,
      short: `${ruleShort(rid)} · stop −${maxPct}% entrada`,
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

/**
 * Detalhe de cancelamento de ordem PENDING (timeout, recuperação, RSI saída).
 */
function buildPendingCancelDetail({
  reason,
  ruleId,
  entryKind,
  pendingSince,
  cancelTime,
  elapsedMs,
  pendingTimeoutMs,
  triggerPrice,
  limitPrice,
  cancelLine,
  closeAtCancel,
  exitRsi,
  exitRsiConfig,
  exitRsiHit,
}) {
  const rid = inferRuleId(entryKind, ruleId);
  const elapsedLbl = fmtDurMs(elapsedMs);
  const timeoutLbl = fmtDurMs(pendingTimeoutMs);
  const discountPct = triggerPrice > 0 && limitPrice != null
    ? (1 - limitPrice / triggerPrice) * 100
    : null;

  const base = {
    reason,
    ruleId: rid,
    rule: ruleLabel(rid),
    ruleShort: ruleShort(rid),
    kind: 'pending_cancel',
    pendingSince,
    cancelTime,
    elapsedMs,
    elapsedLabel: elapsedLbl,
    timeoutMs: pendingTimeoutMs,
    timeoutLabel: timeoutLbl,
    triggerPrice,
    limitPrice,
    discountPct: discountPct != null ? parseFloat(discountPct.toFixed(3)) : null,
    closeAtCancel,
  };

  if (reason === 'CANCELLED_TIMEOUT') {
    const overMs = Math.max(0, (elapsedMs ?? 0) - (pendingTimeoutMs ?? 0));
    const detail = [
      `Ordem pendente aguardando compra em $${fmtPrice(limitPrice)}`,
      discountPct != null ? `(${fmtPct(-discountPct)} do gatilho $${fmtPrice(triggerPrice)})` : null,
      `por ${elapsedLbl}.`,
      `Limite configurado: ${timeoutLbl}`,
      overMs > 60_000 ? `(excedeu em ${fmtDurMs(overMs)})` : null,
    ].filter(Boolean).join(' ');
    return {
      ...base,
      label: `Pendente cancelado — timeout (${elapsedLbl} / limite ${timeoutLbl})`,
      short: `timeout ${elapsedLbl} · limite ${timeoutLbl}`,
      detail,
    };
  }

  if (reason === 'CANCELLED_RECOVERY') {
    const recoveryPct = triggerPrice > 0 && closeAtCancel != null
      ? ((closeAtCancel / triggerPrice) - 1) * 100
      : null;
    const detail = [
      `Preço subiu para $${fmtPrice(closeAtCancel)}`,
      recoveryPct != null ? `(${fmtPct(recoveryPct)} vs gatilho $${fmtPrice(triggerPrice)})` : null,
      `após ${elapsedLbl} em pendente.`,
      cancelLine != null ? `Cancela acima de $${fmtPrice(cancelLine)} (+${fmtPct((cancelLine / triggerPrice - 1) * 100, 2)}).` : null,
    ].filter(Boolean).join(' ');
    return {
      ...base,
      cancelLine,
      recoveryPct: recoveryPct != null ? parseFloat(recoveryPct.toFixed(3)) : null,
      label: `Pendente cancelado — preço recuperou (${elapsedLbl})`,
      short: `recuperação ${recoveryPct != null ? fmtPct(recoveryPct) : ''} · ${elapsedLbl}`.trim(),
      detail,
    };
  }

  if (reason === 'CANCELLED_EXIT_RSI') {
    const er = exitRsiConfig ?? {};
    const iv = er.interval ?? '?';
    const thr = er.value ?? '?';
    const op = er.operator ?? '>';
    const detail = [
      `RSI de saída ${iv} atingiu ${exitRsi?.toFixed?.(1) ?? exitRsi ?? '—'}`,
      `(condição ${op} ${thr})`,
      `após ${elapsedLbl} em pendente`,
      `(alvo compra $${fmtPrice(limitPrice)}).`,
    ].join(' ');
    return {
      ...base,
      exitRsi,
      exitRsiInterval: iv,
      exitRsiThreshold: thr,
      label: `Pendente cancelado — RSI saída (${iv} ${exitRsi?.toFixed?.(1) ?? '—'} ${op} ${thr})`,
      short: `RSI ${iv} ${op}${thr} · ${elapsedLbl}`,
      detail,
    };
  }

  return {
    ...base,
    label: reason ?? 'Pendente cancelado',
    short: reason ?? 'cancelado',
    detail: null,
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
    stop_loss_pct_cap: 'Stop −5% entrada',
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
  fmtDurMs,
  fmtPrice,
  inferRuleId,
  buildExitReasonDetail,
  buildPendingCancelDetail,
  packExitReasonForDb,
  unpackExitReasonFromDb,
  displayExitReason,
  legacyExitReasonLabel,
};
