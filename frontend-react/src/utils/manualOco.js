// OCO manual do gráfico (tabela manual_oco_orders — ver backend/bot/manual-oco/manualOcoWatcher.js).

/** Ainda na compra (OCO só prevista). */
export const MANUAL_OCO_PENDING = new Set(['NEW', 'OPEN', 'CANCEL_REQUESTED']);
/** Comprou — posição aberta (com ou sem OCO). */
export const MANUAL_OCO_MOUNTED = new Set(['FILLED', 'BRACKETED', 'SELLING', 'OCO_FAILED']);

/** Distância mínima do stop (espelho: backend/bot/shared/manualOcoStop.js). */
export const MANUAL_OCO_MIN_STOP_PCT = 10;

/** Stop nunca a menos de MANUAL_OCO_MIN_STOP_PCT% abaixo da entrada. */
export function withMinStop(stop, entry) {
  return Math.min(stop, entry * (1 - MANUAL_OCO_MIN_STOP_PCT / 100));
}

/** Ordem filha do martingale (2ª compra — ver manualOcoWatcher.js#processOnDrop). */
export const MANUAL_OCO_MARTINGALE_SOURCE = 'bullish_breakout_martingale';
export function isMartingaleChild(o) {
  return o?.close_condition?.source === MANUAL_OCO_MARTINGALE_SOURCE;
}

/** Alvo ORIGINAL da 1ª compra depois que a regra de queda moveu o alvo pra entrada — o gráfico
 *  mantém a OCO completa (verde até ele) enquanto a OCO não executou. dropState.origTarget é
 *  gravado pelo watcher; ordens de antes disso: entrada × (1 + exit.targetPct%). null = não moveu. */
export function manualOcoOrigTarget(o) {
  const cc = o?.close_condition ?? {};
  if (!['moved', 'buying', 'done'].includes(cc.dropState?.stage)) return null;
  const orig = Number(cc.dropState.origTarget);
  if (orig > 0) return orig;
  const entry = Number(o.fill?.avgPrice ?? o.entry_price);
  const pct = Number(cc.exit?.targetPct);
  return entry > 0 && pct > 0 ? entry * (1 + pct / 100) : null;
}

export function isManualOcoActive(o) {
  return MANUAL_OCO_PENDING.has(o.status) || MANUAL_OCO_MOUNTED.has(o.status);
}

/** Níveis que valem pra desenhar/agir: preços EFETIVOS (fill / ajuste da corretora) quando houver,
 *  senão os pedidos. `sinceMs` = onde o retângulo começa (compra, ou criação da ordem). */
export function manualOcoLevels(o) {
  const mounted = !MANUAL_OCO_PENDING.has(o.status);
  return {
    mounted,
    entry: Number(mounted ? (o.fill?.avgPrice ?? o.entry_price) : (o.buy_handle?.price ?? o.entry_price)),
    target: Number(o.bracket?.targetPrice ?? o.target_price),
    stop: Number(o.bracket?.stopPrice ?? o.stop_price),
    noOco: o.status === 'OCO_FAILED',
    sinceMs: Date.parse(mounted ? (o.fill?.at ?? o.created_at) : o.created_at),
  };
}
