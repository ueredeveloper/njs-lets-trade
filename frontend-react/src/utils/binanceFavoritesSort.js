/** Ordenação do favorito "B" (Binance): ordem da lista, compradas primeiro ou aguardando primeiro —
 *  pela fase do bot (rsi_multi_bot_state, via multitradeFavorites) de cada moeda. */
import { symbolPhaseSummary } from './multitradePhase';
import { MANUAL_OCO_PENDING, MANUAL_OCO_MOUNTED } from './manualOco';

export const BINANCE_FAV_SORT_OPTIONS = [
  { id: 'default', labelKey: 'binfav.sort.default', shortKey: 'binfav.sort.short.default' },
  { id: 'bought', labelKey: 'binfav.sort.bought', shortKey: 'binfav.sort.short.bought' },
  { id: 'watching', labelKey: 'binfav.sort.watching', shortKey: 'binfav.sort.short.watching' },
];

// Moeda sem bot nenhum (`null`) sempre no fim.
const PHASE_ORDER = {
  bought:   { BOUGHT: 0, REBUY: 1, PENDING: 2, WATCHING: 3, FAILED: 4, null: 5 },
  watching: { WATCHING: 0, PENDING: 1, REBUY: 2, BOUGHT: 3, FAILED: 4, null: 5 },
};

const STORAGE_KEY = 'lets_trade_binance_fav_sort';

export function loadBinanceFavSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && BINANCE_FAV_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch { /* localStorage indisponível — usa o padrão */ }
  return 'default';
}

export function getBinanceFavSortOption(sortBy) {
  return BINANCE_FAV_SORT_OPTIONS.find(o => o.id === sortBy) ?? BINANCE_FAV_SORT_OPTIONS[0];
}

/** direction: -1 = anterior, +1 = próximo */
export function cycleBinanceFavSort(current, direction = 1) {
  const idx = BINANCE_FAV_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = BINANCE_FAV_SORT_OPTIONS.length;
  const next = BINANCE_FAV_SORT_OPTIONS[(i + direction + n * 10) % n];
  try { localStorage.setItem(STORAGE_KEY, next.id); } catch { /* sem persistência */ }
  return next.id;
}

/** Ordena `list` (moedas do favorito B) pela fase do bot. Moeda na carteira (`activeTrades`, o
 *  mesmo do filtro AT — compra manual/OCO avulsa, sem bot) conta como comprada. `manualOcoOrders`
 *  (OCO do Price action, ver utils/manualOco.js): esperando a entrada = aguardando, comprou =
 *  comprada. 'default' devolve a lista intacta; empate mantém a ordem original (sort estável). */
export function sortBinanceFavorites(list, sortBy, multitradeFavorites, activeTrades, manualOcoOrders) {
  const order = PHASE_ORDER[sortBy];
  if (!order) return list;
  const entriesBySymbol = new Map();
  for (const e of multitradeFavorites ?? []) {
    if (e.enabled === false) continue;
    const arr = entriesBySymbol.get(e.symbol);
    if (arr) arr.push(e); else entriesBySymbol.set(e.symbol, [e]);
  }
  const ocoPhaseBySymbol = new Map();
  for (const o of manualOcoOrders ?? []) {
    if (MANUAL_OCO_MOUNTED.has(o.status)) ocoPhaseBySymbol.set(o.symbol, 'BOUGHT');
    else if (MANUAL_OCO_PENDING.has(o.status) && !ocoPhaseBySymbol.has(o.symbol)) ocoPhaseBySymbol.set(o.symbol, 'WATCHING');
  }
  const rank = (sym) => {
    const entries = entriesBySymbol.get(sym);
    let phase = entries ? symbolPhaseSummary(entries) : 'null';
    const ocoPhase = ocoPhaseBySymbol.get(sym);
    if (phase !== 'BOUGHT' && (activeTrades?.has(sym) || ocoPhase === 'BOUGHT')) phase = 'BOUGHT';
    else if (phase === 'null' && ocoPhase) phase = ocoPhase;
    return order[phase] ?? 9;
  };
  return list.slice().sort((a, b) => rank(a.symbol) - rank(b.symbol));
}
