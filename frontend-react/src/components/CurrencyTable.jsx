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

export default function CurrencyTable({ activeFilter, showFavorites, setShowFavorites, onSelectCurrency }) {
  const { currencies, findFilter, selectedQuote, setSelectedChart, favorites, toggleFavorite } = useCurrency();
  const [loadingSymbol, setLoadingSymbol] = useState(null);
  const [activeRow, setActiveRow] = useState(null);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    if (!currencies.list?.length) return [];

    let list;

    if (showFavorites) {
      list = currencies.list.filter((c) => favorites.has(c.symbol));
    } else if (activeFilter === 'favoritos') {
      list = currencies.list.filter((c) => favorites.has(c.symbol));
    } else if (activeFilter) {
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
  }, [currencies, activeFilter, selectedQuote, findFilter, search, showFavorites, favorites]);

  const interval = (activeFilter && activeFilter !== 'favoritos') ? activeFilter.split('|')[0] : '1h';

  async function handleSelect(item) {
    onSelectCurrency?.();
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
            strokeWidth="2" stroke="currentColor" className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-p5 opacity-40 shrink-0">
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
            <button onClick={() => setSearch('')} className="text-p5 opacity-50 hover:opacity-90 w-7 h-7 flex items-center justify-center rounded-full hover:bg-p3/30 text-xl leading-none transition-colors">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Cabeçalho contador */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-p2 shrink-0">
        <span className="text-xs text-p5 opacity-50 uppercase tracking-wider">Moedas</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-p4">{rows.length}</span>
          {favorites.size > 0 && (
            <button
              onClick={() => setShowFavorites((v) => !v)}
              title={showFavorites ? 'Ver todas as moedas' : `Ver ${favorites.size} favorita${favorites.size > 1 ? 's' : ''}`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                fill={showFavorites ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth="1.5"
                className={`w-5 h-5 sm:w-3.5 sm:h-3.5 transition-colors ${showFavorites ? 'text-yellow-400' : 'text-p5/40 hover:text-yellow-400'}`}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
              </svg>
              {showFavorites && (
                <span className="text-[10px] text-yellow-400">{favorites.size}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-p1">
            <tr className="border-b border-p2">
              <th className="w-6" />
              <th className="text-left px-2 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Par</th>
              <th className="text-right px-3 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Preço</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const { base, quote } = splitSymbol(item.symbol);
              const isFav = favorites.has(item.symbol);
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
                  <td className="pl-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(item.symbol); }}
                      className="p-0.5 rounded hover:scale-110 transition-transform"
                      title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill={isFav ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className={`w-5 h-5 sm:w-3.5 sm:h-3.5 ${isFav ? 'text-yellow-400' : 'text-p5/30 hover:text-yellow-400/60'}`}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold">
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
