import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCurrency } from '../contexts/CurrencyContext';
import SearchInput from './SearchInput';
import {
  fetchCandlesticksAndCloud, fetchGateCurrencies, gatePreloadCandles,
  fetchMaCrossoverFilter, fetchMultitradeTrades,
  fetchGateTrades, fetchBinanceTrades,
} from '../services/api';
import { parseMaCrossFilterName } from '../utils/filterNames';
import { useI18n } from '../i18n';
import MultitradeModal from './MultitradeModal';
import MultitradeBotStateModal from './MultitradeBotStateModal';
import { getEntriesForSymbol } from '../constants/strategyPresets';
import { CHART_VIEW } from '../utils/chartView';
import {
  resolveTradeChartInterval,
  loadMultitradeSymbolChart,
  buildMarkersFromExchangeTrades,
} from '../utils/multitradeChart';
import { multitradePhaseBadge, symbolPhaseSummary } from '../utils/multitradePhase';
import {
  compareMacrossFavorites, formatMacrossStatusBadge,
  loadMacrossFavSort, isMaCrossEntry,
} from '../utils/macrossFavoritesSort';
import {
  compareTradeFavorites, filterTradeFavorites, formatTradePnlBadge,
  formatTradeStatusBadge, loadTradeFavSort, tradePnlForSort,
} from '../utils/tradeFavoritesSort';
import { useMacrossFavoritesStatus } from '../hooks/useMacrossFavoritesStatus';
import { useTradeFavoritesSummary } from '../hooks/useTradeFavoritesSummary';
import { useVirtualRows } from '../hooks/useVirtualRows';
import MacrossFavSortSelect from './MacrossFavSortSelect';
import TradeFavSortSelect from './TradeFavSortSelect';

const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#fcd535';
const MT_COLOR      = '#22d3ee';
const TRADE_COLOR   = '#00c076';
const ALTA_COLOR    = '#f97316';
const NOVAS_COLOR   = '#a78bfa';

const HIGHLIGHT_FILTERS = {
  ALTA_BINANCE: 'Favoritos|Alta|Binance',
  ALTA_GATE:    'Favoritos|Alta|Gate',
  NOVAS_BINANCE:'Favoritos|Novas|Binance',
  NOVAS_GATE:   'Favoritos|Novas|Gate',
};

function isMaCrossEntryLocal(e) {
  return isMaCrossEntry(e);
}

function getMaCrossEntries(favorites, symbol) {
  return getEntriesForSymbol(favorites, symbol).filter(isMaCrossEntryLocal);
}


function fmtBuyTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function formatVolume(vol) {
  if (vol == null || isNaN(vol) || vol <= 0) return '—';
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`;
  return vol.toFixed(0);
}

function rowVolume24h(item, highlightMeta) {
  return Number(highlightMeta?.volume24h?.[item.symbol] ?? item.volume) || 0;
}

function fmtChangePct(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtListedAt(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  });
}

// Remove a quote do final do símbolo: "BTCUSDT" → "BTC", "BNBUSDT" → "BNB"
function splitSymbol(symbol) {
  if (symbol.endsWith('USDT')) return { base: symbol.slice(0, -4), quote: 'USDT' };
  if (symbol.endsWith('BTC'))  return { base: symbol.slice(0, -3),  quote: 'BTC' };
  if (symbol.endsWith('BNB'))  return { base: symbol.slice(0, -3),  quote: 'BNB' };
  return { base: symbol, quote: '' };
}


const FAV_LOG = '[Favoritos]';

/** Altura estimada de cada linha da tabela (px) — virtual scroll. */
const TABLE_ROW_HEIGHT = 38;

function FavButton({ active, color, label, text, symbol, kind, onClick, tipKey }) {
  const { t } = useI18n();
  const btnKind = kind ?? label;
  const title = tipKey
    ? t(active ? `fav.row.${tipKey}_${tipKey === 'macross' ? 'edit' : 'remove'}` : `fav.row.${tipKey}_add`)
    : `${active ? 'Remover de' : 'Adicionar a'} favoritos ${label}`;
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.stopPropagation();
        console.log(`${FAV_LOG} pointerdown`, { kind: btnKind, symbol, active });
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`${FAV_LOG} clique`, { kind: btnKind, symbol, active });
        try {
          const result = onClick?.(e);
          if (result?.then) {
            result.catch((err) => {
              console.error(`${FAV_LOG} erro async`, { kind: btnKind, symbol }, err);
            });
          }
        } catch (err) {
          console.error(`${FAV_LOG} erro sync`, { kind: btnKind, symbol }, err);
        }
      }}
      title={title}
      className="flex items-center justify-center min-w-[26px] min-h-[26px] w-[26px] h-[26px] rounded text-[10px] font-bold transition-colors touch-manipulation active:scale-95 shrink-0"
      style={{
        background: active ? color : 'transparent',
        color: active ? '#fff' : color,
        border: `1.5px solid ${color}`,
        opacity: active ? 1 : 0.55,
      }}
    >
      {text ?? label[0]}
    </button>
  );
}

function ToolbarBtn({ active, color, label, count, onClick, title, id }) {
  const filled = active;
  return (
    <button
      type="button"
      id={id}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`${FAV_LOG} toolbar`, { label, active: filled, count });
        try {
          onClick?.();
        } catch (err) {
          console.error(`${FAV_LOG} toolbar erro`, { label }, err);
        }
      }}
      title={title}
      className="flex items-center shrink-0 touch-manipulation active:scale-95 transition-transform"
    >
      <span
        className="text-[11px] font-bold px-2 py-1 rounded min-h-[28px] flex items-center"
        style={{
          background: filled ? color : 'rgba(255,255,255,0.06)',
          color: filled ? (color === BINANCE_COLOR ? '#000' : '#fff') : color,
          border: `1.5px solid ${color}`,
          boxShadow: filled ? `0 0 0 1px ${color}44` : 'none',
        }}
      >
        {label}{count > 0 ? ` ${count}` : ''}
      </span>
    </button>
  );
}

// Para cada símbolo favorito: usa Binance se tiver volume > 0, senão Gate.
// Símbolos não encontrados em nenhum lugar são ignorados.
function resolveFavorites(favSet, binanceList, gateAll) {
  const binanceMap = new Map(binanceList.map((c) => [c.symbol, c]));
  const gateMap    = new Map((gateAll || []).map((c) => [c.symbol, c]));
  const result = [];
  for (const sym of favSet) {
    const b = binanceMap.get(sym);
    const g = gateMap.get(sym);
    if (b && (b.volume || 0) > 0) result.push(b);
    else if (g) result.push(g);
    else if (b)  result.push(b); // volume 0 mas existe — inclui mesmo assim
  }
  return result;
}

function ModalPortal({ children }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000]">{children}</div>,
    document.body,
  );
}

function needsGateFallback(activeFilterName) {
  if (!activeFilterName) return false;
  return activeFilterName.startsWith('Mercado|')
    || activeFilterName.startsWith('Favoritos|Alta|Gate')
    || activeFilterName.startsWith('Favoritos|Novas|Gate')
    || activeFilterName === 'Favoritos|Gate';
}

function isHighlightFilterName(name) {
  return name?.startsWith('Favoritos|Alta|') || name?.startsWith('Favoritos|Novas|');
}

function macrossLiveAgeMin(meta, nowMs = Date.now(), scannedAt) {
  if (!meta) return null;
  if (meta.crossTime != null) return Math.max(0, (nowMs - Number(meta.crossTime)) / 60_000);
  if (meta.ageMin != null && scannedAt) {
    return meta.ageMin + Math.max(0, (nowMs - Number(scannedAt)) / 60_000);
  }
  return meta.ageMin ?? null;
}

function formatMacrossBadge(meta, t, nowMs = Date.now(), scannedAt, interval) {
  if (!meta) return null;
  if (meta.kind === 'approaching') {
    const arrow = meta.direction === 'down' ? '↓' : '↑';
    const gap = meta.gapPct != null ? `${meta.gapPct}%` : '—';
    return t('table.macross_near', arrow, gap);
  }
  let ageMin = macrossLiveAgeMin(meta, nowMs, scannedAt);
  if (ageMin != null) {
    const arrow = meta.direction === 'down' ? '↓' : '↑';
    const rounded = Math.round(ageMin * 10) / 10;
    const age = rounded < 1 ? `${Math.round(rounded * 60)}s` : `${rounded}m`;
    return t('table.macross_crossed', arrow, age, interval);
  }
  return null;
}

export default function CurrencyTable({ activeFilter, onSelectFilter, onSelectCurrency }) {
  const {
    currencies, findFilter, selectedQuote,     selectedChart, setSelectedChart, setChartZoom, setChartTradeMarkers,
    setChartViewSource, clearMultitradeChartView, chartInterval, setChartInterval,
    applyMultitradeSymbolChart,
    gateFavorites, binanceFavorites,
    toggleGateFavorite, toggleBinanceFavorite,
    setTradePurchases, setAllTrades,
    multitradeFavorites, removeMultitradeEntry, saveMultitradeSymbol, updateMultitradeBotState,
    filterVisibleCurrencies, isVisibleSymbol, addFilter,
    ensureMarketHighlights, marketHighlightsLoading,
    favoriteView, toggleFavoriteView, clearFavoriteView,
    resetChartCandleWindow,
  } = useCurrency();
  const { t, formatPrice } = useI18n();
  const [loadingSymbol, setLoadingSymbol]       = useState(null);
  const [activeRow, setActiveRow]               = useState(null);
  const [mtModal, setMtModal]       = useState(null);
  const [mtStateModal, setMtStateModal] = useState(null);
  const [search, setSearch]               = useState('');
  const [sortVolume, setSortVolume]       = useState('none'); // 'desc' | 'asc' | 'none'
  const [gateItems, setGateItems]         = useState([]);
  const [gateLoading, setGateLoading]     = useState(false);
  const [gateAll, setGateAll]             = useState(null); // todas as moedas Gate (para favoritos)
  const gateCacheRef                      = useRef(null);
  const tableScrollRef                    = useRef(null);
  const [macrossLive, setMacrossLive]     = useState(false);
  const [macrossRefreshing, setMacrossRefreshing] = useState(false);
  const [macrossTick, setMacrossTick]     = useState(0);
  const [macrossFavSort, setMacrossFavSort] = useState(() => loadMacrossFavSort());
  const [tradeFavSort, setTradeFavSort] = useState(() => loadTradeFavSort());

  const macrossFavSymbols = useMemo(() => (
    [...new Set(
      multitradeFavorites
        .filter(e => e.enabled !== false && isMaCrossEntryLocal(e))
        .map(e => e.symbol),
    )].sort()
  ), [multitradeFavorites]);

  const tradeExtraSymbols = useMemo(
    () => [...gateFavorites, ...binanceFavorites],
    [gateFavorites, binanceFavorites],
  );

  const isMacrossFavView = favoriteView === 'macross';
  const isTradesFavView = favoriteView === 'trades';
  const isAltaFilter = activeFilter?.startsWith('Favoritos|Alta|') ?? false;
  const isNovasFilter = activeFilter?.startsWith('Favoritos|Novas|') ?? false;
  const isFavVolumeContext = !!favoriteView || isAltaFilter || isNovasFilter;
  const volumeSortActive = sortVolume !== 'none';
  const tableColCount = isAltaFilter ? 6 : 5;
  const highlightMeta = useMemo(() => {
    if (!activeFilter || favoriteView) return null;
    return findFilter(activeFilter)?.meta ?? null;
  }, [activeFilter, favoriteView, findFilter]);
  const {
    status: macrossFavStatus,
    loading: macrossFavLoading,
    entriesBySymbol: macrossEntriesBySymbol,
  } = useMacrossFavoritesStatus(macrossFavSymbols, multitradeFavorites, isMacrossFavView);
  const {
    symbols: tradeFavSymbols,
    status: tradeFavStatus,
    loading: tradeFavLoading,
  } = useTradeFavoritesSummary(tradeExtraSymbols, isTradesFavView);

  const activeMacrossFilter = useMemo(() => {
    if (!activeFilter || favoriteView) return null;
    const f = findFilter(activeFilter);
    if (!f || !parseMaCrossFilterName(f.name)) return null;
    return f;
  }, [activeFilter, favoriteView, findFilter]);

  const macrossFilterParams = useMemo(
    () => (activeMacrossFilter ? parseMaCrossFilterName(activeMacrossFilter.name) : null),
    [activeMacrossFilter],
  );

  const macrossMeta = activeMacrossFilter?.meta ?? null;
  const macrossScannedAt = activeMacrossFilter?.scannedAt ?? null;
  const macrossSigInterval = macrossFilterParams?.sigInterval
    ?? macrossFilterParams?.interval1
    ?? null;

  const cycleSort = useCallback(() => {
    if (isFavVolumeContext) {
      setSortVolume((v) => {
        if (v === 'desc') return 'asc';
        if (v === 'asc') return 'none';
        return 'desc';
      });
      return;
    }
    setSortVolume((v) => (v === 'desc' ? 'asc' : 'desc'));
  }, [isFavVolumeContext]);

  const onMacrossFavSortChange = useCallback((sortBy) => {
    setMacrossFavSort(sortBy);
    setSortVolume('none');
  }, []);

  const onTradeFavSortChange = useCallback((sortBy) => {
    setTradeFavSort(sortBy);
    setSortVolume('none');
  }, []);

  const rows = useMemo(() => {
    if (!currencies.list?.length) return [];

    let list;

    if (favoriteView === 'gate') {
      list = resolveFavorites(gateFavorites, currencies.list, gateAll);
    } else if (favoriteView === 'binance') {
      list = currencies.list.filter((c) => binanceFavorites.has(c.symbol));
    } else if (favoriteView === 'macross') {
      const mtSymbols = new Set(
        multitradeFavorites.filter(e => e.enabled !== false && isMaCrossEntry(e)).map(e => e.symbol),
      );
      list = resolveFavorites(mtSymbols, currencies.list, gateAll);
    } else if (favoriteView === 'trades') {
      const filtered = filterTradeFavorites(tradeFavSymbols, tradeFavStatus, tradeFavSort);
      list = resolveFavorites(new Set(filtered), currencies.list, gateAll);
      const have = new Set(list.map(c => c.symbol));
      for (const sym of filtered) {
        if (!have.has(sym)) list.push({ symbol: sym, price: 0, volume: 0 });
      }
    } else if (activeFilter) {
      const filter = findFilter(activeFilter);
      if (filter) {
        const useGateFallback = needsGateFallback(activeFilter);
        const binanceBySymbol = new Map(currencies.list.map((c) => [c.symbol, c]));
        const gateBySymbol = useGateFallback && gateAll
          ? new Map(gateAll.map((c) => [c.symbol, c]))
          : null;
        const mapped = filter.list
          .filter((sym) => isVisibleSymbol(sym))
          .map((sym) => binanceBySymbol.get(sym) ?? gateBySymbol?.get(sym) ?? null)
          .filter(Boolean);
        const have = new Set(mapped.map((c) => c.symbol));
        list = mapped;
        for (const sym of filter.list) {
          if (!have.has(sym) && isVisibleSymbol(sym)) {
            list.push({ symbol: sym, price: 0, volume: 0 });
          }
        }
      }
    }

    if (!list) {
      list = currencies.list.filter((c) => c.symbol.endsWith(selectedQuote));
    }

    list = filterVisibleCurrencies(list);

    if (search.trim()) {
      const term = search.trim().toUpperCase();
      list = list.filter((c) => c.symbol.includes(term));
    }

    if (isMacrossFavView && sortVolume === 'none') {
      list = list.slice().sort((a, b) => compareMacrossFavorites(a, b, macrossFavSort, {
        status: macrossFavStatus,
        entriesBySymbol: macrossEntriesBySymbol,
      }));
    } else if (isTradesFavView && sortVolume === 'none') {
      list = list.slice().sort((a, b) => compareTradeFavorites(a, b, tradeFavSort, tradeFavStatus));
    } else if (sortVolume !== 'none') {
      list = list.slice().sort((a, b) => {
        const va = (isAltaFilter || isNovasFilter) ? rowVolume24h(a, highlightMeta) : Number(a.volume) || 0;
        const vb = (isAltaFilter || isNovasFilter) ? rowVolume24h(b, highlightMeta) : Number(b.volume) || 0;
        return sortVolume === 'desc' ? vb - va : va - vb;
      });
    }

    return list;
  }, [currencies, activeFilter, selectedQuote, findFilter, search, favoriteView, gateFavorites, binanceFavorites, multitradeFavorites, sortVolume, gateAll, filterVisibleCurrencies, isVisibleSymbol, activeMacrossFilter, macrossScannedAt, macrossTick, isMacrossFavView, macrossFavSort, macrossFavStatus, macrossEntriesBySymbol, isTradesFavView, tradeFavSort, tradeFavSymbols, tradeFavStatus, isAltaFilter, isNovasFilter, highlightMeta]);

  const { slice: visibleRows, paddingTop, paddingBottom } = useVirtualRows({
    items: rows,
    rowHeight: TABLE_ROW_HEIGHT,
    containerRef: tableScrollRef,
    overscan: 10,
  });

  // Atualização em tempo real de filtros macross (cruzou há N min / prestes a cruzar)
  useEffect(() => {
    if (!activeMacrossFilter) {
      setMacrossLive(false);
      return;
    }

    const params = parseMaCrossFilterName(activeMacrossFilter.name);
    if (!params) return;

    let cancelled = false;
    setMacrossLive(true);

    async function refresh() {
      setMacrossRefreshing(true);
      try {
        const result = await fetchMaCrossoverFilter({
          period1: String(params.period1),
          interval1: params.interval1,
          period2: String(params.period2),
          interval2: params.interval2,
          mode: params.mode,
          maxAgeMin: params.maxAgeMin,
          tolerancePct: String(params.tolerancePct),
          proximityPct: String(params.proximityPct),
          live: true,
        });
        if (!cancelled) {
          addFilter({
            name: result.name,
            list: result.list,
            meta: result.details,
            scannedAt: result.scannedAt,
          });
        }
      } catch (err) {
        console.warn('[macross-live]', err.message);
      } finally {
        if (!cancelled) setMacrossRefreshing(false);
      }
    }

    refresh();
    const pollMs = params.mode.startsWith('near') || ['5', '15'].includes(params.maxAgeMin)
      ? 30_000
      : 60_000;
    const id = setInterval(refresh, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeMacrossFilter?.name, addFilter]);

  // Atualiza idade exibida do badge entre polls (crossTime → agora)
  useEffect(() => {
    if (!activeMacrossFilter) return undefined;
    const id = setInterval(() => setMacrossTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [activeMacrossFilter?.name]);

  // Busca Gate.io sempre que o usuário digita (≥2 chars), excluindo moedas já na lista Binance
  useEffect(() => {
    const term = search.trim().toUpperCase();
    if (term.length < 2) { setGateItems([]); return; }

    let cancelled = false;
    setGateLoading(true);

    (async () => {
      try {
        if (!gateCacheRef.current) {
          gateCacheRef.current = await fetchGateCurrencies();
          setGateAll(gateCacheRef.current);
        }
        if (!cancelled) {
          const binanceSymbols = new Set(currencies.list?.map(c => c.symbol) ?? []);
          setGateItems(
            gateCacheRef.current
              .filter(c => c.symbol.includes(term) && !binanceSymbols.has(c.symbol) && isVisibleSymbol(c.symbol))
              .slice(0, 40)
          );
        }
      } catch {
        if (!cancelled) setGateItems([]);
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [search, currencies.list, isVisibleSymbol]);

  // Pré-carrega Gate.io — necessário para favoritos G, MC, TX e filtros Gate
  useEffect(() => {
    if (gateCacheRef.current) { setGateAll(gateCacheRef.current); return; }
    fetchGateCurrencies().then((items) => {
      gateCacheRef.current = items;
      setGateAll(items);
    }).catch(() => {});
  }, []);

  // Recarrega Gate quando filtros de mercado/favoritos Gate exigem fallback
  useEffect(() => {
    const needGate = favoriteView === 'gate' || favoriteView === 'macross' || favoriteView === 'trades'
      || needsGateFallback(activeFilter);
    if (!needGate) return;
    if (gateCacheRef.current) { setGateAll(gateCacheRef.current); return; }
    fetchGateCurrencies().then((items) => {
      gateCacheRef.current = items;
      setGateAll(items);
    }).catch(() => {});
  }, [favoriteView, activeFilter]);

  async function handleSelect(item, source = null) {
    onSelectCurrency?.();
    resetChartCandleWindow();
    setLoadingSymbol(item.symbol);
    setActiveRow(item.symbol);
    setTradePurchases([]);
    setAllTrades([]);
    try {
      setChartZoom(null);
      setChartTradeMarkers([]);
      clearMultitradeChartView();

      const tradeMeta = isTradesFavView ? tradeFavStatus[item.symbol] : null;
      const isGateOnly = !currencies.list.some(c => c.symbol === item.symbol);
      const isGateFav  = gateFavorites.has(item.symbol);
      let effectiveSource = source ?? ((isGateOnly || isGateFav) ? 'gate' : null);
      if (tradeMeta?.exchange === 'gate') effectiveSource = 'gate';
      else if (tradeMeta?.exchange === 'binance') effectiveSource = null;
      else if (tradeMeta?.exchange === 'both' && isGateFav) effectiveSource = 'gate';

      const mtEntries = getMaCrossEntries(multitradeFavorites, item.symbol).filter(e => e.enabled !== false);
      const mtEntry = mtEntries[0] ?? null;
      const isMT = !!mtEntry && !isTradesFavView;

      let effectiveInterval = chartInterval || selectedChart?.interval || '15m';
      if (macrossSigInterval) {
        // Mesmo timeframe do filtro — evita comparar idade EMA15m com gráfico/Binance em 5m
        effectiveInterval = macrossSigInterval;
      } else if (isMT) {
        effectiveInterval = resolveTradeChartInterval(mtEntry, null);
      }

      setChartInterval(effectiveInterval);
      setChartViewSource(
        isTradesFavView ? CHART_VIEW.TRADES
          : (isMT && !macrossSigInterval ? CHART_VIEW.MULTITRADE : CHART_VIEW.TABLE),
      );

      // Favorito MA-Cross só manda no chart quando não há filtro macross ativo
      if (isMT && !macrossSigInterval) {
        await loadMultitradeSymbolChart(mtEntry, {
          fetchCandlesticksAndCloud,
          fetchMultitradeTrades,
          applyMultitradeSymbolChart,
        });
        if (effectiveSource === 'gate') gatePreloadCandles(item.symbol);
        return;
      }

      const data = await fetchCandlesticksAndCloud(item.symbol, effectiveInterval, effectiveSource);
      setSelectedChart({ ...data, interval: effectiveInterval, symbol: item.symbol, source: effectiveSource ?? null });
      if (effectiveSource === 'gate') gatePreloadCandles(item.symbol);

      // View de trades: compras/vendas + PnL no gráfico
      if (isTradesFavView) {
        const useGate = effectiveSource === 'gate';
        const trades = await (useGate ? fetchGateTrades(item.symbol) : fetchBinanceTrades(item.symbol));
        setAllTrades(trades);
        setTradePurchases(trades.filter(t => t.isBuyer));
        setChartTradeMarkers(buildMarkersFromExchangeTrades(trades));
      }
    } catch (err) {
      console.warn(`[CurrencyTable] candles indisponíveis para ${item.symbol}:`, err.message);
    } finally {
      setLoadingSymbol(null);
    }
  }

  function handleToggleFavoriteView(type) {
    console.log(`${FAV_LOG} toggle view`, { type, prev: favoriteView });
    const entering = favoriteView !== type;
    toggleFavoriteView(type);
    setSearch('');
    onSelectFilter?.(null);
    if (entering) setSortVolume('none');
  }

  async function selectHighlightFilter(name) {
    clearFavoriteView();
    setSearch('');
    if (isHighlightFilterName(name) && activeFilter !== name) setSortVolume('none');
    const next = activeFilter === name ? null : name;
    if (next && isHighlightFilterName(next) && !findFilter(next)) {
      try {
        await ensureMarketHighlights();
      } catch (err) {
        console.warn('[CurrencyTable] market-highlights:', err.message);
      }
    }
    onSelectFilter?.(next);
  }

  const highlightLoading = marketHighlightsLoading
    && isHighlightFilterName(activeFilter)
    && !findFilter(activeFilter);

  const gateCount    = gateFavorites.size;
  const binanceCount = binanceFavorites.size;
  const tradeCount   = tradeFavSymbols.length;
  const mtCount      = new Set(
    multitradeFavorites.filter(e => e.enabled !== false && isMaCrossEntry(e)).map(e => e.symbol),
  ).size;

  /** Somatório do PnL das linhas visíveis (respeita filtro ativo). */
  const tradePnlSum = useMemo(() => {
    if (!isTradesFavView || !rows.length) return null;
    let sum = 0;
    let any = false;
    for (const item of rows) {
      const pnl = tradePnlForSort(tradeFavStatus[item.symbol], tradeFavSort);
      if (pnl == null || !Number.isFinite(pnl)) continue;
      sum += pnl;
      any = true;
    }
    return any ? Math.round(sum * 100) / 100 : null;
  }, [isTradesFavView, rows, tradeFavStatus, tradeFavSort]);

  const tradePnlSumLabel = formatTradePnlBadge(tradePnlSum);

  const showFavSortInHeader = isMacrossFavView || isTradesFavView;
  const favColWidth = showFavSortInHeader ? '10.5rem' : '7.5rem';

  const volSortArrow = sortVolume === 'desc' ? ' ↓' : sortVolume === 'asc' ? ' ↑' : '';
  const volSortTitle = volumeSortActive
    ? (sortVolume === 'desc' ? 'Volume: maior primeiro — clique para menor'
      : 'Volume: menor primeiro — clique para desabilitar')
    : 'Ordenar por volume 24h';

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Barra de busca */}
      <div className="px-2 py-1 shrink-0">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('table.search')}
        />
      </div>

      {/* Cabeçalho contador + filtros de favoritos */}
      <div className="flex flex-col gap-1 px-2 py-1 border-b border-p2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-p5 opacity-50 uppercase tracking-wider shrink-0">
            Moedas
            {macrossLive && (
              <span className="ml-1.5 normal-case tracking-normal text-[10px] text-emerald-400/90">
                {macrossRefreshing ? '⟳' : '●'} live
              </span>
            )}
          </span>
          <span className="text-xs font-mono text-p4 shrink-0">
            {highlightLoading && <span className="text-orange-400/80 mr-1">⟳</span>}
            {rows.length}
          </span>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-thin touch-pan-x">
          <ToolbarBtn
            id="currency-table-btn-filter-trades"
            active={favoriteView === 'trades'}
            color={TRADE_COLOR}
            label="TX"
            count={tradeCount}
            title={favoriteView === 'trades' ? t('fav.toolbar.trades_active') : t('fav.toolbar.trades', tradeCount)}
            onClick={() => handleToggleFavoriteView('trades')}
          />
          <ToolbarBtn
            id="currency-table-btn-filter-macross"
            active={favoriteView === 'macross'}
            color={MT_COLOR}
            label="MC"
            count={mtCount}
            title={favoriteView === 'macross' ? t('fav.toolbar.macross_active') : t('fav.toolbar.macross', mtCount)}
            onClick={() => handleToggleFavoriteView('macross')}
          />
          <ToolbarBtn
            active={favoriteView === 'gate'}
            color={GATE_COLOR}
            label="G"
            count={gateCount}
            title={favoriteView === 'gate' ? t('fav.toolbar.gate_active') : t('fav.toolbar.gate', gateCount)}
            onClick={() => handleToggleFavoriteView('gate')}
          />
          <ToolbarBtn
            active={favoriteView === 'binance'}
            color={BINANCE_COLOR}
            label="B"
            count={binanceCount}
            title={favoriteView === 'binance' ? t('fav.toolbar.binance_active') : t('fav.toolbar.binance', binanceCount)}
            onClick={() => handleToggleFavoriteView('binance')}
          />
          <ToolbarBtn
            active={activeFilter === HIGHLIGHT_FILTERS.ALTA_BINANCE}
            color={ALTA_COLOR}
            label="↑B"
            count={0}
            title={t('filter.fav_gainers_binance')}
            onClick={() => selectHighlightFilter(HIGHLIGHT_FILTERS.ALTA_BINANCE)}
          />
          <ToolbarBtn
            active={activeFilter === HIGHLIGHT_FILTERS.ALTA_GATE}
            color={ALTA_COLOR}
            label="↑G"
            count={0}
            title={t('filter.fav_gainers_gate')}
            onClick={() => selectHighlightFilter(HIGHLIGHT_FILTERS.ALTA_GATE)}
          />
          <ToolbarBtn
            active={activeFilter === HIGHLIGHT_FILTERS.NOVAS_BINANCE}
            color={NOVAS_COLOR}
            label="NB"
            count={0}
            title={t('filter.fav_new_binance')}
            onClick={() => selectHighlightFilter(HIGHLIGHT_FILTERS.NOVAS_BINANCE)}
          />
          <ToolbarBtn
            active={activeFilter === HIGHLIGHT_FILTERS.NOVAS_GATE}
            color={NOVAS_COLOR}
            label="NG"
            count={0}
            title={t('filter.fav_new_gate')}
            onClick={() => selectHighlightFilter(HIGHLIGHT_FILTERS.NOVAS_GATE)}
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto" ref={tableScrollRef}>
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col style={{ width: favColWidth }} />
            <col />
            <col style={{ width: '4.75rem' }} />
            {isAltaFilter && <col style={{ width: '3.75rem' }} />}
            <col style={{ width: '3.75rem' }} />
            <col style={{ width: '1.5rem' }} />
          </colgroup>
          <thead className="sticky top-0 z-30 bg-p1">
            <tr className="lt-table-head">
              <th
                className="text-left px-1 py-1 align-middle bg-p1"
                style={{ width: favColWidth, minWidth: favColWidth }}
                title={
                  isMacrossFavView ? t('macross.sort.label')
                    : isTradesFavView ? t('trades.sort.label')
                    : undefined
                }
              >
                {isMacrossFavView ? (
                  <div className="flex items-center justify-start gap-0.5">
                    {macrossFavLoading && (
                      <span className="text-[9px] text-emerald-400/80 shrink-0">⟳</span>
                    )}
                    <MacrossFavSortSelect
                      value={macrossFavSort}
                      onChange={onMacrossFavSortChange}
                      className="shrink-0"
                    />
                    <button
                      type="button"
                      className={`text-[8px] font-bold px-0.5 shrink-0 touch-manipulation ${
                        volumeSortActive ? 'text-p5/90' : 'text-p5/45 hover:text-p5/80'
                      }`}
                      title={volSortTitle}
                      onClick={(e) => { e.stopPropagation(); cycleSort(); }}
                    >
                      Vol{volSortArrow}
                    </button>
                  </div>
                ) : isTradesFavView ? (
                  <div className="flex items-center justify-start gap-0.5">
                    {tradeFavLoading && (
                      <span className="text-[9px] text-emerald-400/80 shrink-0">⟳</span>
                    )}
                    <TradeFavSortSelect
                      value={tradeFavSort}
                      onChange={onTradeFavSortChange}
                      className="shrink-0"
                    />
                    <button
                      type="button"
                      className={`text-[8px] font-bold px-0.5 shrink-0 touch-manipulation ${
                        volumeSortActive ? 'text-p5/90' : 'text-p5/45 hover:text-p5/80'
                      }`}
                      title={volSortTitle}
                      onClick={(e) => { e.stopPropagation(); cycleSort(); }}
                    >
                      Vol{volSortArrow}
                    </button>
                  </div>
                ) : null}
              </th>
              <th className="text-left px-2 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Par</th>
              <th className="text-right px-2 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Preço</th>
              {isAltaFilter && (
                <th
                  className="text-right px-2 py-1.5 text-p5 opacity-80 font-normal uppercase tracking-wider whitespace-nowrap"
                  title={t('table.change_24h_tip')}
                >
                  {t('table.change_24h')}
                </th>
              )}
              <th
                className={`text-right px-2 py-1.5 text-p5 font-normal uppercase tracking-wider cursor-pointer hover:opacity-90 select-none whitespace-nowrap ${
                  volumeSortActive ? 'opacity-80' : 'opacity-50'
                }`}
                onClick={cycleSort}
                title={
                  isAltaFilter ? 'Volume: maior → menor → desabilitado (Var% na coluna ao lado)'
                    : isNovasFilter ? 'Volume: maior → menor → desabilitado (data na coluna Par)'
                    : isTradesFavView && !volumeSortActive ? 'Clique para ordenar por volume'
                    : volSortTitle
                }
              >
                {isTradesFavView && !volumeSortActive
                  ? 'PnL'
                  : `Vol${volSortArrow}`}
              </th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {isTradesFavView && tradeFavLoading && rows.length === 0 && (
              <tr>
                <td colSpan={tableColCount} className="py-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-[11px] text-p5/50">
                    <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin" />
                    Carregando trades…
                  </div>
                </td>
              </tr>
            )}

            {highlightLoading && rows.length === 0 && (
              <tr>
                <td colSpan={tableColCount} className="py-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-[11px] text-p5/50">
                    <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin" />
                    Carregando destaques…
                  </div>
                </td>
              </tr>
            )}

            {isMacrossFavView && !macrossFavLoading && rows.length === 0 && (
              <tr>
                <td colSpan={tableColCount} className="py-3 text-center text-[11px] text-p5/50">
                  Nenhum favorito MA-Cross — clique em MC numa moeda para configurar.
                </td>
              </tr>
            )}

            {paddingTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={tableColCount} style={{ height: paddingTop, padding: 0, border: 'none' }} />
              </tr>
            )}

            {visibleRows.map((item) => {
              const { base, quote } = splitSymbol(item.symbol);
              const isGate     = gateFavorites.has(item.symbol);
              const isBinance  = binanceFavorites.has(item.symbol);
              const mtEntries  = getMaCrossEntries(multitradeFavorites, item.symbol);
              const isMT       = mtEntries.some(e => e.enabled !== false);
              const tradeMeta  = isTradesFavView ? tradeFavStatus[item.symbol] : null;
              const tradePnl   = tradeMeta ? tradePnlForSort(tradeMeta, tradeFavSort) : null;
              const tradePnlLabel = formatTradePnlBadge(tradePnl);
              const tradeBadge = tradeMeta ? formatTradeStatusBadge(tradeMeta, tradeFavSort, t) : null;
              const changePct = highlightMeta?.changePct?.[item.symbol];
              const listedAt = highlightMeta?.listedAt?.[item.symbol];
              const highlightVol = highlightMeta?.volume24h?.[item.symbol] ?? item.volume;

              return (
                <tr
                  key={item.symbol}
                  onClick={() => handleSelect(item)}
                  className={`lt-table-row cursor-pointer transition-colors ${
                    activeRow === item.symbol
                      ? 'bg-p2/80 text-white'
                      : isTradesFavView
                      ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-p5'
                      : isMT
                      ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-p5'
                      : 'hover:bg-p2/40 text-p5'
                  }`}
                >
                  <td
                    className="pl-1 pr-0"
                    style={{ width: favColWidth, minWidth: favColWidth }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-nowrap items-center gap-0.5">
                      <FavButton tipKey="gate" kind="G" symbol={item.symbol} active={isGate}    color={GATE_COLOR}    label="Gate"    onClick={() => toggleGateFavorite(item.symbol)} />
                      <FavButton tipKey="binance" kind="B" symbol={item.symbol} active={isBinance} color={BINANCE_COLOR} label="Binance" onClick={() => toggleBinanceFavorite(item.symbol)} />
                      <FavButton tipKey="macross" kind="MC" symbol={item.symbol} active={isMT}      color={MT_COLOR}      label="MA-Cross" text="MC" onClick={() => {
                        console.log(`${FAV_LOG} MC abrir modal`, { symbol: item.symbol, entries: mtEntries.length, isMT });
                        setMtModal({ symbol: item.symbol, exchange: isGate && !isBinance ? 'gate' : 'binance', entries: mtEntries });
                      }} />
                    </div>
                  </td>

                  <td className="px-2 py-1.5 font-mono font-semibold">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {isMT && !isTradesFavView ? (() => {
                        const mtPhase = symbolPhaseSummary(mtEntries);
                        const mtPh = multitradePhaseBadge(mtPhase);
                        const bought = mtEntries.find(e => e.phase === 'BOUGHT' && e.buyTime);
                        return (
                          <span className="flex items-center gap-1 flex-wrap min-w-0">
                            <span className="shrink-0">
                              {base}<span className="opacity-40 font-normal text-[8px]">/{quote}</span>
                            </span>
                            <button
                              type="button"
                              className="text-[9px] font-bold px-1 py-0 rounded shrink-0 hover:underline"
                              style={{ color: mtPh.color, background: `${mtPh.color}18`, border: `1px solid ${mtPh.color}44` }}
                              title={`${mtPh.hint} — clique para alterar`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setMtStateModal({ symbol: item.symbol, entries: mtEntries });
                              }}>
                              {mtPh.text}
                            </button>
                            {bought?.buyTime && (
                              <span className="text-[9px] font-normal text-white/70 shrink-0">
                                ▌ {fmtBuyTime(bought.buyTime)}
                              </span>
                            )}
                          </span>
                        );
                      })() : (
                        <span>{base}<span className="opacity-40 font-normal text-[8px]">/{quote}</span></span>
                      )}
                      {isTradesFavView && tradeBadge && (
                        <span className="text-[9px] font-normal text-emerald-400/90">{tradeBadge}</span>
                      )}
                      {isNovasFilter && listedAt && (
                        <span className="text-[9px] font-normal text-violet-300/90">
                          {fmtListedAt(listedAt)}
                        </span>
                      )}
                      {(macrossMeta?.[item.symbol] || (isMacrossFavView && macrossFavStatus[item.symbol])) && (
                        <span className="text-[9px] font-bold text-emerald-400/90">
                          {macrossMeta?.[item.symbol]
                            ? formatMacrossBadge(macrossMeta[item.symbol], t, Date.now(), macrossScannedAt, macrossSigInterval)
                            : formatMacrossStatusBadge(macrossFavStatus[item.symbol], t)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    <div className="flex flex-col items-end">
                      <span>{formatPrice(item.price)}</span>
                    </div>
                  </td>
                  {isAltaFilter && (
                    <td
                      className="px-2 py-1.5 text-right font-mono text-[10px] font-semibold"
                      style={{ color: changePct == null ? 'rgba(255,255,255,0.35)' : changePct >= 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {changePct != null ? fmtChangePct(changePct) : '—'}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-right font-mono text-[10px]">
                    {isTradesFavView && !volumeSortActive ? (
                      <span
                        className="font-semibold"
                        style={{
                          color: tradePnl == null ? 'rgba(255,255,255,0.35)'
                            : tradePnl >= 0 ? '#22c55e' : '#ef4444',
                        }}
                      >
                        {tradePnlLabel ?? '—'}
                      </span>
                    ) : (isAltaFilter || isNovasFilter) ? (
                      <span className="opacity-60">{formatVolume(highlightVol)}</span>
                    ) : (
                      <span className="opacity-60">{formatVolume(item.volume)}</span>
                    )}
                  </td>
                  <td className="pr-1 text-center">
                    {loadingSymbol === item.symbol
                      ? <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin mx-auto" />
                      : activeRow === item.symbol
                        ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 mx-auto text-p4"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                        : null}
                  </td>
                </tr>
              );
            })}

            {paddingBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={tableColCount} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
              </tr>
            )}


            {gateLoading && rows.length === 0 && (
              <tr>
                <td colSpan={tableColCount} className="py-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-[11px] text-p5/50">
                    <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin" />
                    Buscando na Gate.io…
                  </div>
                </td>
              </tr>
            )}

            {gateItems.length > 0 && (
              <>
                <tr>
                  <td colSpan={tableColCount} className="px-2 py-1 border-t border-p3">
                    <span
                      className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                      style={{ color: GATE_COLOR, border: `1px solid ${GATE_COLOR}` }}
                    >
                      Gate.io · {gateItems.length}
                    </span>
                  </td>
                </tr>
                {gateItems.map((item) => {
                  const { base, quote } = splitSymbol(item.symbol);
                  const isGate   = gateFavorites.has(item.symbol);
                  const mtEntriesGate = getMaCrossEntries(multitradeFavorites, item.symbol);
                  const isMTGate = mtEntriesGate.some(e => e.enabled !== false);
                  return (
                    <tr
                      key={`gate-${item.symbol}`}
                      onClick={() => handleSelect(item, 'gate')}
                      className={`lt-table-row cursor-pointer transition-colors ${
                        activeRow === item.symbol
                          ? 'bg-p2/80 text-white'
                          : isMTGate
                          ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-p5'
                          : 'hover:bg-p2/40 text-p5'
                      }`}
                    >
                      <td
                    className="pl-1 pr-0"
                    style={{ width: favColWidth, minWidth: favColWidth }}
                    onClick={(e) => e.stopPropagation()}
                  >
                        <div className="flex flex-nowrap items-center gap-0.5">
                          <FavButton tipKey="gate" kind="G" symbol={item.symbol} active={isGate}   color={GATE_COLOR}  label="Gate"     onClick={() => toggleGateFavorite(item.symbol)} />
                          <FavButton tipKey="macross" kind="MC" symbol={item.symbol} active={isMTGate} color={MT_COLOR}    label="MA-Cross" text="MC" onClick={() => {
                            console.log(`${FAV_LOG} MC abrir modal (Gate)`, { symbol: item.symbol, entries: mtEntriesGate.length });
                            setMtModal({ symbol: item.symbol, exchange: 'gate', entries: mtEntriesGate });
                          }} />
                        </div>
                      </td>

                      <td className="px-2 py-1.5 font-mono font-semibold">
                        {base}<span className="opacity-40 font-normal text-[8px]">/{quote}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{item.price > 0 ? formatPrice(item.price) : '—'}</td>
                      {isAltaFilter && <td className="px-2 py-1.5 text-right font-mono text-[10px] opacity-35">—</td>}
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] opacity-60">{formatVolume(item.volume)}</td>
                      <td className="pr-1 text-center">
                        {loadingSymbol === item.symbol
                          ? <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin mx-auto" />
                          : activeRow === item.symbol
                            ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 mx-auto text-p4"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                            : null}
                      </td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
        </div>

        <div className="lt-table-foot">
          {isTradesFavView && rows.length > 0 && tradePnlSumLabel != null ? (
            <div className="flex items-center justify-between gap-2 px-2 py-0.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-p5/70">
                Total PnL
              </span>
              <span
                className="text-[10px] font-mono font-bold leading-none"
                style={{ color: tradePnlSum >= 0 ? '#22c55e' : '#ef4444' }}
              >
                {tradePnlSumLabel}
              </span>
            </div>
          ) : (
            <div className="px-2 py-0.5 min-h-[14px]" aria-hidden="true" />
          )}
        </div>
      </div>

      {/* Modais — portal evita corte no bottom sheet mobile (transform ancestor) */}
      {mtModal && (
        <ModalPortal>
          <MultitradeModal
            symbol={mtModal.symbol}
            defaultExchange={mtModal.exchange}
            currentEntries={mtModal.entries}
            onConfirm={async ({ saves }) => {
              console.log(`${FAV_LOG} MC confirmar`, { symbol: mtModal.symbol, saves });
              try {
                await saveMultitradeSymbol({ saves });
                console.log(`${FAV_LOG} MC salvo OK`, mtModal.symbol);
                setMtModal(null);
              } catch (err) {
                console.error(`${FAV_LOG} MC salvar falhou`, mtModal.symbol, err);
              }
            }}
            onRemove={mtModal.entries?.length ? async () => {
              console.log(`${FAV_LOG} MC remover`, { symbol: mtModal.symbol, ids: mtModal.entries.map(e => e.id) });
              try {
                for (const e of mtModal.entries) await removeMultitradeEntry(e.id);
                console.log(`${FAV_LOG} MC removido OK`, mtModal.symbol);
                setMtModal(null);
              } catch (err) {
                console.error(`${FAV_LOG} MC remover falhou`, mtModal.symbol, err);
              }
            } : undefined}
            onCancel={() => {
              console.log(`${FAV_LOG} MC cancelar`, mtModal.symbol);
              setMtModal(null);
            }}
          />
        </ModalPortal>
      )}

      {mtStateModal && (
        <ModalPortal>
          <MultitradeBotStateModal
            symbol={mtStateModal.symbol}
            entries={mtStateModal.entries}
            onConfirm={async (payload) => {
              await updateMultitradeBotState(payload);
              setMtStateModal(null);
            }}
            onCancel={() => setMtStateModal(null)}
          />
        </ModalPortal>
      )}

    </div>
  );
}
