export const MACMP_SORT_OPTIONS = [
  { id: 'near',   labelKey: 'macmp.sort.near',   shortKey: 'macmp.sort.short.near' },
  { id: 'far',    labelKey: 'macmp.sort.far',    shortKey: 'macmp.sort.short.far' },
  { id: 'above',  labelKey: 'macmp.sort.above',  shortKey: 'macmp.sort.short.above' },
  { id: 'below',  labelKey: 'macmp.sort.below',  shortKey: 'macmp.sort.short.below' },
];

const STORAGE_KEY = 'lets_trade_macmp_table_sort';

export function loadMacmpTableSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && MACMP_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch {}
  return 'near';
}

export function saveMacmpTableSort(sortBy) {
  try { localStorage.setItem(STORAGE_KEY, sortBy); } catch {}
}

export function getMacmpSortOption(sortBy) {
  return MACMP_SORT_OPTIONS.find(o => o.id === sortBy) ?? MACMP_SORT_OPTIONS[0];
}

export function cycleMacmpTableSort(current, direction = 1) {
  const idx = MACMP_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = MACMP_SORT_OPTIONS.length;
  const next = MACMP_SORT_OPTIONS[(i + direction + n * 10) % n];
  saveMacmpTableSort(next.id);
  return next.id;
}

function symbolOf(item) {
  return typeof item === 'string' ? item : item.symbol;
}

function gapMeta(meta, symbol) {
  const m = meta?.[symbol];
  if (!m) return null;
  const gapPct = m.gapPct;
  if (gapPct == null || !Number.isFinite(gapPct)) return null;
  const absGapPct = m.absGapPct != null && Number.isFinite(m.absGapPct)
    ? m.absGapPct
    : Math.abs(gapPct);
  return { gapPct, absGapPct, direction: m.direction };
}

/** Filtra linhas da tabela quando modo acima/abaixo. */
export function filterMacmpTableRows(list, meta, sortBy) {
  if (!meta || sortBy === 'near' || sortBy === 'far') return list;
  return list.filter((item) => {
    const g = gapMeta(meta, symbolOf(item));
    if (!g) return false;
    if (sortBy === 'above') return g.gapPct > 0;
    if (sortBy === 'below') return g.gapPct < 0;
    return true;
  });
}

export function compareMacmpTableRows(a, b, sortBy, meta) {
  const symA = symbolOf(a);
  const symB = symbolOf(b);
  const ga = gapMeta(meta, symA);
  const gb = gapMeta(meta, symB);

  if (sortBy === 'near') {
    const absA = ga?.absGapPct ?? Infinity;
    const absB = gb?.absGapPct ?? Infinity;
    if (absA !== absB) return absA - absB;
    return symA.localeCompare(symB);
  }
  if (sortBy === 'far') {
    const absA = ga?.absGapPct ?? -Infinity;
    const absB = gb?.absGapPct ?? -Infinity;
    if (absA !== absB) return absB - absA;
    return symA.localeCompare(symB);
  }
  if (sortBy === 'above') {
    const va = ga?.gapPct ?? -Infinity;
    const vb = gb?.gapPct ?? -Infinity;
    if (va !== vb) return vb - va;
    return symA.localeCompare(symB);
  }
  if (sortBy === 'below') {
    const va = ga?.gapPct ?? Infinity;
    const vb = gb?.gapPct ?? Infinity;
    if (va !== vb) return va - vb;
    return symA.localeCompare(symB);
  }
  return symA.localeCompare(symB);
}
