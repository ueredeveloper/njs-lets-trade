/** Teto da calibragem % abaixo da MA (modo acima) — espelha backend/maFilter.js */
export const MA_TOLERANCE_MAX_PCT = 4;

export function clampMaTolerancePct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MA_TOLERANCE_MAX_PCT, parseFloat(n.toFixed(1))));
}
