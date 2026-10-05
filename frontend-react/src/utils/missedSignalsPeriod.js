/** Períodos do favorito SSE (Sinais sem entrada do RSI Momentum) — ver MissedSignalsPeriodSelect.jsx. */

const BRT_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const STORAGE_KEY = 'lt.missedSignalsPeriod';

export const MISSED_PERIOD_OPTIONS = [
  { id: 'today',     short: 'Hoje',   label: 'Hoje (BRT)' },
  { id: 'yesterday', short: 'Ontem',  label: 'Ontem (BRT)' },
  { id: '3d',        short: '3 dias', label: 'Últimos 3 dias' },
  { id: '7d',        short: 'Semana', label: 'Últimos 7 dias' },
  { id: '30d',       short: 'Mês',    label: 'Últimos 30 dias' },
];

export function loadMissedPeriod() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (MISSED_PERIOD_OPTIONS.some(o => o.id === v)) return v;
  } catch { /* storage bloqueado — usa o padrão */ }
  return '7d';
}

export function saveMissedPeriod(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage bloqueado — só não persiste */ }
}

/** Meia-noite BRT de hoje, como instante UTC (ms). */
function startOfTodayBrtMs(now = Date.now()) {
  const brt = new Date(now - BRT_OFFSET_MS);
  return Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + BRT_OFFSET_MS;
}

/** [fromMs, toMs) do período escolhido. */
export function missedPeriodRange(id, now = Date.now()) {
  const today = startOfTodayBrtMs(now);
  switch (id) {
    case 'today':     return [today, Infinity];
    case 'yesterday': return [today - DAY_MS, today];
    case '3d':        return [now - 3 * DAY_MS, Infinity];
    case '30d':       return [now - 30 * DAY_MS, Infinity];
    case '7d':
    default:          return [now - 7 * DAY_MS, Infinity];
  }
}
