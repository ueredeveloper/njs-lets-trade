/** Exibe motivo de saída (JSON do bot ou código legado). */

export function fmtDurMs(ms) {
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

export function formatPendingCancel(row) {
  const cd = row.cancelDetail;
  if (!cd) return null;
  return {
    label: cd.label ?? row.outcomeLabel,
    short: cd.short ?? row.outcomeShort,
    detail: cd.detail ?? row.outcomeDetail,
    title: cd.detail ?? cd.label,
  };
}

export function formatBacktestOutcome(row) {
  const exitWhen = row.exitTimeISO ?? row.exitTime;
  const exitWhenLbl = exitWhen
    ? new Date(exitWhen).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    : null;

  if (row.exitDetail?.label) {
    return {
      label: row.exitDetail.label,
      detail: exitWhenLbl ? `Saída ${exitWhenLbl}` : null,
      title: [row.exitDetail.short ?? row.exitDetail.label, exitWhenLbl ? `Saída ${exitWhenLbl}` : null]
        .filter(Boolean).join(' · '),
    };
  }
  const pending = formatPendingCancel(row);
  if (pending) return pending;
  if (row.outcomeLabel) return { label: row.outcomeLabel, detail: row.outcomeDetail ?? null, title: row.outcomeDetail ?? row.outcomeLabel };
  return { label: row.outcome ?? '—', detail: null, title: row.outcome };
}

export function unpackExitReason(stored) {
  if (!stored) return null;
  if (typeof stored === 'object') return stored;
  try {
    const p = JSON.parse(stored);
    if (p?.v === 1) return p;
  } catch { /* legado */ }
  const legacy = {
    rsi: 'RSI de saída',
    stop_loss_ma: 'Stop MA (fixa)',
    stop_loss_adaptive: 'Stop MA (adaptativo)',
    stop_loss_pct_cap: 'Stop −5% entrada',
    STOP_LOSS_MA: 'Stop MA (fixa)',
    STOP_LOSS_ADAPTIVE: 'Stop MA (adaptativo)',
    SOLD_RSI: 'RSI de saída',
  };
  return { label: legacy[stored] ?? stored, short: legacy[stored] ?? stored, legacy: true };
}

export function displayExitReason(stored) {
  const u = unpackExitReason(stored);
  return u?.label ?? u?.short ?? stored ?? '—';
}

export function ruleBadgeStyle(ruleId) {
  if (ruleId === 'rule2') return { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', border: '#38bdf855' };
  if (ruleId === 'rule1') return { color: '#34d399', bg: 'rgba(52,211,153,0.12)', border: '#34d39955' };
  return { color: '#94a3b8', bg: 'transparent', border: '#3a3d4a' };
}
