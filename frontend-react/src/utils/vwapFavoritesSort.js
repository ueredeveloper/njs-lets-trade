/** Ordem de fase: BOUGHT (comprado) primeiro, PENDING (pendente), WATCHING (aguardando) por último. */
export const PHASE_SORT_ORDER = { BOUGHT: 0, PENDING: 1, WATCHING: 2 };

export const VWAP_FAV_SORT_OPTIONS = [
  { id: 'phase',      labelKey: 'vwapfav.sort.phase',      shortKey: 'vwapfav.sort.short.phase' },
  { id: 'width_far',  labelKey: 'vwapfav.sort.width_far',  shortKey: 'vwapfav.sort.short.width_far' },
  { id: 'width_near', labelKey: 'vwapfav.sort.width_near', shortKey: 'vwapfav.sort.short.width_near' },
];

const STORAGE_KEY = 'lets_trade_vwap_fav_sort';

export function loadVwapFavSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VWAP_FAV_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch {}
  return 'phase';
}

export function saveVwapFavSort(sortBy) {
  try { localStorage.setItem(STORAGE_KEY, sortBy); } catch {}
}

export function getVwapFavSortOption(sortBy) {
  return VWAP_FAV_SORT_OPTIONS.find(o => o.id === sortBy) ?? VWAP_FAV_SORT_OPTIONS[0];
}

/** direction: -1 = anterior, +1 = próximo */
export function cycleVwapFavSort(current, direction = 1) {
  const idx = VWAP_FAV_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = VWAP_FAV_SORT_OPTIONS.length;
  const next = VWAP_FAV_SORT_OPTIONS[(i + direction + n * 10) % n];
  saveVwapFavSort(next.id);
  return next.id;
}

function numOrInfinity(v) {
  return v != null && Number.isFinite(v) ? v : Infinity;
}

function numOrNegInfinity(v) {
  return v != null && Number.isFinite(v) ? v : -Infinity;
}

/**
 * Compara dois favoritos VWAP Bands: por fase do bot (padrão — comprado primeiro, é o
 * que mais importa acompanhar), ou pela largura média das bandas de VWAP (±2σ) em % —
 * mesma métrica `avgWidthPct` usada no filtro de indicadores "largura da banda" (ver
 * fetchVwapBandWidthFilter no backend). `sortBy`: 'phase' | 'width_far' | 'width_near'.
 */
export function compareVwapFavorites(a, b, sortBy, ctx = {}) {
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
