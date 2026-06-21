import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { addFavorite, addTradeFavorite, removeFavorite, fetchActiveTrades, ignoreActiveTrade,
  fetchMultitradeFavorites, addMultitradeFavorite, updateMultitradeFavorite, removeMultitradeFavorite } from '../services/api';
import { CHART_VIEW } from '../utils/chartView';

// Stablecoins que não queremos capturar
const STABLE_CURRENCIES = new Set([
  'TUSDUSDT', 'USDPUSDT', 'FDUSDUSDT', 'EURIUSDT', 'XUSDUSDT',
  'USDCUSDT', 'EURUSDT', 'USDEUSDT', 'USD1USDT', 'BFUSDUSDT',
  'NEXOUSDT', 'FXSUSDT', 'AEURUSDT', 'PAXGUSDT',
  // stablecoins adicionais detectadas em produção
  'WUSDTUSDT', 'DAIUSDT', 'FRAXUSDT', 'LUSDUSDT', 'USDDUSDT',
  'BUSDUSDT', 'SUSDUSDT', 'GUSDUSDT', 'OUSDUSDT', 'CRVUSDUSDT',
  'DOLAUSDT', 'STUSDUSDT', 'EURTUSDT', 'EURSUSDT', 'EURCUSDT',
  'XAUTUSDT', 'GYENUSDT', 'BIDRBUSD', 'BIDRETH',
]);

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  // { name: '1h|All', list: [{symbol, price, ...}] }
  const [currencies, setCurrencies] = useState({ name: '1h|All', list: [] });

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

  /** Atualização atômica do chart pela aba Multi-Trade (backtest row click) */
  const applyMultitradeChartView = useCallback(({
    chartData, symbol, interval, exchangeSource, markers, entryMs, exitMs,
  }) => {
    setChartViewSource(CHART_VIEW.MULTITRADE);
    setChartInterval(interval);
    setChartTradeMarkers(markers);
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
    setChartZoom(prev => (prev?.source === CHART_VIEW.MULTITRADE ? null : prev));
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
    const symbols = multitradeFavorites.map(e => e.symbol);
    if (symbols.length > 0) addFilter({ name: 'Favoritos|MultiTrade', list: symbols });
    else removeFilters(['Favoritos|MultiTrade']);
  }, [multitradeFavorites, addFilter, removeFilters]);

  // Carrega multitrade favorites na inicialização
  useEffect(() => {
    fetchMultitradeFavorites()
      .then(list => setMultitradeFavorites(list))
      .catch(err => console.warn('[CurrencyContext] loadMultitradeFavorites:', err.message));
  }, []);

  const getBinanceCurrenciesWithUsdt = useCallback(
    (currenciesObj) => {
      if (!filters[0]) return [];
      const binanceList = filters[0].list;
      return currenciesObj.list.filter(
        (c) => binanceList.includes(c.symbol) && !STABLE_CURRENCIES.has(c.symbol),
      );
    },
    [filters],
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
        clearMultitradeChartView,
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
