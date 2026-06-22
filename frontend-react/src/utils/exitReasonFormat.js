/** Exibe motivo de saída (JSON do bot ou código legado). */

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
