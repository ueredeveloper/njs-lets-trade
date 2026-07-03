/** Badge e resumo de fase do bot multitrade (rsi_multi_bot_state). */

/** Rótulos na UI — inglês alinhado ao Supabase (phase). */
export const PHASE_LABELS = {
  WATCHING: 'WATCHING',
  BOUGHT:   'BOUGHT',
  PENDING:  'PENDING',
};

/** Explicação em português (tooltip). */
export const PHASE_HINT_PT = {
  WATCHING: 'aguardando — sem posição, bot monitora entrada',
  BOUGHT:   'comprado — bot gerencia a saída',
  PENDING:  'pendente — ordem limit aguardando preço (AMAP)',
};

export function multitradePhaseBadge(phase) {
  switch (phase) {
    case 'BOUGHT':
      return { text: PHASE_LABELS.BOUGHT, short: 'BOUGHT', color: '#22c55e', hint: PHASE_HINT_PT.BOUGHT };
    case 'PENDING':
      return { text: PHASE_LABELS.PENDING, short: 'PENDING', color: '#f59e0b', hint: PHASE_HINT_PT.PENDING };
    default:
      return { text: PHASE_LABELS.WATCHING, short: 'WATCHING', color: '#94a3b8', hint: PHASE_HINT_PT.WATCHING };
  }
}

/** Fase dominante entre estratégias ativas do símbolo. */
export function symbolPhaseSummary(entries) {
  const active = (entries ?? []).filter(e => e.enabled !== false);
  if (active.some(e => e.phase === 'BOUGHT')) return 'BOUGHT';
  if (active.some(e => e.phase === 'PENDING')) return 'PENDING';
  return 'WATCHING';
}

export function fmtBuyTimeShort(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
