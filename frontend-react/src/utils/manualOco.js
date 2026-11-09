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
