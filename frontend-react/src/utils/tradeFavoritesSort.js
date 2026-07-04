/** Filtros/ordenação da lista de favoritos de trades (compras/vendas). */
export const TRADE_SORT_OPTIONS = [
  { id: 'recent',       labelKey: 'trades.sort.recent',       shortKey: 'trades.sort.short.recent' },
  { id: 'bought_today', labelKey: 'trades.sort.bought_today', shortKey: 'trades.sort.short.bought_today' },
  { id: 'bought_week',  labelKey: 'trades.sort.bought_week',  shortKey: 'trades.sort.short.bought_week' },
  { id: 'sold_today',   labelKey: 'trades.sort.sold_today',   shortKey: 'trades.sort.short.sold_today' },
  { id: 'sold_week',    labelKey: 'trades.sort.sold_week',    shortKey: 'trades.sort.short.sold_week' },
  { id: 'pnl_today',    labelKey: 'trades.sort.pnl_today',    shortKey: 'trades.sort.short.pnl_today' },
  { id: 'pnl_week',     labelKey: 'trades.sort.pnl_week',     shortKey: 'trades.sort.short.pnl_week' },
  { id: 'pnl_total',    labelKey: 'trades.sort.pnl_total',    shortKey: 'trades.sort.short.pnl_total' },
  { id: 'open',         labelKey: 'trades.sort.open',         shortKey: 'trades.sort.short.open' },
  { id: 'symbol',       labelKey: 'trades.sort.symbol',       shortKey: 'trades.sort.short.symbol' },
];

const STORAGE_KEY = 'lets_trade_trade_fav_sort';

export function loadTradeFavSort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && TRADE_SORT_OPTIONS.some(o => o.id === v)) return v;
  } catch {}
  return 'recent';
}

export function saveTradeFavSort(sortBy) {
  try { localStorage.setItem(STORAGE_KEY, sortBy); } catch {}
}

export function getTradeSortOption(sortBy) {
  return TRADE_SORT_OPTIONS.find(o => o.id === sortBy) ?? TRADE_SORT_OPTIONS[0];
}

/** direction: -1 = anterior, +1 = próximo */
export function cycleTradeFavSort(current, direction = 1) {
  const idx = TRADE_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = TRADE_SORT_OPTIONS.length;
  const next = TRADE_SORT_OPTIONS[(i + direction + n * 10) % n];
  saveTradeFavSort(next.id);
  return next.id;
}

function numOrNegInfinity(v) {
  return v != null && Number.isFinite(v) ? v : -Infinity;
}

/** PnL relevante para o filtro ativo (exibido na lista). */
export function tradePnlForSort(meta, sortBy) {
  if (!meta) return null;
  if (sortBy === 'pnl_today' || sortBy === 'bought_today' || sortBy === 'sold_today') {
    return meta.pnlToday;
  }
  if (sortBy === 'pnl_week' || sortBy === 'bought_week' || sortBy === 'sold_week') {
    return meta.pnlWeek;
  }
  return meta.pnlTotal;
}

/** Filtra símbolos conforme o modo de data/status. */
export function filterTradeFavorites(symbols, status, sortBy) {
  return symbols.filter((item) => {
    const sym = typeof item === 'string' ? item : item.symbol;
    const m = status[sym];
    if (!m) return false;
    switch (sortBy) {
      case 'bought_today': return (m.buysToday ?? 0) > 0;
      case 'bought_week':  return (m.buysWeek ?? 0) > 0;
      case 'sold_today':   return (m.sellsToday ?? 0) > 0;
      case 'sold_week':    return (m.sellsWeek ?? 0) > 0;
      case 'pnl_today':    return (m.sellsToday ?? 0) > 0;
      case 'pnl_week':     return (m.sellsWeek ?? 0) > 0;
      case 'open':         return !!m.hasOpen;
      default:             return true;
    }
  });
}

/** Compara dois itens da lista de trades. */
export function compareTradeFavorites(a, b, sortBy, status = {}) {
  const symA = typeof a === 'string' ? a : a.symbol;
  const symB = typeof b === 'string' ? b : b.symbol;
  const ma = status[symA];
  const mb = status[symB];

  if (sortBy === 'symbol') return symA.localeCompare(symB);

  if (sortBy === 'bought_today' || sortBy === 'bought_week') {
    const ta = numOrNegInfinity(ma?.lastBuyTime);
    const tb = numOrNegInfinity(mb?.lastBuyTime);
    if (ta !== tb) return tb - ta;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'sold_today' || sortBy === 'sold_week') {
    const ta = numOrNegInfinity(ma?.lastSellTime);
    const tb = numOrNegInfinity(mb?.lastSellTime);
    if (ta !== tb) return tb - ta;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'pnl_today') {
    const pa = numOrNegInfinity(ma?.pnlToday);
    const pb = numOrNegInfinity(mb?.pnlToday);
    if (pa !== pb) return pb - pa;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'pnl_week') {
    const pa = numOrNegInfinity(ma?.pnlWeek);
    const pb = numOrNegInfinity(mb?.pnlWeek);
    if (pa !== pb) return pb - pa;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'pnl_total') {
    const pa = numOrNegInfinity(ma?.pnlTotal);
    const pb = numOrNegInfinity(mb?.pnlTotal);
    if (pa !== pb) return pb - pa;
    return symA.localeCompare(symB);
  }

  if (sortBy === 'open') {
    const ca = numOrNegInfinity(ma?.openCost);
    const cb = numOrNegInfinity(mb?.openCost);
    if (ca !== cb) return cb - ca;
    return symA.localeCompare(symB);
  }

  // recent (default)
  const ta = numOrNegInfinity(ma?.lastTradeTime);
  const tb = numOrNegInfinity(mb?.lastTradeTime);
  if (ta !== tb) return tb - ta;
  return symA.localeCompare(symB);
}

export function formatTradePnlBadge(pnl) {
  if (pnl == null || !Number.isFinite(pnl)) return null;
  const sign = pnl > 0 ? '+' : '';
  const abs = Math.abs(pnl);
  const text = abs >= 100 ? `${sign}${pnl.toFixed(0)}` : `${sign}${pnl.toFixed(2)}`;
  return `$${text}`;
}

export function formatTradeStatusBadge(meta, sortBy, t) {
  if (!meta) return null;
  if (sortBy === 'open' && meta.hasOpen) {
    return t('trades.badge.open', meta.openCost?.toFixed?.(0) ?? meta.openCost);
  }
  if ((sortBy === 'bought_today' || sortBy === 'bought_week') && meta.lastBuyTime) {
    return t('trades.badge.bought', formatTradeTime(meta.lastBuyTime));
  }
  if ((sortBy === 'sold_today' || sortBy === 'sold_week') && meta.lastSellTime) {
    return t('trades.badge.sold', formatTradeTime(meta.lastSellTime));
  }
  if (meta.lastTradeTime) {
    return formatTradeTime(meta.lastTradeTime);
  }
  return null;
}

function formatTradeTime(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
