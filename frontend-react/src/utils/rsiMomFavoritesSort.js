/** Ordenação do favorito "RSI" (RSI Momentum): por fase do bot ou pela proximidade do SINAL —
 *  RSI(14) atual no intervalo de cada bot e quantos pontos faltam pro limiar (ver
 *  backend/services/fetchRsiMomentumSignalProximity.js). */
export const RSI_MOM_FAV_SORT_OPTIONS = [
  { id: 'phase', labelKey: 'rsimomfav.sort.phase', shortKey: 'rsimomfav.sort.short.phase' },
  { id: 'signal', labelKey: 'rsimomfav.sort.signal', shortKey: 'rsimomfav.sort.short.signal' },
];

const STORAGE_KEY = 'lets_trade_rsi_mom_fav_sort';

export function loadRsiMomFavSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && RSI_MOM_FAV_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch { /* localStorage indisponível — usa o padrão */ }
  return 'phase';
}

export function getRsiMomFavSortOption(sortBy) {
  return RSI_MOM_FAV_SORT_OPTIONS.find(o => o.id === sortBy) ?? RSI_MOM_FAV_SORT_OPTIONS[0];
}

/** direction: -1 = anterior, +1 = próximo */
export function cycleRsiMomFavSort(current, direction = 1) {
  const idx = RSI_MOM_FAV_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = RSI_MOM_FAV_SORT_OPTIONS.length;
  const next = RSI_MOM_FAV_SORT_OPTIONS[(i + direction + n * 10) % n];
  try { localStorage.setItem(STORAGE_KEY, next.id); } catch { /* sem persistência */ }
  return next.id;
}

/** Chave de ordenação "Sinal": quem cruzaria agora (falta ≤ 0) primeiro, depois quem tem menos
 *  pontos de RSI faltando pro limiar; RSI fechado já acima do limiar, em trade ou sem dado vão pro fim. */
export function signalProximityRank(p) {
  if (!p) return [3, 0];
  if (p.status === 'below' && p.gap != null) return [0, p.gap];
  if (p.status === 'above') return [1, -(p.rsi ?? 0)];
  if (p.status === 'bought') return [2, 0];
  return [3, 0];
}

export function compareSignalProximity(pa, pb) {
  const [ga, va] = signalProximityRank(pa);
  const [gb, vb] = signalProximityRank(pb);
  return ga !== gb ? ga - gb : va - vb;
}
