import { useState, useMemo, useRef, useEffect } from 'react';
import { useI18n } from '../i18n';
import { parseRsiConditionToken, parseMaCompareToken, parseMaCrossModeToken } from '../utils/filterNames';
import { useCurrency } from '../contexts/CurrencyContext';
import SearchInput from './SearchInput';
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

const CARD_COLORS = ['#4C86C6', '#EF3D4D', '#FED269', '#4DBD97', '#9B6ED6'];

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getContrastText(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#0f172a' : '#ffffff';
}

// Ciclo de item count por linha — nunca repete consecutivamente: 1≠2≠3≠2≠1≠3≠1…
const CYCLE = [1, 2, 3, 2, 1, 3];

// Em linha de 2: o de nome maior recebe span-2, o menor span-1 (somam 3)
// Em linha de 1: span-3 (largura total)
// Em linha de 3: todos span-1
function assignSpans(rowFilters) {
  const n = rowFilters.length;
  if (n === 1) return [3];
  if (n === 2) {
    return rowFilters[0].name.length >= rowFilters[1].name.length
      ? [2, 1] : [1, 2];
  }
  return [1, 1, 1];
}

function buildRows(filters) {
  const rows = [];
  let i = 0, ci = 0, prevCount = -1;
  while (i < filters.length) {
    const remaining = filters.length - i;
    // Nome longo (filtro combinado) não cabe bem em linha de 3 — limita a 2
    const cap = filters[i].name.length > 20 ? 2 : 3;

    let count, attempts = 0;
    do {
      count = Math.min(CYCLE[ci % CYCLE.length], remaining, cap);
      ci++;
      attempts++;
    } while (count === prevCount && attempts < CYCLE.length);

    const rowFilters = filters.slice(i, i + count);
    const spans      = assignSpans(rowFilters);
    rows.push(rowFilters.map((f, j) => ({ filter: f, span: spans[j] })));
    prevCount = count;
    i += count;
  }
  return rows;
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

function getFilterDescription(name, t) {
  const parts    = name.split('|');
  if (parts.length < 2) return name;
  const interval = parts[0];
  const type     = parts[1];

  
  if (interval === 'Favoritos') {
    if (type === 'Binance') return 'Favoritos Binance';
    if (type === 'Gate')    return 'Favoritos Gate';
    if (type === 'Trade')   return 'Trade Now';
    if (type === 'Ativos')  return 'Trades Ativos';
    if (type === 'MA-Cross') return 'MA-Cross';
    if (type === 'Alta') {
      if (parts[2] === 'Binance') return t('filter.fav_gainers_binance');
      if (parts[2] === 'Gate')    return t('filter.fav_gainers_gate');
    }
    if (type === 'Novas') {
      if (parts[2] === 'Binance') return t('filter.fav_new_binance');
      if (parts[2] === 'Gate')    return t('filter.fav_new_gate');
    }
    return `Favoritos: ${type}`;
  }

  if (interval === 'Mercado') {
    const param = parts[1] ?? '';
    if (param === 'USDT') return t('filter.usdt');
    if (param.includes('⇿')) { const [lo, hi] = param.split('⇿'); return t('filter.mkt_range', lo, hi); }
    if (param.includes('⇾')) return t('filter.mkt_above', param.replace('⇾', '').trim());
    return `Mercado: ${param}`;
  }

  if (type === 'Mercado') {
    const param = parts[2] ?? '';
    if (param === 'USDT') return t('filter.usdt');
    return `Mercado: ${param}`;
  }

  if (type === 'Binance') {
    const param = parts[2] ?? '';
    if (param === 'USDT') return t('filter.usdt');
    if (param === 'BTC')  return t('filter.btc');
    if (param === 'BNB')  return t('filter.bnb');
    if (param.includes('⇿')) { const [lo, hi] = param.split('⇿'); return t('filter.vol_range', lo, hi, interval); }
    if (param.includes('⇾')) return t('filter.vol_above', param.replace('⇾', '').trim(), interval);
    return `Binance: ${param}`;
  }

  if (interval === 'Stables') {
    const cat = parts[1] ?? '';
    if (cat === 'USD')    return t('filter.stables_usd');
    if (cat === 'EUR')    return t('filter.stables_eur');
    if (cat === 'Ouro')   return t('filter.stables_gold');
    if (cat === 'Outras') return t('filter.stables_other');
    return `Stablecoins: ${cat}`;
  }

  if (interval === 'mcap') {
    const metric = parts[1];
    const preset = parts[2];
    if (metric === 'giro') {
      if (preset === 'baixo') return t('filter.mcap_low_t');
      if (preset === 'medio') return t('filter.mcap_mid_t');
      if (preset === 'alto')  return t('filter.mcap_high_t');
    }
    if (metric === 'diluição') {
      if (preset === 'baixo') return t('filter.mcap_low_d');
      if (preset === 'medio') return t('filter.mcap_mid_d');
      if (preset === 'alto')  return t('filter.mcap_high_d');
    }
    return `Market Cap: ${metric} ${preset}`;
  }

  if (type === 'r' || type === 'rsi') {
    const c1Type = parseRsiConditionToken(parts[2]);
    const v1 = parts[3];
    const c2Type = parseRsiConditionToken(parts[4]);
    const v2 = parts[5];
    const c1 = c1Type === 'below' ? t('filter.abaixo') : t('filter.acima');
    const c2 = c2Type === 'below' ? t('filter.abaixo') : t('filter.acima');
    return t('filter.rsi', c1, v1, c2, v2, interval);
  }

  if (type === 'i') {
    const line1 = parts[2];
    const comp  = parseMaCompareToken(parts[3]) === 'below' ? t('filter.abaixo') : t('filter.acima');
    const line2 = parts[4];
    return t('filter.ichi', line1, comp, line2, interval);
  }

  if (type === 'm' || type === 'ma') {
    if (parts[3] === 'pct') {
      const period = parts[2];
      const minPct = parts[4];
      return t('filter.ma_pct', period, minPct, interval);
    }
    const period = parts[2];
    const cmpType = parseMaCompareToken(parts[3]);
    const comp   = cmpType === 'below' ? t('filter.abaixo') : t('filter.acima');
    const candle = parts[4];
    return t('filter.ma', period, comp, candle, interval);
  }

  if (type === 'macross') {
    const p1 = parts[2];
    const iv1 = parts[3];
    const p2 = parts[4];
    const iv2 = parts[5];
    const mode = parseMaCrossModeToken(parts[6]);
    const modeLabel = mode ? t(`filter.macross.${mode}`) : parts[6];
    let extra = '';
    if (parts[7] === 'age' && parts[8] != null) {
      extra = parts[8] === 'last' ? t('filter.macross.age_last') : t('filter.macross.age_min', parts[8]);
    } else if (parts[7] === 'prox' && parts[8] != null) {
      extra = `≤${parts[8]}%`;
    }
    if (parts.includes('tol')) {
      const ti = parts.indexOf('tol');
      if (parts[ti + 1] != null) extra += (extra ? ' ' : '') + `±${parts[ti + 1]}%`;
    }
    return t('filter.macross', p1, iv1, p2, iv2, modeLabel, extra, interval);
  }

  return name;
}

export default function FilterTabs({ activeFilter, onSelectFilter }) {
  const { filters, joinFilters, removeFilters, clearAllFilters, ensureMarketHighlights, clearFavoriteView } = useCurrency();
  const { t } = useI18n();
  const [checked, setChecked] = useState(new Set());
  const [flashing, setFlashing] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const prevFilterNamesRef = useRef(null); // null = primeira renderização ainda não registrada
  const flashTimerRef = useRef(null);

  useEffect(() => {
    // Primeira execução: registra os filtros já existentes sem piscar
    if (prevFilterNamesRef.current === null) {
      prevFilterNamesRef.current = new Set(filters.map(f => f.name));
      return;
    }

    const prev = prevFilterNamesRef.current;
    const newNames = filters.map(f => f.name).filter(n => !prev.has(n));
    prevFilterNamesRef.current = new Set(filters.map(f => f.name));

    if (newNames.length === 0) return;

    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);

    setFlashing(s => { const n = new Set(s); newNames.forEach(name => n.add(name)); return n; });

    // Limpa TODOS os flashes após 5s (não só o último lote)
    flashTimerRef.current = setTimeout(() => {
      setFlashing(new Set());
      flashTimerRef.current = null;
    }, 5000);
  }, [filters]);

  const sortedFilters = useMemo(() => {
    if (!filters.length) return [];
    try {
      const mercado = filters.find((f) => f.name === 'Mercado|USDT');
      const rest    = filters.filter((f) => f.name !== 'Mercado|USDT');
      const binance = rest.filter((f) => f.name.includes('Binance'));
      const others  = rest.filter((f) => !f.name.includes('Binance'));
      const sorted  = [...binance, ...sortFirstIncludesBinance(sortByTypeOfIntervals([...others]))];
      return mercado ? [mercado, ...sorted] : sorted;
    } catch {
      return filters;
    }
  }, [filters]);

  const visibleFilters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedFilters;
    return sortedFilters.filter((f) => {
      const name = f.name.toLowerCase();
      const desc = getFilterDescription(f.name, t).toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [sortedFilters, searchQuery, t]);

  function toggleCheck(name) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function handleClick(name) {
    const isHighlight = name.startsWith('Favoritos|Alta|') || name.startsWith('Favoritos|Novas|');
    if (isHighlight) {
      try {
        await ensureMarketHighlights();
      } catch (err) {
        console.warn('[FilterTabs] market-highlights:', err.message);
      }
    }
    onSelectFilter(activeFilter === name ? null : name);
  }

  function handleJoin() { joinFilters(Array.from(checked)); setChecked(new Set()); }
  function handleRemove() { removeFilters(Array.from(checked)); setChecked(new Set()); }
  function handleClearAll() {
    clearAllFilters();
    setChecked(new Set());
    clearFavoriteView();
    onSelectFilter(null);
  }

  const btnBase = 'p-1 rounded text-p5 transition-colors hover:text-white hover:bg-p4';

  return (
    <div className="flex flex-col gap-1 h-full min-h-0">
      <SearchInput
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={t('filter.search_ph')}
        className="shrink-0"
      />
      {/* Linhas com tamanhos variados */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-1">
        {(() => {
          let gi = 0;
          return buildRows(visibleFilters).map((row, rowIdx) => (
            <div key={rowIdx} className="flex gap-1">
              {row.map(({ filter, span }) => {
                const cardColor  = CARD_COLORS[gi % CARD_COLORS.length];
                gi++;
                const textColor  = getContrastText(cardColor);
                const isActive   = activeFilter === filter.name;
                const isChecked  = checked.has(filter.name);
                const isFlashing = flashing.has(filter.name);
                const count      = filter.list?.length ?? 0;
                const bgAlpha    = isActive ? 1.00 : isChecked ? 0.90 : 0.82;
                return (
                  <div
                    key={filter.name}
                    title={getFilterDescription(filter.name, t)}
                    onClick={() => handleClick(filter.name)}
                    style={{
                      flex: span,
                      background: hexToRgba(cardColor, bgAlpha),
                      borderColor: isActive ? textColor : hexToRgba(cardColor, 1),
                      outline: isActive ? `2px solid ${textColor}` : undefined,
                      outlineOffset: isActive ? '-2px' : undefined,
                    }}
                    className={`flex flex-col gap-0.5 rounded border px-2 py-2 cursor-pointer transition-all hover:brightness-110 min-w-0${isFlashing ? ' animate-pulse' : ''}`}
                  >
                    <span className="text-[10px] font-mono font-semibold truncate leading-tight" style={{ color: textColor }}>
                      {filter.name}
                    </span>
                    <div className="flex items-end justify-between gap-1 mt-0.5">
                      <span className="text-[11px] font-mono font-bold leading-none" style={{ color: textColor }}>
                        {count}
                      </span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => { e.stopPropagation(); toggleCheck(filter.name); }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 accent-p4 cursor-pointer shrink-0"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ));
        })()}
      </div>

      {/* Botões de ação */}
      <div className="flex gap-1 justify-end">
        <button
          onClick={handleJoin}
          title={t('filter.btn_join')}
          className={`${btnBase} hover:bg-p3`}
        >
          <IconFunnel className="w-4 h-4" />
        </button>
        <button
          onClick={handleRemove}
          title={t('filter.btn_remove')}
          className={`${btnBase} hover:bg-p3`}
        >
          <IconFunnelX className="w-4 h-4" />
        </button>
        <button
          onClick={handleClearAll}
          title={t('filter.btn_clear')}
          className={`${btnBase} hover:bg-red-800`}
        >
          <IconFunnelOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
