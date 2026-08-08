import { PHASE_SORT_ORDER } from './vwapFavoritesSort';

export const BB_FAV_SORT_OPTIONS = [
  { id: 'phase',      labelKey: 'bbfav.sort.phase',      shortKey: 'bbfav.sort.short.phase' },
  { id: 'width_far',  labelKey: 'bbfav.sort.width_far',  shortKey: 'bbfav.sort.short.width_far' },
  { id: 'width_near', labelKey: 'bbfav.sort.width_near', shortKey: 'bbfav.sort.short.width_near' },
];

/** Sem persistência entre sessões (ao contrário do VWAP/MA-Cross/Trade) — cada abertura da
 *  view de favoritos BB deve sempre começar em "Fase", nunca lembrar a última escolha de
 *  largura de uma sessão anterior. */
export function loadBbFavSort() {
  return 'phase';
}

export function getBbFavSortOption(sortBy) {
  return BB_FAV_SORT_OPTIONS.find(o => o.id === sortBy) ?? BB_FAV_SORT_OPTIONS[0];
}

/** direction: -1 = anterior, +1 = próximo */
export function cycleBbFavSort(current, direction = 1) {
  const idx = BB_FAV_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = BB_FAV_SORT_OPTIONS.length;
  const next = BB_FAV_SORT_OPTIONS[(i + direction + n * 10) % n];
  return next.id;
}

function numOrInfinity(v) {
  return v != null && Number.isFinite(v) ? v : Infinity;
}

function numOrNegInfinity(v) {
  return v != null && Number.isFinite(v) ? v : -Infinity;
}

/**
 * Compara dois favoritos Bollinger Bands: por fase do bot (padrão — comprado primeiro), ou
 * pela largura média das bandas (upper-lower como % da média) em % — mesma métrica
 * `avgWidthPct` usada no filtro de indicadores "largura da banda" (ver
 * fetchBollingerBandWidthFilter no backend). `sortBy`: 'phase' | 'width_far' | 'width_near'.
 */
export function compareBollingerFavorites(a, b, sortBy, ctx = {}) {
  const { phaseBySymbol = new Map(), widthMeta = {} } = ctx;

  const symA = typeof a === 'string' ? a : a.symbol;
  const symB = typeof b === 'string' ? b : b.symbol;

  if (sortBy === 'width_far' || sortBy === 'width_near') {
    const rawA = widthMeta[symA]?.avgWidthPct;
    const rawB = widthMeta[symB]?.avgWidthPct;
    const wa = sortBy === 'width_near' ? numOrInfinity(rawA) : numOrNegInfinity(rawA);
    const wb = sortBy === 'width_near' ? numOrInfinity(rawB) : numOrNegInfinity(rawB);
    if (wa !== wb) return sortBy === 'width_near' ? wa - wb : wb - wa;
    return symA.localeCompare(symB);
  }

  // phase (default)
  const pa = PHASE_SORT_ORDER[phaseBySymbol.get(symA) ?? 'WATCHING'] ?? 2;
  const pb = PHASE_SORT_ORDER[phaseBySymbol.get(symB) ?? 'WATCHING'] ?? 2;
  if (pa !== pb) return pa - pb;
  return symA.localeCompare(symB);
}
