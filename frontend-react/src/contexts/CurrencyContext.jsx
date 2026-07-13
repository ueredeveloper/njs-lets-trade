import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { addFavorite, removeFavorite, fetchActiveTrades, ignoreActiveTrade,
  fetchMultitradeFavorites, addMultitradeFavorite, updateMultitradeFavorite, removeMultitradeFavorite,
  patchMultitradeBotState,
  fetchFiveMTradeFavorites, addFiveMTradeFavorite, updateFiveMTradeFavorite, removeFiveMTradeFavorite,
  fetchMarketHighlights } from '../services/api';
import { CHART_VIEW } from '../utils/chartView';
import {
  buildOverlaySlotsForEntry,
} from '../utils/multitradeChart';
import {
  ASSET_CATEGORY_KEYS,
  filterCurrencies,
  filterSymbols,
  isSymbolVisible,
  loadAssetDisplay,
  saveAssetDisplay,
} from '../utils/assetCategories';
import {
  CHART_PANEL_BUTTON_KEYS,
  loadChartPanelButtons,
  saveChartPanelButtons,
} from '../utils/chartPanelButtons';
import {
  CHART_INTERVAL_OPTIONS,
  PANEL_KEYS,
  loadUiPreferences,
  saveUiPreferences,
  normalizeOverlaySlots,
  normalizeMaBandsDefaults,
  normalizeBollingerBandsDefaults,
  normalizeActiveIndicators,
} from '../utils/uiPreferences';

const CurrencyContext = createContext(null);

/** Favoritos do painel MA-Cross (fase vem de rsi_multi_bot_state). */
function isMaCrossFavoriteEntry(e) {
  return e?.strategyId === 'ma-cross'
    || e?.kind === 'ma_cross'
    || e?.tradeConfig?.kind === 'ma_cross';
}

/** Poll da fase BOUGHT/WATCHING após compra/venda do bot. */
const MULTITRADE_STATE_POLL_MS = 30_000;

function isAutoHighlightFilter(name) {
  return name?.startsWith('Favoritos|Alta|') || name?.startsWith('Favoritos|Novas|');
}

const HIGHLIGHT_DISPLAY_LIMIT = 10;

/** Aplica Exibição de ativos e corta nos N finais usados na UI (NB, ↑B, cards). */
function applyAssetDisplayToHighlight(filter, assetDisplay, limit = HIGHLIGHT_DISPLAY_LIMIT) {
  if (!filter || !isAutoHighlightFilter(filter.name)) return filter;
  const candidates = Array.isArray(filter.meta?.candidates) && filter.meta.candidates.length > 0
    ? filter.meta.candidates
    : (filter.list ?? []);
  const list = candidates.filter((sym) => isSymbolVisible(sym, assetDisplay)).slice(0, limit);
  // Mantém listedAt/changePct/volume24h completos (candidatos) para reaplicar ao ligar categorias
  return {
    ...filter,
    list,
    meta: { ...(filter.meta || {}), candidates },
  };
}

export function CurrencyProvider({ children }) {
  // Lista completa do servidor; currencies expõe versão filtrada por categoria
  const [rawCurrencies, setRawCurrencies] = useState({ name: '1h|All', list: [] });
  const [assetDisplay, setAssetDisplayState] = useState(() => loadAssetDisplay());
  const assetDisplayRef = useRef(assetDisplay);
  assetDisplayRef.current = assetDisplay;
  const [chartPanelButtons, setChartPanelButtonsState] = useState(() => loadChartPanelButtons());
  const [uiPrefs, setUiPrefsState] = useState(() => loadUiPreferences());

  // [{ name: '1h|Binance|USDT', list: ['BTCUSDT', ...] }, ...]
  const [filters, setFilters] = useState([]);
  const [marketHighlightsLoading, setMarketHighlightsLoading] = useState(false);

  // Moeda selecionada para o gráfico: { symbol, candles, ichimoku }
  const [selectedChart, setSelectedChart] = useState(null);

  // Intervalo ativo no gráfico — fonte de verdade compartilhada entre chart e tabela
  const [chartInterval, setChartInterval] = useState(() => loadUiPreferences().defaultChartInterval);

  // Zoom do gráfico para um período específico: { startDate, endDate, source? } ISO strings
  const [chartZoom, setChartZoom] = useState(null);

  /** Quem controla o chart: default | table | statistics | multitrade — evita resets concorrentes */
  const [chartViewSource, setChartViewSource] = useState(CHART_VIEW.DEFAULT);

  // Marcadores simulados MT backtest: [{ time, side: 'buy'|'sell', price? }]
  const [chartTradeMarkers, setChartTradeMarkers] = useState([]);

  /** Foco do backtest MT: histórico e overlays para o momento do trade */
  const [multitradeChartFocus, setMultitradeChartFocus] = useState(null);

  // Trades de compra do usuário para a moeda selecionada (favorito Trade Now)
  // Array de { time: number (ms), price: string, qty: string, isBuyer: boolean }
  const [tradePurchases, setTradePurchases] = useState([]);

  // Todos os trades (compras + vendas) da moeda selecionada
  const [allTrades, setAllTrades] = useState([]);

  // Quote selecionada: 'USDT' | 'BTC' | 'BNB'
  const [selectedQuote, setSelectedQuote] = useState('USDT');

  // Favoritos Gate (azul #0068ff) e Binance (amarelo #fcd535)
  const [gateFavorites, setGateFavorites]       = useState(new Set());
  const [binanceFavorites, setBinanceFavorites] = useState(new Set());
  // Saldos reais das exchanges: Map<symbol, { exchange, buyPrice, buyQty }>
  const [activeTrades, setActiveTrades]         = useState(new Map());

  // Multitrade favorites: array de entradas com estratégia configurada
  const [multitradeFavorites, setMultitradeFavorites] = useState([]);

  // 5m Trade favorites: bot RSI 5m (five_min_bot_state)
  const [fiveMTradeFavorites, setFiveMTradeFavorites] = useState([]);

  /** View da tabela de moedas: gate | binance | macross | trades | active */
  const [favoriteView, setFavoriteView] = useState(null);

  /** Incrementado ao selecionar moeda na tabela — reseta janela do chart (ex.: após botão 10 velas) */
  const [chartCandleWindowReset, setChartCandleWindowReset] = useState(0);
  const resetChartCandleWindow = useCallback(() => {
    setChartCandleWindowReset(n => n + 1);
  }, []);

  const clearFavoriteView = useCallback(() => setFavoriteView(null), []);

  const toggleFavoriteView = useCallback((type) => {
    setFavoriteView((prev) => {
      const next = prev === type ? null : type;
      console.log('[Favoritos] favoriteView', { prev, next, type });
      return next;
    });
  }, []);

  const toggleGateFavorite = useCallback(async (symbol) => {
    const sym = symbol.toUpperCase();
    console.log('[Favoritos] Gate toggle iniciar', sym);
    setGateFavorites((prev) => {
      const next = new Set(prev);
      const removing = next.has(sym);
      if (removing) {
        next.delete(sym);
        removeFavorite(sym, 'gate')
          .then(() => console.log('[Favoritos] Gate removido OK', sym))
          .catch((err) => console.error('[Favoritos] Gate remover falhou', sym, err));
      } else {
        next.add(sym);
        addFavorite(sym, 'gate')
          .then(() => console.log('[Favoritos] Gate adicionado OK', sym))
          .catch((err) => console.error('[Favoritos] Gate adicionar falhou', sym, err));
      }
      console.log('[Favoritos] Gate toggle estado', { sym, removing, size: next.size });
      return next;
    });
  }, []);

  const toggleBinanceFavorite = useCallback(async (symbol) => {
    const sym = symbol.toUpperCase();
    console.log('[Favoritos] Binance toggle iniciar', sym);
    setBinanceFavorites((prev) => {
      const next = new Set(prev);
      const removing = next.has(sym);
      if (removing) {
        next.delete(sym);
        removeFavorite(sym, 'binance')
          .then(() => console.log('[Favoritos] Binance removido OK', sym))
          .catch((err) => console.error('[Favoritos] Binance remover falhou', sym, err));
      } else {
        next.add(sym);
        addFavorite(sym, 'binance')
          .then(() => console.log('[Favoritos] Binance adicionado OK', sym))
          .catch((err) => console.error('[Favoritos] Binance adicionar falhou', sym, err));
      }
      console.log('[Favoritos] Binance toggle estado', { sym, removing, size: next.size });
      return next;
    });
  }, []);

  const refreshActiveTrades = useCallback(async () => {
    try {
      const list = await fetchActiveTrades();
      setActiveTrades(new Map(list.map(t => [t.symbol.toUpperCase(), t])));
    } catch (err) {
      console.warn('[CurrencyContext] refreshActiveTrades:', err.message);
    }
  }, []);

  const addMultitradeEntry = useCallback(async (data) => {
    try {
      const entry = await addMultitradeFavorite(data);
      setMultitradeFavorites(prev => [...prev, entry]);
      return entry;
    } catch (err) {
      console.warn('[CurrencyContext] addMultitradeEntry:', err.message);
    }
  }, []);

  const updateMultitradeEntry = useCallback(async (id, data) => {
    try {
      const entry = await updateMultitradeFavorite(id, data);
      setMultitradeFavorites(prev => prev.map(e => e.id === id ? entry : e));
      return entry;
    } catch (err) {
      console.warn('[CurrencyContext] updateMultitradeEntry:', err.message);
    }
  }, []);

  const removeMultitradeEntry = useCallback(async (id) => {
    try {
      await removeMultitradeFavorite(id);
      setMultitradeFavorites(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.warn('[CurrencyContext] removeMultitradeEntry:', err.message);
    }
  }, []);

  const refreshMultitradeFavorites = useCallback(async () => {
    try {
      const list = await fetchMultitradeFavorites();
      setMultitradeFavorites(list.filter(isMaCrossFavoriteEntry));
      return list;
    } catch (err) {
      console.warn('[CurrencyContext] refreshMultitradeFavorites:', err.message);
      return null;
    }
  }, []);

  const updateMultitradeBotState = useCallback(async (payload) => {
    const strategyId = payload.strategyId ?? 'ma-cross';
    await patchMultitradeBotState({ ...payload, strategyId });
    const list = await refreshMultitradeFavorites();
    const sym = payload.symbol?.toUpperCase();
    return (list ?? []).find(e =>
      e.symbol?.toUpperCase() === sym
      && (e.strategyId === strategyId || e.strategyId === 'ma-cross'),
    ) ?? null;
  }, [refreshMultitradeFavorites]);

  const saveFiveMTradeEntry = useCallback(async ({ id, symbol, exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths }) => {
    try {
      if (id) {
        const entry = await updateFiveMTradeFavorite(id, { exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths });
        setFiveMTradeFavorites(prev => prev.map(e => e.id === id ? entry : e));
        return entry;
      }
      const entry = await addFiveMTradeFavorite({ symbol, exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths });
      setFiveMTradeFavorites(prev => [...prev, entry]);
      return entry;
    } catch (err) {
      console.warn('[CurrencyContext] saveFiveMTradeEntry:', err.message);
      throw err;
    }
  }, []);

  const removeFiveMTradeEntry = useCallback(async (id) => {
    try {
      await removeFiveMTradeFavorite(id);
      setFiveMTradeFavorites(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.warn('[CurrencyContext] removeFiveMTradeEntry:', err.message);
      throw err;
    }
  }, []);

  /** Salva 15m/1h de uma moeda — upsert ativos, remove desativados. */
  const saveMultitradeSymbol = useCallback(async ({ saves }) => {
    const updated = [];
    for (const s of saves ?? []) {
      if (s.remove) {
        await removeMultitradeFavorite(s.id);
      } else if (s.id) {
        const entry = await updateMultitradeFavorite(s.id, s.payload);
        updated.push(entry);
      } else {
        const entry = await addMultitradeFavorite(s.payload);
        updated.push(entry);
      }
    }
    setMultitradeFavorites(prev => {
      let next = [...prev];
      for (const s of saves ?? []) {
        if (s.remove) next = next.filter(e => e.id !== s.id);
      }
      for (const entry of updated) {
        const idx = next.findIndex(e => e.id === entry.id);
        if (idx >= 0) next[idx] = entry;
        else next.push(entry);
      }
      return next;
    });
    return updated;
  }, []);

  /** Chart MT por símbolo/favorita — intervalo da estratégia + marcadores, sem zoom em trade */
  const applyMultitradeSymbolChart = useCallback(({
    chartData, symbol, interval, exchangeSource, markers, overlaySlots, adaptiveBands,
  }) => {
    setChartViewSource(CHART_VIEW.MULTITRADE);
    setChartInterval(interval);
    setChartTradeMarkers(markers ?? []);
    setMultitradeChartFocus({
      overlaySlots: overlaySlots ?? null,
      adaptiveBands: adaptiveBands ?? null,
      symbol,
      source: exchangeSource ?? null,
    });
    setSelectedChart({
      ...chartData,
      interval,
      symbol,
      source: exchangeSource ?? null,
      tradeMarkers: markers ?? [],
    });
    setChartZoom(null);
  }, []);

  /** Atualização atômica do chart pela aba Multi-Trade (backtest row click) */
  const applyMultitradeChartView = useCallback(({
    chartData, symbol, interval, exchangeSource, markers, entryMs, exitMs,
    fetchFromMs, candleLimit, overlaySlots, adaptiveBands,
  }) => {
    setChartViewSource(CHART_VIEW.MULTITRADE);
    setChartInterval(interval);
    setChartTradeMarkers(markers);
    setMultitradeChartFocus({
      signalMs: entryMs,
      entryMs,
      exitMs,
      fetchFromMs,
      candleLimit,
      overlaySlots,
      adaptiveBands: adaptiveBands ?? null,
      symbol,
      source: exchangeSource ?? null,
    });
    setSelectedChart({
      ...chartData,
      interval,
      symbol,
      source: exchangeSource ?? null,
      tradeMarkers: markers,
    });
    setChartZoom({
      source: CHART_VIEW.MULTITRADE,
      startDate: new Date(entryMs).toISOString(),
      endDate:   new Date(exitMs).toISOString(),
    });
  }, []);

  const applyChartMaCrossOverlay = useCallback((entry, symbol) => {
    if (!entry?.symbol && !symbol) {
      setMultitradeChartFocus(prev => {
        if (!prev) return null;
        const { overlaySlots, adaptiveBands, symbol: _s, ...rest } = prev;
        return Object.keys(rest).length ? rest : null;
      });
      return;
    }
    const sym = (symbol ?? entry.symbol)?.toUpperCase();
    const strategySlots = buildOverlaySlotsForEntry(entry, null);
    setMultitradeChartFocus(prev => {
      const next = {
        ...(prev ?? {}),
        symbol: sym,
        // Não auto-exibe a banda do filtro MA ao apenas selecionar a moeda —
        // só aparece quando vier explicitamente de um clique de trade no backtest.
        adaptiveBands: null,
      };
      // MA-Cross → null: não troca MA1/MA2 do usuário (padrão 50@1h)
      if (strategySlots) next.overlaySlots = strategySlots;
      else delete next.overlaySlots;
      return next;
    });
  }, []);

  const clearMultitradeChartView = useCallback(() => {
    setChartViewSource(prev => (prev === CHART_VIEW.MULTITRADE ? CHART_VIEW.DEFAULT : prev));
    setChartTradeMarkers([]);
    setMultitradeChartFocus(null);
    setChartZoom(prev => (prev?.source === CHART_VIEW.MULTITRADE ? null : prev));
  }, []);

  /** Atualização atômica do chart pela aba 5m Trade (sinal do Supabase) */
  const applyFiveMTradeChartView = useCallback(({
    chartData, symbol, interval, exchangeSource, markers, entryMs, exitMs,
    fetchFromMs, candleLimit, overlaySlots,
  }) => {
    setChartViewSource(CHART_VIEW.FIVE_M_TRADE);
    setChartInterval(interval);
    setChartTradeMarkers(markers);
    setMultitradeChartFocus({
      signalMs: entryMs,
      entryMs,
      exitMs,
      fetchFromMs,
      candleLimit,
      overlaySlots,
      symbol,
      source: exchangeSource ?? null,
    });
    setSelectedChart({
      ...chartData,
      interval,
      symbol,
      source: exchangeSource ?? null,
      tradeMarkers: markers,
    });
    setChartZoom({
      source: CHART_VIEW.FIVE_M_TRADE,
      startDate: new Date(entryMs).toISOString(),
      endDate:   new Date(exitMs).toISOString(),
    });
  }, []);

  const clearFiveMTradeChartView = useCallback(() => {
    setChartViewSource(prev => (prev === CHART_VIEW.FIVE_M_TRADE ? CHART_VIEW.DEFAULT : prev));
    setChartTradeMarkers([]);
    setMultitradeChartFocus(null);
    setChartZoom(prev => (prev?.source === CHART_VIEW.FIVE_M_TRADE ? null : prev));
  }, []);

  const dismissActiveTrade = useCallback(async (symbol) => {
    try {
      const sym = String(symbol ?? '').toUpperCase();
      await ignoreActiveTrade(sym);
      setActiveTrades((prev) => {
        const next = new Map(prev);
        next.delete(sym);
        // Caixa (USDT/USDC/BRL…) e qualquer ASSET_GATE/_BNB — ignore remove todas as exchanges do asset
        const cash = sym.match(/^([A-Z0-9]+)_(GATE|BNB)$/);
        const asset = cash?.[1]
          ?? (sym === 'USDT' || sym === 'USDC' ? sym : null);
        if (asset) {
          for (const k of [...next.keys()]) {
            if (k === asset || k.startsWith(`${asset}_`)) next.delete(k);
          }
        }
        return next;
      });
    } catch (err) {
      console.warn('[CurrencyContext] dismissActiveTrade:', err.message);
    }
  }, []);

  const quotes = ['USDT', 'BTC', 'BNB'];

  const setAssetDisplayCategory = useCallback((key, enabled) => {
    setAssetDisplayState((prev) => {
      const next = { ...prev, [key]: enabled };
      saveAssetDisplay(next);
      return next;
    });
  }, []);

  const setChartPanelButton = useCallback((key, enabled) => {
    setChartPanelButtonsState((prev) => {
      const next = { ...prev, [key]: enabled };
      saveChartPanelButtons(next);
      return next;
    });
  }, []);

  const setDefaultChartInterval = useCallback((interval) => {
    if (!CHART_INTERVAL_OPTIONS.includes(interval)) return;
    setUiPrefsState((prev) => {
      const next = { ...prev, defaultChartInterval: interval };
      saveUiPreferences(next);
      return next;
    });
  }, []);

  const setPanelVisible = useCallback((key, enabled) => {
    if (!PANEL_KEYS.includes(key)) return;
    setUiPrefsState((prev) => {
      const next = {
        ...prev,
        visiblePanels: { ...prev.visiblePanels, [key]: enabled },
      };
      saveUiPreferences(next);
      return next;
    });
  }, []);

  const setOverlaySlotsPreference = useCallback((slots) => {
    setUiPrefsState((prev) => {
      const next = {
        ...prev,
        overlaySlots: normalizeOverlaySlots(slots),
      };
      saveUiPreferences(next);
      return next;
    });
  }, []);

  const setMaBandsDefaults = useCallback((patch) => {
    setUiPrefsState((prev) => {
      const next = {
        ...prev,
        maBandsDefaults: normalizeMaBandsDefaults({ ...prev.maBandsDefaults, ...patch }),
      };
      saveUiPreferences(next);
      return next;
    });
  }, []);

  const setBollingerBandsDefaults = useCallback((patch) => {
    setUiPrefsState((prev) => {
      const next = {
        ...prev,
        bollingerBandsDefaults: normalizeBollingerBandsDefaults({ ...prev.bollingerBandsDefaults, ...patch }),
      };
      saveUiPreferences(next);
      return next;
    });
  }, []);

  const setActiveIndicatorsPreference = useCallback((indicators) => {
    setUiPrefsState((prev) => {
      const next = { ...prev, activeIndicators: normalizeActiveIndicators(indicators) };
      saveUiPreferences(next);
      return next;
    });
  }, []);

  const isVisibleSymbol = useCallback(
    (symbol, options) => isSymbolVisible(symbol, assetDisplay, options),
    [assetDisplay],
  );

  const filterVisibleSymbols = useCallback(
    (symbols, options) => filterSymbols(symbols, assetDisplay, options),
    [assetDisplay],
  );

  const filterVisibleCurrencies = useCallback(
    (list, options) => filterCurrencies(list, assetDisplay, options),
    [assetDisplay],
  );

  const currencies = useMemo(
    () => ({
      name: rawCurrencies.name,
      list: filterCurrencies(rawCurrencies.list, assetDisplay),
    }),
    [rawCurrencies, assetDisplay],
  );

  const currencyBySymbol = useMemo(
    () => new Map(rawCurrencies.list.map((c) => [c.symbol, c])),
    [rawCurrencies.list],
  );

  const setCurrencies = setRawCurrencies;

  const addFilter = useCallback((item) => {
    setFilters((prev) => {
      const index = prev.findIndex((f) => f.name === item.name);
      if (index !== -1) {
        const next = [...prev];
        next[index] = item;
        return next;
      }
      return [...prev, item];
    });
  }, []);

  const ensureMarketHighlights = useCallback(async () => {
    setMarketHighlightsLoading(true);
    try {
      const items = await fetchMarketHighlights(HIGHLIGHT_DISPLAY_LIMIT);
      const display = assetDisplayRef.current;
      setFilters((prev) => {
        let next = [...prev];
        for (const raw of items) {
          const withCandidates = {
            ...raw,
            meta: {
              ...(raw.meta || {}),
              candidates: Array.isArray(raw.meta?.candidates)
                ? [...raw.meta.candidates]
                : (Array.isArray(raw.list) ? [...raw.list] : []),
            },
          };
          const item = applyAssetDisplayToHighlight(withCandidates, display);
          const index = next.findIndex((f) => f.name === item.name);
          if (index !== -1) {
            next = [...next];
            next[index] = item;
          } else {
            next = [...next, item];
          }
        }
        return next;
      });
      return items;
    } finally {
      setMarketHighlightsLoading(false);
    }
  }, []);

  // Recorta Alta/Novas quando o usuário liga/desliga categorias em Exibição de ativos
  useEffect(() => {
    setFilters((prev) => {
      let changed = false;
      const next = prev.map((f) => {
        if (!isAutoHighlightFilter(f.name)) return f;
        const pruned = applyAssetDisplayToHighlight(f, assetDisplay);
        if (
          pruned.list.length !== f.list.length
          || pruned.list.some((s, i) => s !== f.list[i])
        ) {
          changed = true;
          return pruned;
        }
        return f;
      });
      return changed ? next : prev;
    });
  }, [assetDisplay]);

  const removeFilters = useCallback((filtersToRemove) => {
    setFilters((prev) => {
      const first = prev[0];
      const kept = prev.filter((f) => f && !filtersToRemove.includes(f.name));
      if (!first) return kept;
      return [first, ...kept.filter((f) => f.name !== first.name)];
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters((prev) => prev.filter((f) => f.name === 'Mercado|USDT' || isAutoHighlightFilter(f.name)));
  }, []);

  const joinFilters = useCallback((selectedFilterNames) => {
    setFilters((prev) => {
      const name = selectedFilterNames.join('|');
      const chosen = prev.filter((f) => selectedFilterNames.includes(f.name));

      if (chosen.length === 0) return prev;

      let common = chosen[0].list;
      for (let i = 1; i < chosen.length; i++) {
        common = common.filter((sym) => chosen[i].list.includes(sym));
      }

      const newFilter = { name, list: common };
      const index = prev.findIndex((f) => f.name === name);
      if (index !== -1) {
        const next = [...prev];
        next[index] = newFilter;
        return next;
      }
      return [...prev, newFilter];
    });
  }, []);

  // Sincroniza favoritos Gate + Binance como filtros (um único setFilters)
  useEffect(() => {
    setFilters((prev) => {
      const first = prev[0];
      const kept = prev.filter((f) => (
        f.name !== 'Favoritos|Binance' && f.name !== 'Favoritos|Gate'
      ));
      const next = [...kept];
      if (binanceFavorites.size > 0) {
        next.push({ name: 'Favoritos|Binance', list: Array.from(binanceFavorites) });
      }
      if (gateFavorites.size > 0) {
        next.push({ name: 'Favoritos|Gate', list: Array.from(gateFavorites) });
      }
      if (!first) return next;
      const withoutMarket = next.filter((f) => f.name !== first.name);
      return [first, ...withoutMarket];
    });
  }, [binanceFavorites, gateFavorites]);

  useEffect(() => {
    if (activeTrades.size > 0) {
      addFilter({ name: 'Favoritos|Ativos', list: Array.from(activeTrades.keys()) });
    } else {
      removeFilters(['Favoritos|Ativos']);
    }
  }, [activeTrades, addFilter, removeFilters]);

  useEffect(() => {
    const symbols = [...new Set(
      multitradeFavorites.filter(e => e.enabled !== false && (e.strategyId === 'ma-cross' || e.kind === 'ma_cross')).map(e => e.symbol),
    )];
    if (symbols.length > 0) addFilter({ name: 'Favoritos|MA-Cross', list: symbols });
    else removeFilters(['Favoritos|MA-Cross', 'Favoritos|MultiTrade']);
  }, [multitradeFavorites, addFilter, removeFilters]);

  useEffect(() => {
    if (!rawCurrencies.list.length) return undefined;
    ensureMarketHighlights().catch((err) => {
      console.warn('[CurrencyContext] market-highlights:', err.message);
    });
  }, [rawCurrencies.list.length, ensureMarketHighlights]);

  // Carrega favoritos MA-Cross e sincroniza fase (BOUGHT/WATCHING) com o bot
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await fetchMultitradeFavorites();
        if (!cancelled) setMultitradeFavorites(list.filter(isMaCrossFavoriteEntry));
      } catch (err) {
        if (!cancelled) console.warn('[CurrencyContext] loadMultitradeFavorites:', err.message);
      }
    };
    load();
    const id = setInterval(load, MULTITRADE_STATE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const getBinanceCurrenciesWithUsdt = useCallback(
    (currenciesObj) => {
      if (!filters[0]) return [];
      const binanceList = filters[0].list;
      return filterCurrencies(
        currenciesObj.list.filter((c) => binanceList.includes(c.symbol)),
        assetDisplay,
      );
    },
    [filters, assetDisplay],
  );

  const findFilter = useCallback(
    (name) => filters.find((f) => f.name === name),
    [filters],
  );

  return (
    <CurrencyContext.Provider
      value={{
        currencies,
        setCurrencies,
        currencyBySymbol,
        filters,
        setFilters,
        addFilter,
        removeFilters,
        clearAllFilters,
        joinFilters,
        ensureMarketHighlights,
        marketHighlightsLoading,
        getBinanceCurrenciesWithUsdt,
        assetDisplay,
        setAssetDisplayCategory,
        chartPanelButtons,
        setChartPanelButton,
        chartPanelButtonKeys: CHART_PANEL_BUTTON_KEYS,
        uiPrefs,
        setDefaultChartInterval,
        setPanelVisible,
        setOverlaySlotsPreference,
        setMaBandsDefaults,
        setBollingerBandsDefaults,
        setActiveIndicatorsPreference,
        chartIntervalOptions: CHART_INTERVAL_OPTIONS,
        panelKeys: PANEL_KEYS,
        isVisibleSymbol,
        filterVisibleSymbols,
        filterVisibleCurrencies,
        assetCategoryKeys: ASSET_CATEGORY_KEYS,
        findFilter,
        quotes,
        selectedQuote,
        setSelectedQuote,
        selectedChart,
        setSelectedChart,
        chartInterval,
        setChartInterval,
        chartZoom,
        setChartZoom,
        chartCandleWindowReset,
        resetChartCandleWindow,
        chartViewSource,
        setChartViewSource,
        applyMultitradeChartView,
        applyMultitradeSymbolChart,
        applyChartMaCrossOverlay,
        clearMultitradeChartView,
        applyFiveMTradeChartView,
        clearFiveMTradeChartView,
        multitradeChartFocus,
        chartTradeMarkers,
        setChartTradeMarkers,
        tradePurchases,
        setTradePurchases,
        allTrades,
        setAllTrades,
        gateFavorites,
        setGateFavorites,
        binanceFavorites,
        setBinanceFavorites,
        toggleGateFavorite,
        toggleBinanceFavorite,
        activeTrades,
        setActiveTrades,
        refreshActiveTrades,
        dismissActiveTrade,
        multitradeFavorites,
        setMultitradeFavorites,
        addMultitradeEntry,
        updateMultitradeEntry,
        removeMultitradeEntry,
        saveMultitradeSymbol,
        updateMultitradeBotState,
        fiveMTradeFavorites,
        setFiveMTradeFavorites,
        favoriteView,
        setFavoriteView,
        clearFavoriteView,
        toggleFavoriteView,
        saveFiveMTradeEntry,
        removeFiveMTradeEntry,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency deve ser usado dentro de CurrencyProvider');
  return ctx;
}
