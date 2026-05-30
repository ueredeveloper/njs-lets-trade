import { useMemo, useState } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud } from '../services/api';

// Remove a quote do final do símbolo: "BTCUSDT" → "BTC", "BNBUSDT" → "BNB"
function splitSymbol(symbol) {
  if (symbol.endsWith('USDT')) return { base: symbol.slice(0, -4), quote: 'USDT' };
  if (symbol.endsWith('BTC'))  return { base: symbol.slice(0, -3),  quote: 'BTC' };
  if (symbol.endsWith('BNB'))  return { base: symbol.slice(0, -3),  quote: 'BNB' };
  return { base: symbol, quote: '' };
}

export default function CurrencyTable({ activeFilter }) {
  const { currencies, findFilter, selectedQuote, setSelectedChart } = useCurrency();
  const [loadingSymbol, setLoadingSymbol] = useState(null);
  const [activeRow, setActiveRow] = useState(null);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    if (!currencies.list?.length) return [];

    let list;

    if (activeFilter) {
      const filter = findFilter(activeFilter);
      if (filter) {
        list = filter.list
          .map((sym) => currencies.list.find((c) => c.symbol === sym))
          .filter(Boolean);
      }
    }

    if (!list) {
      list = currencies.list.filter((c) => c.symbol.endsWith(selectedQuote));
    }

    // Aplica filtro de busca
    if (search.trim()) {
      const term = search.trim().toUpperCase();
      list = list.filter((c) => c.symbol.includes(term));
    }

    return list;
  }, [currencies, activeFilter, selectedQuote, findFilter, search]);

  const interval = activeFilter ? activeFilter.split('|')[0] : '1h';

  async function handleSelect(item) {
    setLoadingSymbol(item.symbol);
    setActiveRow(item.symbol);
    try {
      const data = await fetchCandlesticksAndCloud(item.symbol, interval);
      setSelectedChart(data);
    } finally {
      setLoadingSymbol(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barra de busca */}
      <div className="px-2 py-1 shrink-0">
        <div className="flex items-center gap-1.5 bg-p2/50 border border-p3/30 rounded px-2 py-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 text-p5 opacity-40 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar moeda..."
            className="flex-1 bg-transparent text-p5 text-xs outline-none placeholder-p5/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-p5 opacity-40 hover:opacity-80">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Cabeçalho contador */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-p2 shrink-0">
        <span className="text-xs text-p5 opacity-50 uppercase tracking-wider">Moedas</span>
        <span className="text-xs font-mono text-p4">{rows.length}</span>
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-p1">
            <tr className="border-b border-p2">
              <th className="text-left px-3 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Par</th>
              <th className="text-right px-3 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Preço</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const { base, quote } = splitSymbol(item.symbol);
              return (
                <tr
                  key={item.symbol}
                  onClick={() => handleSelect(item)}
                  className={`border-b border-p2/30 cursor-pointer transition-colors ${
                    activeRow === item.symbol
                      ? 'bg-p2/80 text-white'
                      : 'hover:bg-p2/40 text-p5'
                  }`}
                >
                  <td className="px-3 py-1.5 font-mono font-semibold">
                    {base}
                    <span className="opacity-40 font-normal text-[10px]">/{quote}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{item.price}</td>
                  <td className="pr-2 text-center">
                    {loadingSymbol === item.symbol ? (
                      <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin mx-auto" />
                    ) : activeRow === item.symbol ? (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                        strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 mx-auto text-p4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
