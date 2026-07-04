import { symbolPhaseSummary } from './multitradePhase';
import { MA_CROSS_DEFAULTS } from '../constants/maCrossConfigSchema';

/** Ordem de fase: BOUGHT primeiro, depois PENDING, WATCHING por último. */
export const PHASE_SORT_ORDER = { BOUGHT: 0, PENDING: 1, WATCHING: 2 };

export const MACROSS_SORT_OPTIONS = [
  { id: 'phase',      labelKey: 'macross.sort.phase',      shortKey: 'macross.sort.short.phase' },
  { id: 'near_up',    labelKey: 'macross.sort.near_up',    shortKey: 'macross.sort.short.near_up' },
  { id: 'near_down',  labelKey: 'macross.sort.near_down',  shortKey: 'macross.sort.short.near_down' },
  { id: 'cross_up',   labelKey: 'macross.sort.cross_up',   shortKey: 'macross.sort.short.cross_up' },
  { id: 'cross_down', labelKey: 'macross.sort.cross_down', shortKey: 'macross.sort.short.cross_down' },
  { id: 'symbol',     labelKey: 'macross.sort.symbol',     shortKey: 'macross.sort.short.symbol' },
];

const STORAGE_KEY = 'lets_trade_macross_fav_sort';

export function loadMacrossFavSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && MACROSS_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch {}
  return 'phase';
}

export function saveMacrossFavSort(sortBy) {
  try { localStorage.setItem(STORAGE_KEY, sortBy); } catch {}
}

export function getMacrossSortOption(sortBy) {
  return MACROSS_SORT_OPTIONS.find(o => o.id === sortBy) ?? MACROSS_SORT_OPTIONS[0];
}

/** direction: -1 = anterior (↑), +1 = próximo (↓) */
export function cycleMacrossFavSort(current, direction = 1) {
  const idx = MACROSS_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = MACROSS_SORT_OPTIONS.length;
  const next = MACROSS_SORT_OPTIONS[(i + direction + n * 10) % n];
  saveMacrossFavSort(next.id);
  return next.id;
}

export function isMaCrossEntry(e) {
  return e?.strategyId === 'ma-cross' || e?.kind === 'ma_cross' || e?.tradeConfig?.kind === 'ma_cross';
}

export function maCrossParamsFromEntry(entry) {
  const entryCfg = entry?.tradeConfig?.entry;
  const d = MA_CROSS_DEFAULTS.entry;
  if (entryCfg?.ma1 && entryCfg?.ma2) {
    return {
      period1: entryCfg.ma1.period ?? d.ma1.period,
      interval1: entryCfg.ma1.interval ?? d.ma1.interval,
      period2: entryCfg.ma2.period ?? d.ma2.period,
      interval2: entryCfg.ma2.interval ?? d.ma2.interval,
    };
  }
  return {
    period1: d.ma1.period,
    interval1: d.ma1.interval,
    period2: d.ma2.period,
    interval2: d.ma2.interval,
  };
}

export function buildMacrossStatusItems(symbols, entriesBySymbol) {
  return symbols.map((symbol) => {
    const entries = (entriesBySymbol.get(symbol) ?? []).filter(isMaCrossEntry);
    const params = maCrossParamsFromEntry(entries[0]);
    return { symbol, ...params };
  });
}

function numOrInfinity(v) {
  return v != null && Number.isFinite(v) ? v : Infinity;
}

function numOrNegInfinity(v) {
  return v != null && Number.isFinite(v) ? v : -Infinity;
}

/** Compara dois símbolos/linhas para ordenação da lista de favoritos MA-Cross. */
export function compareMacrossFavorites(a, b, sortBy, ctx = {}) {
  const { status = {}, entriesBySymbol = new Map() } = ctx;

  const symA = typeof a === 'string' ? a : a.symbol;
  const symB = typeof b === 'string' ? b : b.symbol;

  if (sortBy === 'symbol') return symA.localeCompare(symB);

  if (sortBy === 'phase') {
    const pa = PHASE_SORT_ORDER[symbolPhaseSummary(entriesBySymbol.get(symA) ?? [])] ?? 9;
    const pb = PHASE_SORT_ORDER[symbolPhaseSummary(entriesBySymbol.get(symB) ?? [])] ?? 9;
    if (pa !== pb) return pa - pb;
    return symA.localeCompare(symB);
  }

  const ma = status[symA];
  const mb = status[symB];

  if (sortBy === 'near_up') {
    const ga = numOrInfinity(ma?.gapUpPct);
    const gb = numOrInfinity(mb?.gapUpPct);
    if (ga !== gb) return ga - gb;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'near_down') {
    const ga = numOrInfinity(ma?.gapDownPct);
    const gb = numOrInfinity(mb?.gapDownPct);
    if (ga !== gb) return ga - gb;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'cross_up') {
    const heldA = ma?.crossUpHeld ? 0 : 1;
    const heldB = mb?.crossUpHeld ? 0 : 1;
    if (heldA !== heldB) return heldA - heldB;
    const aa = numOrInfinity(ma?.crossUpAgeMin);
    const ab = numOrInfinity(mb?.crossUpAgeMin);
    if (aa !== ab) return aa - ab;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'cross_down') {
    const heldA = ma?.crossDownHeld ? 0 : 1;
    const heldB = mb?.crossDownHeld ? 0 : 1;
    if (heldA !== heldB) return heldA - heldB;
    const aa = numOrInfinity(ma?.crossDownAgeMin);
    const ab = numOrInfinity(mb?.crossDownAgeMin);
    if (aa !== ab) return aa - ab;
    return symA.localeCompare(symB);
  }

  return symA.localeCompare(symB);
}

/** Badge compacto para gap/cruzamento na lista de favoritos. */
export function formatMacrossStatusBadge(meta, t) {
  if (!meta || meta.error) return null;

  if (meta.gapUpPct != null && meta.gapUpPct <= 3) {
    return t('table.macross_near', '↑', `${meta.gapUpPct}%`);
  }
  if (meta.gapDownPct != null && meta.gapDownPct <= 3) {
    return t('table.macross_near', '↓', `${meta.gapDownPct}%`);
  }
  if (meta.crossUpHeld && meta.crossUpAgeMin != null) {
    const age = meta.crossUpAgeMin < 1
      ? `${Math.round(meta.crossUpAgeMin * 60)}s`
      : `${meta.crossUpAgeMin}m`;
    return t('table.macross_crossed', '↑', age);
  }
  if (meta.crossDownHeld && meta.crossDownAgeMin != null) {
    const age = meta.crossDownAgeMin < 1
      ? `${Math.round(meta.crossDownAgeMin * 60)}s`
      : `${meta.crossDownAgeMin}m`;
    return t('table.macross_crossed', '↓', age);
  }
  if (meta.gapUpPct != null) {
    return t('table.macross_gap_up', meta.gapUpPct);
  }
  if (meta.gapDownPct != null) {
    return t('table.macross_gap_down', meta.gapDownPct);
  }
  return null;
}
