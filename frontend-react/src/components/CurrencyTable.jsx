import { useMemo, useState, useCallback } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud } from '../services/api';

const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#fcd535';

function formatVolume(vol) {
  if (vol == null || isNaN(vol) || vol <= 0) return '—';
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`;
  return vol.toFixed(0);
}

// Remove a quote do final do símbolo: "BTCUSDT" → "BTC", "BNBUSDT" → "BNB"
function splitSymbol(symbol) {
  if (symbol.endsWith('USDT')) return { base: symbol.slice(0, -4), quote: 'USDT' };
  if (symbol.endsWith('BTC'))  return { base: symbol.slice(0, -3),  quote: 'BTC' };
  if (symbol.endsWith('BNB'))  return { base: symbol.slice(0, -3),  quote: 'BNB' };
  return { base: symbol, quote: '' };
}

// 'gate' | 'binance' | null
function FavButton({ active, color, label, onClick }) {
  return (
    <button
      onClick={onClick}
      title={`${active ? 'Remover de' : 'Adicionar a'} favoritos ${label}`}
      className="flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold transition-all hover:scale-110"
      style={{
        background: active ? color : 'transparent',
        color: active ? '#fff' : color,
        border: `1px solid ${color}`,
        opacity: active ? 1 : 0.45,
      }}
    >
      {label[0]}
    </button>
  );
}

export default function CurrencyTable({ activeFilter, showFavorites, setShowFavorites, onSelectCurrency }) {
  const {
    currencies, findFilter, selectedQuote, setSelectedChart,
    gateFavorites, binanceFavorites, toggleGateFavorite, toggleBinanceFavorite,
  } = useCurrency();
  const [loadingSymbol, setLoadingSymbol] = useState(null);
  const [activeRow, setActiveRow]         = useState(null);
  const [search, setSearch]               = useState('');
  const [sortVolume, setSortVolume]       = useState('desc'); // 'desc' | 'asc' | null

  const cycleSort = useCallback(() => {
    setSortVolume((v) => v === 'desc' ? 'asc' : v === 'asc' ? null : 'desc');
  }, []);

  const rows = useMemo(() => {
    if (!currencies.list?.length) return [];

    let list;

    if (showFavorites === 'gate') {
      list = currencies.list.filter((c) => gateFavorites.has(c.symbol));
    } else if (showFavorites === 'binance') {
      list = currencies.list.filter((c) => binanceFavorites.has(c.symbol));
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

    if (search.trim()) {
      const term = search.trim().toUpperCase();
      list = list.filter((c) => c.symbol.includes(term));
    }

    if (sortVolume === 'desc') list = [...list].sort((a, b) => (b.volume || 0) - (a.volume || 0));
    if (sortVolume === 'asc')  list = [...list].sort((a, b) => (a.volume || 0) - (b.volume || 0));

    return list;
  }, [currencies, activeFilter, selectedQuote, findFilter, search, showFavorites, gateFavorites, binanceFavorites, sortVolume]);

  const interval = (activeFilter && activeFilter !== 'favoritos') ? activeFilter.split('|')[0] : '30m';

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

  function toggleShowFavorites(type) {
    setShowFavorites((prev) => prev === type ? null : type);
    setSearch('');
  }

  const gateCount    = gateFavorites.size;
  const binanceCount = binanceFavorites.size;

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

      {/* Cabeçalho contador + filtros de favoritos */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-p2 shrink-0">
        <span className="text-xs text-p5 opacity-50 uppercase tracking-wider">Moedas</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-p4">{rows.length}</span>

          {/* Filtro Gate */}
          <button
            onClick={() => toggleShowFavorites('gate')}
            title={showFavorites === 'gate' ? 'Ver todas as moedas' : `Favoritos Gate (${gateCount})`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
            style={{ opacity: showFavorites === 'gate' ? 1 : 0.5 }}
          >
            <span
              className="text-[10px] font-bold px-1 py-0.5 rounded"
              style={{
                background: showFavorites === 'gate' ? GATE_COLOR : 'transparent',
                color: showFavorites === 'gate' ? '#fff' : GATE_COLOR,
                border: `1px solid ${GATE_COLOR}`,
              }}
            >
              G{gateCount > 0 ? ` ${gateCount}` : ''}
            </span>
          </button>

          {/* Filtro Binance */}
          <button
            onClick={() => toggleShowFavorites('binance')}
            title={showFavorites === 'binance' ? 'Ver todas as moedas' : `Favoritos Binance (${binanceCount})`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
            style={{ opacity: showFavorites === 'binance' ? 1 : 0.5 }}
          >
            <span
              className="text-[10px] font-bold px-1 py-0.5 rounded"
              style={{
                background: showFavorites === 'binance' ? BINANCE_COLOR : 'transparent',
                color: showFavorites === 'binance' ? '#000' : BINANCE_COLOR,
                border: `1px solid ${BINANCE_COLOR}`,
              }}
            >
              B{binanceCount > 0 ? ` ${binanceCount}` : ''}
            </span>
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-p1">
            <tr className="border-b border-p2">
              <th className="w-12" />
              <th className="text-left px-2 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Par</th>
              <th className="text-right px-2 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider">Preço</th>
              <th
                className="text-right px-2 py-1.5 text-p5 opacity-50 font-normal uppercase tracking-wider cursor-pointer hover:opacity-90 select-none whitespace-nowrap"
                onClick={cycleSort}
                title="Ordenar por volume 24h"
              >
                Vol{sortVolume === 'desc' ? ' ↓' : sortVolume === 'asc' ? ' ↑' : ''}
              </th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const { base, quote } = splitSymbol(item.symbol);
              const isGate    = gateFavorites.has(item.symbol);
              const isBinance = binanceFavorites.has(item.symbol);
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
                  <td className="pl-2">
                    <div className="flex items-center gap-1">
                      <FavButton
                        active={isGate}
                        color={GATE_COLOR}
                        label="Gate"
                        onClick={(e) => { e.stopPropagation(); toggleGateFavorite(item.symbol); }}
                      />
                      <FavButton
                        active={isBinance}
                        color={BINANCE_COLOR}
                        label="Binance"
                        onClick={(e) => { e.stopPropagation(); toggleBinanceFavorite(item.symbol); }}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold">
                    {base}
                    <span className="opacity-40 font-normal text-[10px]">/{quote}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{item.price}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] opacity-60">{formatVolume(item.volume)}</td>
                  <td className="pr-1 text-center">
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
