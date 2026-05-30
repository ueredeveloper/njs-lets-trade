import { useState, useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { sortByTypeOfIntervals, sortFirstIncludesBinance } from '../utils/sort-firts-includes-binance';

const INTERVAL_COLORS = {
  '1h':  '#8A8AFF',
  '2h':  '#7FDBFF',
  '4h':  '#39CCCC',
  '6h':  '#2ECC40',
  '8h':  '#01FF70',
  '12h': '#FFDC00',
  '1d':  '#FF851B',
  '3d':  '#FF4136',
  '1w':  '#B10DC9',
};

function getIntervalColor(name) {
  const prefix = name.trim().toLowerCase();
  for (const [key, color] of Object.entries(INTERVAL_COLORS)) {
    if (prefix.startsWith(key)) return color;
  }
  return '#157a8c';
}

// Ícone funil
function IconFunnel({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 4.6C3 4.04 3 3.76 3.109 3.546C3.205 3.358 3.358 3.205 3.546 3.109C3.76 3 4.04 3 4.6 3H19.4C19.96 3 20.24 3 20.454 3.109C20.642 3.205 20.795 3.358 20.891 3.546C21 3.76 21 4.04 21 4.6V6.337C21 6.582 21 6.704 20.972 6.819C20.948 6.921 20.908 7.019 20.853 7.108C20.791 7.209 20.704 7.296 20.531 7.469L14.469 13.531C14.296 13.704 14.209 13.791 14.147 13.892C14.093 13.981 14.052 14.079 14.028 14.181C14 14.296 14 14.418 14 14.663V17L10 21V14.663C10 14.418 10 14.296 9.972 14.181C9.948 14.079 9.907 13.981 9.853 13.892C9.791 13.791 9.704 13.704 9.531 13.531L3.469 7.469C3.296 7.296 3.209 7.209 3.147 7.108C3.093 7.019 3.052 6.921 3.028 6.819C3 6.704 3 6.582 3 6.337V4.6Z"/>
    </svg>
  );
}

function IconFunnelX({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 15L21 21M21 15L15 21M10 21V14.663C10 14.418 10 14.296 9.972 14.181C9.948 14.079 9.907 13.981 9.853 13.892C9.791 13.791 9.704 13.704 9.531 13.531L3.469 7.469C3.296 7.296 3.209 7.209 3.147 7.108C3.093 7.019 3.052 6.921 3.028 6.819C3 6.704 3 6.582 3 6.337V4.6C3 4.04 3 3.76 3.109 3.546C3.205 3.358 3.358 3.205 3.546 3.109C3.76 3 4.04 3 4.6 3H19.4C19.96 3 20.24 3 20.454 3.109C20.642 3.205 20.795 3.358 20.891 3.546C21 3.76 21 4.04 21 4.6V6.337C21 6.582 21 6.704 20.972 6.819C20.948 6.921 20.908 7.019 20.853 7.108C20.791 7.209 20.704 7.296 20.531 7.469L17 11"/>
    </svg>
  );
}

function IconFunnelOff({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 21L3 3V6.337C3 6.582 3 6.704 3.028 6.819C3.052 6.921 3.093 7.019 3.147 7.108C3.209 7.209 3.296 7.296 3.469 7.469L9.531 13.531C9.704 13.704 9.791 13.791 9.853 13.892C9.907 13.981 9.948 14.079 9.972 14.181C10 14.296 10 14.418 10 14.663V21L14 17V14M8.601 3H19.4C19.96 3 20.24 3 20.454 3.109C20.642 3.205 20.795 3.358 20.891 3.546C21 3.76 21 4.04 21 4.6V6.337C21 6.582 21 6.704 20.972 6.819C20.948 6.921 20.908 7.019 20.853 7.108C20.791 7.209 20.704 7.296 20.531 7.469L16.801 11.199"/>
    </svg>
  );
}

function getFilterDescription(name) {
  const parts = name.split('|');
  if (parts.length < 2) return name;

  const interval = parts[0];
  const type = parts[1];

  if (type === 'Binance') {
    const param = parts[2] ?? '';
    if (param === 'USDT') return `Moedas com par USDT`;
    if (param === 'BTC')  return `Moedas com par BTC`;
    if (param === 'BNB')  return `Moedas com par BNB`;
    if (param.includes('⇿')) {
      const [low, high] = param.split('⇿');
      return `Volume entre ${low} e ${high} USDT (${interval})`;
    }
    if (param.includes('⇾')) {
      const val = param.replace('⇾', '').trim();
      return `Volume acima de ${val} USDT (${interval})`;
    }
    return `Filtro Binance: ${param}`;
  }

  if (type === 'r') {
    // 1h|r|a|70|b|99
    const c1 = parts[2] === 'a' ? 'acima' : 'abaixo';
    const v1 = parts[3];
    const c2 = parts[4] === 'b' ? 'abaixo' : 'acima';
    const v2 = parts[5];
    return `RSI ${c1} de ${v1} e ${c2} de ${v2} (${interval})`;
  }

  if (type === 'i') {
    // 1h|i|conversion|a|base
    const line1 = parts[2];
    const comp  = parts[3] === 'a' ? 'acima de' : 'abaixo de';
    const line2 = parts[4];
    return `Ichimoku: ${line1} ${comp} ${line2} (${interval})`;
  }

  if (type === 'm') {
    // 1h|m|200|a|close
    const period = parts[2];
    const comp   = parts[3] === 'a' ? 'acima do' : 'abaixo do';
    const candle = parts[4];
    return `MA${period} ${comp} ${candle} (${interval})`;
  }

  if (type === 'lowestIndex')      return `Menor preço nos últimos períodos (${interval})`;
  if (type === 'highLowVariation') return `Variação de preço alto/baixo (${interval})`;

  return name;
}

export default function FilterTabs({ onSelectFilter }) {
  const { filters, joinFilters, removeFilters, clearAllFilters } = useCurrency();
  const [checked, setChecked] = useState(new Set());
  const [activeFilter, setActiveFilter] = useState(null);

  const sortedFilters = useMemo(() => {
    if (!filters.length) return [];
    try {
      const binance = filters.filter((f) => f.name.includes('Binance'));
      const others  = filters.filter((f) => !f.name.includes('Binance'));
      return [...binance, ...sortFirstIncludesBinance(sortByTypeOfIntervals([...others]))];
    } catch {
      return filters;
    }
  }, [filters]);

  function toggleCheck(name) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function handleClick(name) {
    setActiveFilter(name);
    onSelectFilter(name);
  }

  function handleJoin() { joinFilters(Array.from(checked)); }
  function handleRemove() { removeFilters(Array.from(checked)); setChecked(new Set()); }
  function handleClearAll() { clearAllFilters(); setChecked(new Set()); setActiveFilter(null); onSelectFilter(null); }

  const btnBase = 'p-1 rounded text-p5 transition-colors hover:text-white';

  return (
    <div className="flex flex-col gap-1 h-full min-h-0">
      {/* Lista de tags de filtro */}
      <div className="flex flex-wrap gap-1 flex-1 min-h-0 overflow-y-auto content-start">
        {sortedFilters.map((filter) => {
          const color = getIntervalColor(filter.name);
          const isActive = activeFilter === filter.name;
          const description = getFilterDescription(filter.name);
          return (
            <div
              key={filter.name}
              title={description}
              className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 cursor-pointer border transition-all ${
                isActive
                  ? 'border-p4 bg-p2'
                  : 'border-transparent bg-p2/60 hover:border-p3'
              }`}
            >
              <span
                className="text-xs font-mono"
                style={{ color }}
                onClick={() => handleClick(filter.name)}
              >
                {filter.name}
              </span>
              <input
                type="checkbox"
                checked={checked.has(filter.name)}
                onChange={() => toggleCheck(filter.name)}
                className="w-3 h-3 accent-p4 cursor-pointer"
              />
            </div>
          );
        })}
      </div>

      {/* Botões de ação */}
      <div className="flex gap-1 justify-end">
        <button
          onClick={handleJoin}
          title="Intersecionar filtros marcados — exibe apenas moedas presentes em TODOS os filtros selecionados"
          className={`${btnBase} hover:bg-p3`}
        >
          <IconFunnel className="w-4 h-4" />
        </button>
        <button
          onClick={handleRemove}
          title="Remover filtros marcados da lista"
          className={`${btnBase} hover:bg-p3`}
        >
          <IconFunnelX className="w-4 h-4" />
        </button>
        <button
          onClick={handleClearAll}
          title="Limpar todos os filtros e voltar à lista completa"
          className={`${btnBase} hover:bg-red-800`}
        >
          <IconFunnelOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
