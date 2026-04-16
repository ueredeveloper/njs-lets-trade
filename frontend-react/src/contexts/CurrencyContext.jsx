import { createContext, useContext, useState, useCallback } from 'react';

// Stablecoins que não queremos capturar
const STABLE_CURRENCIES = new Set([
  'TUSDUSDT', 'USDPUSDT', 'FDUSDUSDT', 'EURIUSDT', 'XUSDUSDT',
  'USDCUSDT', 'EURUSDT', 'USDEUSDT', 'USD1USDT', 'BFUSDUSDT',
  'NEXOUSDT', 'FXSUSDT', 'AEURUSDT', 'PAXGUSDT',
]);

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  // { name: '1h|All', list: [{symbol, price, ...}] }
  const [currencies, setCurrencies] = useState({ name: '1h|All', list: [] });

  // [{ name: '1h|Binance|USDT', list: ['BTCUSDT', ...] }, ...]
  const [filters, setFilters] = useState([]);

  // Moeda selecionada para o gráfico: { symbol, candles, ichimoku }
  const [selectedChart, setSelectedChart] = useState(null);

  // Quote selecionada: 'USDT' | 'BTC' | 'BNB'
  const [selectedQuote, setSelectedQuote] = useState('USDT');

  const quotes = ['USDT', 'BTC', 'BNB'];

  // --- Métodos equivalentes ao CurrencyModel ---

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
      // garante que o primeiro sempre está presente, sem repetições
      const merged = [first, ...kept.filter((f) => f.name !== first?.name)];
      return merged;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters((prev) => prev.filter((f) => f.name === '1h|Binance|USDT'));
  }, []);

  const joinFilters = useCallback((selectedFilterNames) => {
    setFilters((prev) => {
      const name = selectedFilterNames.join('|');
      const chosen = prev.filter((f) => selectedFilterNames.includes(f.name));

      if (chosen.length === 0) return prev;

      // intersecção: começa da primeira lista e filtra pelas demais
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
