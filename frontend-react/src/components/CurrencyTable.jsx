import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import SearchInput from './SearchInput';
import { fetchCandlesticksAndCloud, fetchGateCurrencies, gatePreloadCandles, fetchMaCrossoverFilter, fetchMultitradeTrades } from '../services/api';
import { parseMaCrossFilterName } from '../utils/filterNames';
import { useI18n } from '../i18n';
import MultitradeModal from './MultitradeModal';
import MultitradeBotStateModal from './MultitradeBotStateModal';
import { getEntriesForSymbol } from '../constants/strategyPresets';
import { CHART_VIEW } from '../utils/chartView';
import {
  resolveTradeChartInterval,
  loadMultitradeSymbolChart,
} from '../utils/multitradeChart';
import { multitradePhaseBadge, symbolPhaseSummary } from '../utils/multitradePhase';
import {
  compareMacrossFavorites, formatMacrossStatusBadge,
  loadMacrossFavSort, isMaCrossEntry,
} from '../utils/macrossFavoritesSort';
import { useMacrossFavoritesStatus } from '../hooks/useMacrossFavoritesStatus';
import MacrossFavSortSelect from './MacrossFavSortSelect';

const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#fcd535';
const MT_COLOR      = '#22d3ee';

function isMaCrossEntryLocal(e) {
  return isMaCrossEntry(e);
}

function getMaCrossEntries(favorites, symbol) {
  return getEntriesForSymbol(favorites, symbol).filter(isMaCrossEntryLocal);
}


function fmtBuyTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

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


function FavButton({ active, color, label, text, onClick }) {
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
      {text ?? label[0]}
    </button>
  );
}

// Para cada símbolo favorito: usa Binance se tiver volume > 0, senão Gate.
// Símbolos não encontrados em nenhum lugar são ignorados.
function resolveFavorites(favSet, binanceList, gateAll) {
  const binanceMap = new Map(binanceList.map((c) => [c.symbol, c]));
  const gateMap    = new Map((gateAll || []).map((c) => [c.symbol, c]));
  const result = [];
  for (const sym of favSet) {
    const b = binanceMap.get(sym);
    const g = gateMap.get(sym);
    if (b && (b.volume || 0) > 0) result.push(b);
    else if (g) result.push(g);
    else if (b)  result.push(b); // volume 0 mas existe — inclui mesmo assim
  }
  return result;
}

function macrossLiveAgeMin(meta, nowMs = Date.now(), scannedAt) {
  if (!meta) return null;
  if (meta.crossTime != null) return Math.max(0, (nowMs - Number(meta.crossTime)) / 60_000);
  if (meta.ageMin != null && scannedAt) {
    return meta.ageMin + Math.max(0, (nowMs - Number(scannedAt)) / 60_000);
  }
  return meta.ageMin ?? null;
}

function formatMacrossBadge(meta, t, nowMs = Date.now(), scannedAt) {
  if (!meta) return null;
  if (meta.kind === 'approaching') {
    const arrow = meta.direction === 'down' ? '↓' : '↑';
    const gap = meta.gapPct != null ? `${meta.gapPct}%` : '—';
    return t('table.macross_near', arrow, gap);
  }
  let ageMin = macrossLiveAgeMin(meta, nowMs, scannedAt);
  if (ageMin != null) {
    const arrow = meta.direction === 'down' ? '↓' : '↑';
    const rounded = Math.round(ageMin * 10) / 10;
    const age = rounded < 1 ? `${Math.round(rounded * 60)}s` : `${rounded}m`;
    return t('table.macross_crossed', arrow, age);
  }
  return null;
}

export default function CurrencyTable({ activeFilter, showFavorites, setShowFavorites, onSelectCurrency }) {
  const {
    currencies, findFilter, selectedQuote,     selectedChart, setSelectedChart, setChartZoom, setChartTradeMarkers,
    setChartViewSource, clearMultitradeChartView, chartInterval, setChartInterval,
    applyMultitradeSymbolChart,
    gateFavorites, binanceFavorites,
    toggleGateFavorite, toggleBinanceFavorite,
    setTradePurchases, setAllTrades,
    multitradeFavorites, removeMultitradeEntry, saveMultitradeSymbol, updateMultitradeBotState,
    filterVisibleCurrencies, isVisibleSymbol, addFilter,
  } = useCurrency();
  const { t, formatPrice } = useI18n();
  const [loadingSymbol, setLoadingSymbol]       = useState(null);
  const [activeRow, setActiveRow]               = useState(null);
  const [mtModal, setMtModal]       = useState(null);
  const [mtStateModal, setMtStateModal] = useState(null);
  const [search, setSearch]               = useState('');
  const [sortVolume, setSortVolume]       = useState('desc'); // 'desc' | 'asc'
  const [gateItems, setGateItems]         = useState([]);
  const [gateLoading, setGateLoading]     = useState(false);
  const [gateAll, setGateAll]             = useState(null); // todas as moedas Gate (para favoritos)
  const gateCacheRef                      = useRef(null);
  const [macrossLive, setMacrossLive]     = useState(false);
  const [macrossRefreshing, setMacrossRefreshing] = useState(false);
  const [macrossTick, setMacrossTick]     = useState(0);
  const [macrossFavSort, setMacrossFavSort] = useState(() => loadMacrossFavSort());

  const macrossFavSymbols = useMemo(() => (
    [...new Set(
      multitradeFavorites
        .filter(e => e.enabled !== false && isMaCrossEntryLocal(e))
        .map(e => e.symbol),
    )].sort()
  ), [multitradeFavorites]);

  const isMacrossFavView = showFavorites === 'macross';
  const {
    status: macrossFavStatus,
    loading: macrossFavLoading,
    entriesBySymbol: macrossEntriesBySymbol,
  } = useMacrossFavoritesStatus(macrossFavSymbols, multitradeFavorites, isMacrossFavView);

  const activeMacrossFilter = useMemo(() => {
    if (!activeFilter || showFavorites) return null;
    const f = findFilter(activeFilter);
    if (!f || !parseMaCrossFilterName(f.name)) return null;
    return f;
  }, [activeFilter, showFavorites, findFilter]);

  const macrossMeta = activeMacrossFilter?.meta ?? null;
  const macrossScannedAt = activeMacrossFilter?.scannedAt ?? null;

  const cycleSort = useCallback(() => {
    setSortVolume((v) => v === 'desc' ? 'asc' : 'desc');
  }, []);

  const rows = useMemo(() => {
    if (!currencies.list?.length) return [];

    let list;

    if (showFavorites === 'gate') {
      list = resolveFavorites(gateFavorites, currencies.list, gateAll);
    } else if (showFavorites === 'binance') {
      list = currencies.list.filter((c) => binanceFavorites.has(c.symbol));
    } else if (showFavorites === 'macross') {
      const mtSymbols = new Set(
        multitradeFavorites.filter(e => e.enabled !== false && isMaCrossEntry(e)).map(e => e.symbol),
      );
      list = resolveFavorites(mtSymbols, currencies.list, gateAll);
    } else if (activeFilter) {
      const filter = findFilter(activeFilter);
      if (filter) {
        const isMarket = activeFilter.startsWith('Mercado|');
        list = filter.list
          .filter((sym) => isVisibleSymbol(sym))
          .map((sym) => {
            const binance = currencies.list.find((c) => c.symbol === sym);
            if (binance) return binance;
            if (isMarket && gateAll) return gateAll.find((c) => c.symbol === sym) ?? null;
            return null;
          })
          .filter(Boolean);
      }
    }

    if (!list) {
      list = currencies.list.filter((c) => c.symbol.endsWith(selectedQuote));
    }

    list = filterVisibleCurrencies(list);

    if (search.trim()) {
      const term = search.trim().toUpperCase();
      list = list.filter((c) => c.symbol.includes(term));
    }

    list = list.slice().sort((a, b) => {
      if (isMacrossFavView) {
        const volumeBySymbol = new Map(list.map(c => [c.symbol, c.volume]));
        return compareMacrossFavorites(a, b, macrossFavSort, {
          status: macrossFavStatus,
          entriesBySymbol: macrossEntriesBySymbol,
          volumeBySymbol,
        });
      }
      if (activeMacrossFilter?.meta) {
        const ma = activeMacrossFilter.meta[a.symbol];
        const mb = activeMacrossFilter.meta[b.symbol];
        if (ma && mb) {
          if (ma.kind !== mb.kind) return ma.kind === 'crossed' ? -1 : 1;
          const aa = macrossLiveAgeMin(ma, undefined, macrossScannedAt);
          const ab = macrossLiveAgeMin(mb, undefined, macrossScannedAt);
          if (aa != null && ab != null) return aa - ab;
          if (ma.gapPct != null && mb.gapPct != null) return ma.gapPct - mb.gapPct;
        }
      }
      const va = Number(a.volume) || 0;
      const vb = Number(b.volume) || 0;
      return sortVolume === 'desc' ? vb - va : va - vb;
    });

    return list;
  }, [currencies, activeFilter, selectedQuote, findFilter, search, showFavorites, gateFavorites, binanceFavorites, multitradeFavorites, sortVolume, gateAll, filterVisibleCurrencies, isVisibleSymbol, activeMacrossFilter, macrossScannedAt, macrossTick, isMacrossFavView, macrossFavSort, macrossFavStatus, macrossEntriesBySymbol]);

  // Atualização em tempo real de filtros macross (cruzou há N min / prestes a cruzar)
  useEffect(() => {
    if (!activeMacrossFilter) {
      setMacrossLive(false);
      return;
    }

    const params = parseMaCrossFilterName(activeMacrossFilter.name);
    if (!params) return;

    let cancelled = false;
    setMacrossLive(true);

    async function refresh() {
      setMacrossRefreshing(true);
      try {
        const result = await fetchMaCrossoverFilter({
          period1: String(params.period1),
          interval1: params.interval1,
          period2: String(params.period2),
          interval2: params.interval2,
          mode: params.mode,
          maxAgeMin: params.maxAgeMin,
          tolerancePct: String(params.tolerancePct),
          proximityPct: String(params.proximityPct),
          live: true,
        });
        if (!cancelled) {
          addFilter({
            name: result.name,
            list: result.list,
            meta: result.details,
            scannedAt: result.scannedAt,
          });
        }
      } catch (err) {
        console.warn('[macross-live]', err.message);
      } finally {
        if (!cancelled) setMacrossRefreshing(false);
      }
    }

    refresh();
    const pollMs = params.mode.startsWith('near') || ['5', '15'].includes(params.maxAgeMin)
      ? 30_000
      : 60_000;
    const id = setInterval(refresh, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeMacrossFilter?.name, addFilter]);

  // Atualiza idade exibida do badge entre polls (crossTime → agora)
  useEffect(() => {
    if (!activeMacrossFilter) return undefined;
    const id = setInterval(() => setMacrossTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [activeMacrossFilter?.name]);

  // Busca Gate.io sempre que o usuário digita (≥2 chars), excluindo moedas já na lista Binance
  useEffect(() => {
    const term = search.trim().toUpperCase();
    if (term.length < 2) { setGateItems([]); return; }

    let cancelled = false;
    setGateLoading(true);

    (async () => {
      try {
        if (!gateCacheRef.current) {
          gateCacheRef.current = await fetchGateCurrencies();
          setGateAll(gateCacheRef.current);
        }
        if (!cancelled) {
          const binanceSymbols = new Set(currencies.list?.map(c => c.symbol) ?? []);
          setGateItems(
            gateCacheRef.current
              .filter(c => c.symbol.includes(term) && !binanceSymbols.has(c.symbol) && isVisibleSymbol(c.symbol))
              .slice(0, 40)
          );
        }
      } catch {
        if (!cancelled) setGateItems([]);
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [search, currencies.list, isVisibleSymbol]);

  // Carrega moedas Gate.io quando necessário para favoritos ou filtros de mercado
  useEffect(() => {
    const needGate = showFavorites === 'gate' || showFavorites === 'macross'
      || (activeFilter && activeFilter.startsWith('Mercado|'));
    if (!needGate) return;
    if (gateCacheRef.current) { setGateAll(gateCacheRef.current); return; }
    fetchGateCurrencies().then((items) => {
      gateCacheRef.current = items;
      setGateAll(items);
    }).catch(() => {});
  }, [showFavorites, activeFilter]);

  async function handleSelect(item, source = null) {
    onSelectCurrency?.();
    setLoadingSymbol(item.symbol);
    setActiveRow(item.symbol);
    setTradePurchases([]);
    setAllTrades([]);
    try {
      setChartZoom(null);
      setChartTradeMarkers([]);
      clearMultitradeChartView();

      const isGateOnly = !currencies.list.some(c => c.symbol === item.symbol);
      const isGateFav  = gateFavorites.has(item.symbol);
      const effectiveSource = source ?? ((isGateOnly || isGateFav) ? 'gate' : null);

      const mtEntries = getMaCrossEntries(multitradeFavorites, item.symbol).filter(e => e.enabled !== false);
      const mtEntry = mtEntries[0] ?? null;
      const isMT = !!mtEntry;

      let effectiveInterval = chartInterval || selectedChart?.interval || '15m';
      if (isMT) {
        effectiveInterval = resolveTradeChartInterval(mtEntry, null);
      }

      setChartInterval(effectiveInterval);
      setChartViewSource(isMT ? CHART_VIEW.MULTITRADE : CHART_VIEW.TABLE);

      if (isMT) {
        await loadMultitradeSymbolChart(mtEntry, {
          fetchCandlesticksAndCloud,
          fetchMultitradeTrades,
          applyMultitradeSymbolChart,
        });
        if (effectiveSource === 'gate') gatePreloadCandles(item.symbol);
        return;
      }

      const data = await fetchCandlesticksAndCloud(item.symbol, effectiveInterval, effectiveSource);
      setSelectedChart({ ...data, interval: effectiveInterval, symbol: item.symbol, source: effectiveSource ?? null });
      if (effectiveSource === 'gate') gatePreloadCandles(item.symbol);
    } catch (err) {
      console.warn(`[CurrencyTable] candles indisponíveis para ${item.symbol}:`, err.message);
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
  const mtCount      = new Set(
    multitradeFavorites.filter(e => e.enabled !== false && isMaCrossEntry(e)).map(e => e.symbol),
  ).size;

  return (
    <div className="flex flex-col h-full">
      {/* Barra de busca */}
      <div className="px-2 py-1 shrink-0">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('table.search')}
        />
      </div>

      {/* Cabeçalho contador + filtros de favoritos */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-p2 shrink-0">
        <span className="text-xs text-p5 opacity-50 uppercase tracking-wider">
          Moedas
          {macrossLive && (
            <span className="ml-1.5 normal-case tracking-normal text-[10px] text-emerald-400/90">
              {macrossRefreshing ? '⟳' : '●'} live
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {isMacrossFavView && (
            <MacrossFavSortSelect value={macrossFavSort} onChange={setMacrossFavSort} />
          )}
          {isMacrossFavView && macrossFavLoading && (
            <span className="text-[9px] text-emerald-400/80">⟳</span>
          )}
          <span className="text-xs font-mono text-p4">{rows.length}</span>

          {/* Filtro MA-Cross */}
          <button
            id="currency-table-btn-filter-macross"
            onClick={() => toggleShowFavorites('macross')}
            title={showFavorites === 'macross' ? 'Ver todas as moedas' : `MA-Cross (${mtCount})`}
            className="currency-table-btn-filter-macross flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
            style={{ opacity: showFavorites === 'macross' ? 1 : 0.5 }}
          >
            <span
              className="text-[10px] font-bold px-1 py-0.5 rounded"
              style={{
                background: showFavorites === 'macross' ? MT_COLOR : 'transparent',
                color: showFavorites === 'macross' ? '#000' : MT_COLOR,
                border: `1px solid ${MT_COLOR}`,
              }}
            >
              MC{mtCount > 0 ? ` ${mtCount}` : ''}
            </span>
          </button>

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
                Vol{sortVolume === 'desc' ? ' ↓' : ' ↑'}
              </th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const { base, quote } = splitSymbol(item.symbol);
              const isGate     = gateFavorites.has(item.symbol);
              const isBinance  = binanceFavorites.has(item.symbol);
              const mtEntries  = getMaCrossEntries(multitradeFavorites, item.symbol);
              const isMT       = mtEntries.some(e => e.enabled !== false);

              return (
                <tr
                  key={item.symbol}
                  onClick={() => handleSelect(item)}
                  className={`border-b border-p2/30 cursor-pointer transition-colors ${
                    activeRow === item.symbol
                      ? 'bg-p2/80 text-white'
                      : isMT
                      ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-p5'
                      : 'hover:bg-p2/40 text-p5'
                  }`}
                >
                  <td className="pl-2">
                    <div className="flex items-center gap-1">
                      <FavButton active={isGate}    color={GATE_COLOR}    label="Gate"    onClick={(e) => { e.stopPropagation(); toggleGateFavorite(item.symbol); }} />
                      <FavButton active={isBinance} color={BINANCE_COLOR} label="Binance" onClick={(e) => { e.stopPropagation(); toggleBinanceFavorite(item.symbol); }} />
                      <FavButton active={isMT}      color={MT_COLOR}      label="MA-Cross" text="MC" onClick={(e) => { e.stopPropagation(); setMtModal({ symbol: item.symbol, exchange: isGate && !isBinance ? 'gate' : 'binance', entries: mtEntries }); }} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold">
                    <div className="flex flex-col">
                      <span>{base}<span className="opacity-40 font-normal text-[10px]">/{quote}</span></span>
                      {isMT && (() => {
                        const mtPhase = symbolPhaseSummary(mtEntries);
                        const mtPh = multitradePhaseBadge(mtPhase);
                        const bought = mtEntries.find(e => e.phase === 'BOUGHT' && e.buyTime);
                        return (
                          <span className="text-[9px] font-normal flex items-center gap-1 flex-wrap">
                            <button
                              type="button"
                              className="font-bold px-1 py-0 rounded hover:underline"
                              style={{ color: mtPh.color, background: `${mtPh.color}18`, border: `1px solid ${mtPh.color}44` }}
                              title={`${mtPh.hint} — clique para alterar`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setMtStateModal({ symbol: item.symbol, entries: mtEntries });
                              }}>
                              {mtPh.text}
                            </button>
                            {bought?.buyTime && (
                              <span className="text-white/70">
                                ▌ {fmtBuyTime(bought.buyTime)}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                      {(macrossMeta?.[item.symbol] || (isMacrossFavView && macrossFavStatus[item.symbol])) && (
                        <span className="text-[9px] font-bold text-emerald-400/90">
                          {macrossMeta?.[item.symbol]
                            ? formatMacrossBadge(macrossMeta[item.symbol], t, Date.now(), macrossScannedAt)
                            : formatMacrossStatusBadge(macrossFavStatus[item.symbol], t)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    <div className="flex flex-col items-end">
                      <span>{formatPrice(item.price)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] opacity-60">{formatVolume(item.volume)}</td>
                  <td className="pr-1 text-center">
                    {loadingSymbol === item.symbol
                      ? <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin mx-auto" />
                      : activeRow === item.symbol
                        ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 mx-auto text-p4"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                        : null}
                  </td>
                </tr>
              );
            })}

            {/* Separador + resultados Gate.io */}
            {gateLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-[11px] text-p5/50">
                    <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin" />
                    Buscando na Gate.io…
                  </div>
                </td>
              </tr>
            )}

            {gateItems.length > 0 && (
              <>
                <tr>
                  <td colSpan={5} className="px-2 py-1 border-t border-p3/30">
                    <span
                      className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                      style={{ color: GATE_COLOR, border: `1px solid ${GATE_COLOR}` }}
                    >
                      Gate.io · {gateItems.length}
                    </span>
                  </td>
                </tr>
                {gateItems.map((item) => {
                  const { base, quote } = splitSymbol(item.symbol);
                  const isGate   = gateFavorites.has(item.symbol);
                  const mtEntriesGate = getMaCrossEntries(multitradeFavorites, item.symbol);
                  const isMTGate = mtEntriesGate.some(e => e.enabled !== false);
                  return (
                    <tr
                      key={`gate-${item.symbol}`}
                      onClick={() => handleSelect(item, 'gate')}
                      className={`border-b border-p2/30 cursor-pointer transition-colors ${
                        activeRow === item.symbol
                          ? 'bg-p2/80 text-white'
                          : isMTGate
                          ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-p5'
                          : 'hover:bg-p2/40 text-p5'
                      }`}
                    >
                      <td className="pl-2">
                        <div className="flex items-center gap-1">
                          <FavButton active={isGate}   color={GATE_COLOR}  label="Gate"     onClick={(e) => { e.stopPropagation(); toggleGateFavorite(item.symbol); }} />
                          <FavButton active={isMTGate} color={MT_COLOR}    label="MA-Cross" text="MC" onClick={(e) => { e.stopPropagation(); setMtModal({ symbol: item.symbol, exchange: 'gate', entries: mtEntriesGate }); }} />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 font-mono font-semibold">
                        {base}<span className="opacity-40 font-normal text-[10px]">/{quote}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{item.price > 0 ? formatPrice(item.price) : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] opacity-60">{formatVolume(item.volume)}</td>
                      <td className="pr-1 text-center">
                        {loadingSymbol === item.symbol
                          ? <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin mx-auto" />
                          : activeRow === item.symbol
                            ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 mx-auto text-p4"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                            : null}
                      </td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal MA-Cross */}
      {mtModal && (
        <MultitradeModal
          symbol={mtModal.symbol}
          defaultExchange={mtModal.exchange}
          currentEntries={mtModal.entries}
          onConfirm={async ({ saves }) => {
            await saveMultitradeSymbol({ saves });
            setMtModal(null);
          }}
          onRemove={mtModal.entries?.length ? async () => {
            for (const e of mtModal.entries) await removeMultitradeEntry(e.id);
            setMtModal(null);
          } : undefined}
          onCancel={() => setMtModal(null)}
        />
      )}

      {mtStateModal && (
        <MultitradeBotStateModal
          symbol={mtStateModal.symbol}
          entries={mtStateModal.entries}
          onConfirm={async (payload) => {
            await updateMultitradeBotState(payload);
            setMtStateModal(null);
          }}
          onCancel={() => setMtStateModal(null)}
        />
      )}
    </div>
  );
}
