/** Filtro/visão da lista de favoritos Ativos (AT): saldo agregado x compras individuais. */
export const ACTIVE_SORT_OPTIONS = [
  { id: 'holdings', labelKey: 'activefav.sort.holdings', shortKey: 'activefav.sort.short.holdings' },
  { id: 'buy_lots', labelKey: 'activefav.sort.buy_lots', shortKey: 'activefav.sort.short.buy_lots' },
];

const STORAGE_KEY = 'lets_trade_active_fav_sort';

export function loadActiveFavSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && ACTIVE_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch {}
  return 'holdings';
}

export function saveActiveFavSort(sortBy) {
  try { localStorage.setItem(STORAGE_KEY, sortBy); } catch {}
}

export function getActiveSortOption(sortBy) {
  return ACTIVE_SORT_OPTIONS.find(o => o.id === sortBy) ?? ACTIVE_SORT_OPTIONS[0];
}

/** direction: -1 = anterior, +1 = próximo */
export function cycleActiveFavSort(current, direction = 1) {
  const idx = ACTIVE_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = ACTIVE_SORT_OPTIONS.length;
  const next = ACTIVE_SORT_OPTIONS[(i + direction + n * 10) % n];
  saveActiveFavSort(next.id);
  return next.id;
}

/**
 * Compras individuais (AT): expande cada holding em uma linha por lote de compra ainda
 * não vendido (FIFO — vem de openLots em /services/trade-favorites). Holdings sem dados
 * de trade conhecidos (fora da janela buscada nas exchanges) mantêm uma linha agregada.
 */
export function expandActiveBuyLots(items, status) {
  const rows = [];
  for (const item of items) {
    const sym = typeof item === 'string' ? item : item.symbol;
    const base = typeof item === 'string' ? { symbol: item } : item;
    const lots = status[sym]?.openLots ?? [];
    if (!lots.length) {
      rows.push({ ...base, symbol: sym, __rowKey: sym });
      continue;
    }
    lots.forEach((lot, idx) => {
      rows.push({
        ...base,
        symbol: sym,
        __rowKey: `${sym}__lot${idx}`,
        __lotTime: lot.time,
        __lotPrice: lot.price,
        __lotQty: lot.qty,
        __lotExchange: lot.exchange,
      });
    });
  }
  rows.sort((a, b) => {
    const ta = a.__lotTime ?? 0;
    const tb = b.__lotTime ?? 0;
    if (tb !== ta) return tb - ta;
    return a.symbol.localeCompare(b.symbol);
  });
  return rows;
}

export function formatLotTime(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
