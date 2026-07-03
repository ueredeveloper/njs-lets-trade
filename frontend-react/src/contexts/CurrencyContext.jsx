import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { addFavorite, addTradeFavorite, removeFavorite, fetchActiveTrades, ignoreActiveTrade,
  fetchMultitradeFavorites, addMultitradeFavorite, updateMultitradeFavorite, removeMultitradeFavorite,
  fetchFiveMTradeFavorites, addFiveMTradeFavorite, updateFiveMTradeFavorite, removeFiveMTradeFavorite } from '../services/api';
import { CHART_VIEW } from '../utils/chartView';
import {
  ASSET_CATEGORY_KEYS,
  filterCurrencies,
  filterSymbols,
  isSymbolVisible,
  loadAssetDisplay,
  saveAssetDisplay,
} from '../utils/assetCategories';

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  // Lista completa do servidor; currencies expõe versão filtrada por categoria
  const [rawCurrencies, setRawCurrencies] = useState({ name: '1h|All', list: [] });
  const [assetDisplay, setAssetDisplayState] = useState(() => loadAssetDisplay());

  // [{ name: '1h|Binance|USDT', list: ['BTCUSDT', ...] }, ...]
  const [filters, setFilters] = useState([]);

  // Moeda selecionada para o gráfico: { symbol, candles, ichimoku }
  const [selectedChart, setSelectedChart] = useState(null);

  // Intervalo ativo no gráfico — fonte de verdade compartilhada entre chart e tabela
  const [chartInterval, setChartInterval] = useState('30m');

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

  // Favoritos Gate (azul #0068ff), Binance (amarelo #fcd535) e Trade Now (verde #00c076)
  const [gateFavorites, setGateFavorites]       = useState(new Set());
  const [binanceFavorites, setBinanceFavorites] = useState(new Set());
  const [tradeFavorites, setTradeFavorites]     = useState(new Set());
  // Config por símbolo: Map<symbol, { interval, rsiBuy, rsiSell, sellInterval }>
  const [tradeConfigs, setTradeConfigs]         = useState(new Map());
  // Saldos reais das exchanges: Map<symbol, { exchange, buyPrice, buyQty }>
  const [activeTrades, setActiveTrades]         = useState(new Map());

  // Multitrade favorites: array de entradas com estratégia configurada
  const [multitradeFavorites, setMultitradeFavorites] = useState([]);

  // 5m Trade favorites: bot RSI 5m (five_min_bot_state)
  const [fiveMTradeFavorites, setFiveMTradeFavorites] = useState([]);

  const toggleGateFavorite = useCallback(async (symbol) => {
    const sym = symbol.toUpperCase();
    setGateFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) { next.delete(sym); removeFavorite(sym, 'gate').catch(() => {}); }
      else               { next.add(sym);    addFavorite(sym, 'gate').catch(() => {}); }
      return next;
    });
  }, []);

  const toggleBinanceFavorite = useCallback(async (symbol) => {
    const sym = symbol.toUpperCase();
    setBinanceFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) { next.delete(sym); removeFavorite(sym, 'binance').catch(() => {}); }
      else               { next.add(sym);    addFavorite(sym, 'binance').catch(() => {}); }
      return next;
    });
  }, []);

  const toggleTradeFavorite = useCallback((symbol, config = null) => {
    const sym = symbol.toUpperCase();
    setTradeFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) {
        next.delete(sym);
        setTradeConfigs(m => { const n = new Map(m); n.delete(sym); return n; });
        removeFavorite(sym, 'trade').catch((err) => console.warn('[CurrencyContext] removeTradeFavorite:', err.message));
      } else {
        next.add(sym);
        const cfg = config || { exchange: 'gate', interval: '30m', rsiBuy: 30, rsiSell: 70, sellInterval: null };
        setTradeConfigs(m => { const n = new Map(m); n.set(sym, cfg); return n; });
        addTradeFavorite(sym, cfg).catch((err) => console.warn('[CurrencyContext] addTradeFavorite:', err.message));
      }
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
    chartData, symbol, interval, exchangeSource, markers, overlaySlots,
  }) => {
    setChartViewSource(CHART_VIEW.MULTITRADE);
    setChartInterval(interval);
    setChartTradeMarkers(markers ?? []);
    setMultitradeChartFocus({
      overlaySlots: overlaySlots ?? null,
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
    fetchFromMs, candleLimit, overlaySlots,
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
      await ignoreActiveTrade(symbol);
      setActiveTrades(prev => { const next = new Map(prev); next.delete(symbol.toUpperCase()); return next; });
    } catch (err) {
      console.warn('[CurrencyContext] dismissActiveTrade:', err.message);
    }
  }, []);

  const updateTradeConfig = useCallback((symbol, config) => {
    const sym = symbol.toUpperCase();
    setTradeConfigs(prev => { const next = new Map(prev); next.set(sym, config); return next; });
    addTradeFavorite(sym, config).catch(() => {});
  }, []);

  const quotes = ['USDT', 'BTC', 'BNB'];

  const setAssetDisplayCategory = useCallback((key, enabled) => {
    setAssetDisplayState((prev) => {
      const next = { ...prev, [key]: enabled };
      saveAssetDisplay(next);
      return next;
    });
  }, []);

  const isVisibleSymbol = useCallback(
    (symbol) => isSymbolVisible(symbol, assetDisplay),
    [assetDisplay],
  );

  const filterVisibleSymbols = useCallback(
    (symbols) => filterSymbols(symbols, assetDisplay),
    [assetDisplay],
  );

  const filterVisibleCurrencies = useCallback(
    (list) => filterCurrencies(list, assetDisplay),
    [assetDisplay],
  );

  const currencies = useMemo(
    () => ({
      name: rawCurrencies.name,
      list: filterCurrencies(rawCurrencies.list, assetDisplay),
    }),
    [rawCurrencies, assetDisplay],
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

  const removeFilters = useCallback((filtersToRemove) => {
    setFilters((prev) => {
      const first = prev[0];
      const kept = prev.filter((f) => f && !filtersToRemove.includes(f.name));
      if (!first) return kept;
      return [first, ...kept.filter((f) => f.name !== first.name)];
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters((prev) => prev.filter((f) => f.name === 'Mercado|USDT'));
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

  // Sincroniza cada lista de favoritos como filtro, permitindo intersecções no FilterTabs
  useEffect(() => {
    if (binanceFavorites.size > 0) addFilter({ name: 'Favoritos|Binance', list: Array.from(binanceFavorites) });
    else removeFilters(['Favoritos|Binance']);
  }, [binanceFavorites, addFilter, removeFilters]);

  useEffect(() => {
    if (gateFavorites.size > 0) addFilter({ name: 'Favoritos|Gate', list: Array.from(gateFavorites) });
    else removeFilters(['Favoritos|Gate']);
  }, [gateFavorites, addFilter, removeFilters]);

  useEffect(() => {
    if (tradeFavorites.size > 0) addFilter({ name: 'Favoritos|Trade', list: Array.from(tradeFavorites) });
    else removeFilters(['Favoritos|Trade']);
  }, [tradeFavorites, addFilter, removeFilters]);

  useEffect(() => {
    if (activeTrades.size > 0) addFilter({ name: 'Favoritos|Ativos', list: Array.from(activeTrades.keys()) });
    else removeFilters(['Favoritos|Ativos']);
  }, [activeTrades, addFilter, removeFilters]);

  useEffect(() => {
    const symbols = [...new Set(multitradeFavorites.filter(e => e.enabled !== false).map(e => e.symbol))];
    if (symbols.length > 0) addFilter({ name: 'Favoritos|MultiTrade', list: symbols });
    else removeFilters(['Favoritos|MultiTrade']);
  }, [multitradeFavorites, addFilter, removeFilters]);

  useEffect(() => {
    const symbols = fiveMTradeFavorites.map(e => e.symbol);
    if (symbols.length > 0) addFilter({ name: 'Favoritos|5mTrade', list: symbols });
    else removeFilters(['Favoritos|5mTrade']);
  }, [fiveMTradeFavorites, addFilter, removeFilters]);

  // Carrega multitrade favorites na inicialização
  useEffect(() => {
    fetchMultitradeFavorites()
      .then(list => setMultitradeFavorites(list))
      .catch(err => console.warn('[CurrencyContext] loadMultitradeFavorites:', err.message));
  }, []);

  useEffect(() => {
    fetchFiveMTradeFavorites()
      .then(list => setFiveMTradeFavorites(list))
      .catch(err => console.warn('[CurrencyContext] loadFiveMTradeFavorites:', err.message));
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
        filters,
        setFilters,
        addFilter,
        removeFilters,
        clearAllFilters,
        joinFilters,
        getBinanceCurrenciesWithUsdt,
        assetDisplay,
        setAssetDisplayCategory,
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
        chartViewSource,
        setChartViewSource,
        applyMultitradeChartView,
        applyMultitradeSymbolChart,
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
        tradeFavorites,
        setTradeFavorites,
        tradeConfigs,
        setTradeConfigs,
        toggleGateFavorite,
        toggleBinanceFavorite,
        toggleTradeFavorite,
        updateTradeConfig,
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
        fiveMTradeFavorites,
        setFiveMTradeFavorites,
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
