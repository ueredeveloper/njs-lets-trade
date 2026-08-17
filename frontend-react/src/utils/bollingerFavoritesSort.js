import { PHASE_SORT_ORDER } from './vwapFavoritesSort';

export const BB_FAV_SORT_OPTIONS = [
  { id: 'phase',      labelKey: 'bbfav.sort.phase',      shortKey: 'bbfav.sort.short.phase' },
  { id: 'width_far',  labelKey: 'bbfav.sort.width_far',  shortKey: 'bbfav.sort.short.width_far' },
  { id: 'width_near', labelKey: 'bbfav.sort.width_near', shortKey: 'bbfav.sort.short.width_near' },
  { id: 'near_lower', labelKey: 'bbfav.sort.near_lower', shortKey: 'bbfav.sort.short.near_lower' },
  { id: 'near_upper', labelKey: 'bbfav.sort.near_upper', shortKey: 'bbfav.sort.short.near_upper' },
];

const STORAGE_KEY = 'lets_trade_bb_fav_sort';

/** Persiste entre sessões/reaberturas, igual VWAP/MA-Cross/Trade — no mobile a tela de
 *  favoritos fecha ao selecionar uma moeda, e reabrir não deve resetar a ordenação escolhida. */
export function loadBbFavSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && BB_FAV_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch {}
  return 'phase';
}

export function saveBbFavSort(sortBy) {
  try { localStorage.setItem(STORAGE_KEY, sortBy); } catch {}
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
  saveBbFavSort(next.id);
  return next.id;
}

function numOrInfinity(v) {
  return v != null && Number.isFinite(v) ? v : Infinity;
}

function numOrNegInfinity(v) {
  return v != null && Number.isFinite(v) ? v : -Infinity;
}

/**
 * Compara dois favoritos Bollinger Bands: por fase do bot (padrão — comprado primeiro), pela
 * largura média das bandas (upper-lower como % da média) em % — mesma métrica `avgWidthPct`
 * usada no filtro de indicadores "largura da banda" (ver fetchBollingerBandWidthFilter no
 * backend) —, ou pela proximidade do preço em relação à banda inferior/superior (`percentB`:
 * posição do close dentro da banda, 0% = na inferior, 100% = na superior — mesmo cálculo do
 * filtro "posição na banda"). `sortBy`: 'phase' | 'width_far' | 'width_near' | 'near_lower' |
 * 'near_upper'.
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

  if (sortBy === 'near_lower' || sortBy === 'near_upper') {
    const rawA = widthMeta[symA]?.percentB;
    const rawB = widthMeta[symB]?.percentB;
    // near_lower: percentB baixo (perto de 0) primeiro. near_upper: percentB alto (perto de 100) primeiro.
    const pa = sortBy === 'near_lower' ? numOrInfinity(rawA) : numOrNegInfinity(rawA);
    const pb = sortBy === 'near_lower' ? numOrInfinity(rawB) : numOrNegInfinity(rawB);
    if (pa !== pb) return sortBy === 'near_lower' ? pa - pb : pb - pa;
    return symA.localeCompare(symB);
  }

  // phase (default)
  const pa = PHASE_SORT_ORDER[phaseBySymbol.get(symA) ?? 'WATCHING'] ?? 2;
  const pb = PHASE_SORT_ORDER[phaseBySymbol.get(symB) ?? 'WATCHING'] ?? 2;
  if (pa !== pb) return pa - pb;
  return symA.localeCompare(symB);
}
