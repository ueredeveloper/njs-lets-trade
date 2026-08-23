/** Badge e resumo de fase do bot multitrade (rsi_multi_bot_state). */

/** Rótulos na UI — traduzidos (o valor salvo no Supabase continua em inglês: phase). */
export const PHASE_LABELS = {
  pt: { WATCHING: 'AGUARDANDO', BOUGHT: 'COMPRADO', PENDING: 'PENDENTE', FAILED: 'FALHA' },
  en: { WATCHING: 'WATCHING', BOUGHT: 'BOUGHT', PENDING: 'PENDING', FAILED: 'FAILED' },
};

/** Explicação em português (tooltip). */
export const PHASE_HINT_PT = {
  WATCHING: 'aguardando — sem posição, bot monitora entrada',
  BOUGHT:   'comprado — bot gerencia a saída',
  PENDING:  'pendente — ordem limit aguardando preço (AMAP) ou ordem limite de pullback (RSI Momentum)',
  FAILED:   'falha — a corretora rejeitou a ordem (ex.: saldo insuficiente); o bot não tenta de novo sozinho',
};

export function multitradePhaseBadge(phase, lang = 'pt') {
  const labels = PHASE_LABELS[lang] ?? PHASE_LABELS.pt;
  switch (phase) {
    case 'BOUGHT':
      return { text: labels.BOUGHT, short: 'BOUGHT', color: '#22c55e', hint: PHASE_HINT_PT.BOUGHT };
    case 'PENDING':
      return { text: labels.PENDING, short: 'PENDING', color: '#f59e0b', hint: PHASE_HINT_PT.PENDING };
    case 'FAILED':
      return { text: labels.FAILED, short: 'FAILED', color: '#ef4444', hint: PHASE_HINT_PT.FAILED };
    default:
      return { text: labels.WATCHING, short: 'WATCHING', color: '#94a3b8', hint: PHASE_HINT_PT.WATCHING };
  }
}

/** Fase dominante entre estratégias ativas do símbolo. */
export function symbolPhaseSummary(entries) {
  const active = (entries ?? []).filter(e => e.enabled !== false);
  if (active.some(e => e.phase === 'BOUGHT')) return 'BOUGHT';
  if (active.some(e => e.phase === 'PENDING')) return 'PENDING';
  if (active.some(e => e.phase === 'FAILED')) return 'FAILED';
  return 'WATCHING';
}

export function fmtBuyTimeShort(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
