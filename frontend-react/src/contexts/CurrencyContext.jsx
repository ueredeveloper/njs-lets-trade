import { createContext, useContext, useState, useCallback } from 'react';
import { addFavorite, removeFavorite } from '../services/api';

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

  // Zoom do gráfico para um período específico: { startDate, endDate } ISO strings
  const [chartZoom, setChartZoom] = useState(null);

  // Quote selecionada: 'USDT' | 'BTC' | 'BNB'
  const [selectedQuote, setSelectedQuote] = useState('USDT');

  // Favoritos Gate (azul #0068ff), Binance (amarelo #fcd535) e Trade Now (verde #00c076)
  const [gateFavorites, setGateFavorites]       = useState(new Set());
  const [binanceFavorites, setBinanceFavorites] = useState(new Set());
  const [tradeFavorites, setTradeFavorites]     = useState(new Set());

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

  const toggleTradeFavorite = useCallback(async (symbol) => {
    const sym = symbol.toUpperCase();
    setTradeFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) { next.delete(sym); removeFavorite(sym, 'trade').catch(() => {}); }
      else               { next.add(sym);    addFavorite(sym, 'trade').catch(() => {}); }
      return next;
    });
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
      const kept = prev.filter((f) => !filtersToRemove.includes(f.name));
      const merged = [first, ...kept.filter((f) => f.name !== first?.name)];
      return merged;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters((prev) => prev.filter((f) => f.name === '1h|Mercado|USDT'));
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
        chartZoom,
        setChartZoom,
        gateFavorites,
        setGateFavorites,
        binanceFavorites,
        setBinanceFavorites,
        tradeFavorites,
        setTradeFavorites,
        toggleGateFavorite,
        toggleBinanceFavorite,
        toggleTradeFavorite,
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
