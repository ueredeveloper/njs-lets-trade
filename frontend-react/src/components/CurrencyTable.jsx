import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import SearchInput from './SearchInput';
import { fetchCandlesticksAndCloud, fetchGateCurrencies, gatePreloadCandles, fetchBinanceTrades, fetchGateTrades } from '../services/api';
import { useI18n } from '../i18n';
import TradeConfigModal from './TradeConfigModal';
import MultitradeModal from './MultitradeModal';
import FiveMTradeModal from './FiveMTradeModal';
import { getEntriesForSymbol, symbolHasMultitrade } from '../constants/strategyPresets';
import { CHART_VIEW } from '../utils/chartView';

const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#fcd535';
const TRADE_COLOR   = '#00c076';
const ACTIVE_COLOR  = '#f59e0b';
const MT_COLOR      = '#8b5cf6';
const FIVE_M_COLOR  = '#06b6d4';


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

export default function CurrencyTable({ activeFilter, showFavorites, setShowFavorites, onSelectCurrency }) {
  const {
    currencies, findFilter, selectedQuote, selectedChart, setSelectedChart, setChartZoom, setChartTradeMarkers,
    setChartViewSource, clearMultitradeChartView,
    gateFavorites, binanceFavorites, tradeFavorites, tradeConfigs,
    toggleGateFavorite, toggleBinanceFavorite, toggleTradeFavorite, updateTradeConfig,
    setTradePurchases, setAllTrades,
    activeTrades, refreshActiveTrades, dismissActiveTrade,
    multitradeFavorites, removeMultitradeEntry, saveMultitradeSymbol,
    fiveMTradeFavorites, saveFiveMTradeEntry, removeFiveMTradeEntry,
    filterVisibleCurrencies, isVisibleSymbol,
  } = useCurrency();
  const { t, formatPrice } = useI18n();
  const [loadingSymbol, setLoadingSymbol]       = useState(null);
  const [activeRow, setActiveRow]               = useState(null);
  const [tradeModal, setTradeModal] = useState(null); // { symbol, exchange }
  const [mtModal, setMtModal]       = useState(null); // { symbol, exchange, entries? }
  const [fiveMModal, setFiveMModal] = useState(null); // { symbol, exchange }
  const [search, setSearch]               = useState('');
  const [sortVolume, setSortVolume]       = useState('desc'); // 'desc' | 'asc'
  const [gateItems, setGateItems]         = useState([]);
  const [gateLoading, setGateLoading]     = useState(false);
  const [gateAll, setGateAll]             = useState(null); // todas as moedas Gate (para favoritos)
  const gateCacheRef                      = useRef(null);

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
    } else if (showFavorites === 'trade') {
      list = resolveFavorites(tradeFavorites, currencies.list, gateAll);
    } else if (showFavorites === 'active') {
      const activeSymbols = new Set(activeTrades.keys());
      list = resolveFavorites(activeSymbols, currencies.list, gateAll);
    } else if (showFavorites === 'multitrade') {
      const mtSymbols = new Set(multitradeFavorites.filter(e => e.enabled !== false).map(e => e.symbol));
      list = resolveFavorites(mtSymbols, currencies.list, gateAll);
    } else if (showFavorites === '5mtrade') {
      const fmSymbols = new Set(fiveMTradeFavorites.map(e => e.symbol));
      list = resolveFavorites(fmSymbols, currencies.list, gateAll);
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

    // Nas abas trade e active: ordena primeiro por intervalo, depois por volume
    const INTERVAL_ORDER = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w'];
    const byInterval = showFavorites === 'trade' || showFavorites === 'active';

    list = list.slice().sort((a, b) => {
      if (byInterval) {
        const ia = INTERVAL_ORDER.indexOf(tradeConfigs.get(a.symbol)?.interval ?? '');
        const ib = INTERVAL_ORDER.indexOf(tradeConfigs.get(b.symbol)?.interval ?? '');
        const idxA = ia === -1 ? INTERVAL_ORDER.length : ia;
        const idxB = ib === -1 ? INTERVAL_ORDER.length : ib;
        if (idxA !== idxB) return idxA - idxB;
      }
      const va = Number(a.volume) || 0;
      const vb = Number(b.volume) || 0;
      return sortVolume === 'desc' ? vb - va : va - vb;
    });

    return list;
  }, [currencies, activeFilter, selectedQuote, findFilter, search, showFavorites, gateFavorites, binanceFavorites, tradeFavorites, tradeConfigs, activeTrades, multitradeFavorites, fiveMTradeFavorites, sortVolume, gateAll, filterVisibleCurrencies, isVisibleSymbol]);

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

  // Carrega e refresca active trades a cada 30s enquanto o filtro AT estiver ativo
  useEffect(() => {
    if (showFavorites !== 'active') return;
    refreshActiveTrades();
    const id = setInterval(refreshActiveTrades, 30_000);
    return () => clearInterval(id);
  }, [showFavorites, refreshActiveTrades]);

  // Carrega moedas Gate.io quando necessário para favoritos ou filtros de mercado
  useEffect(() => {
    const needGate = showFavorites === 'gate' || showFavorites === 'trade'
      || showFavorites === 'active' || showFavorites === 'multitrade'
      || showFavorites === '5mtrade'
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
    // Limpa trades anteriores imediatamente
    setTradePurchases([]);
    setAllTrades([]);
    try {
      setChartZoom(null);
      setChartTradeMarkers([]);
      clearMultitradeChartView();
      setChartViewSource(CHART_VIEW.TABLE);
      // Se source não foi informado, detecta Gate pelo fato de o símbolo não estar na lista Binance
      // ou por ser um favorito Gate (símbolo pode existir na Binance mas sem candles disponíveis)
      const isGateOnly = !currencies.list.some(c => c.symbol === item.symbol);
      const isGateFav  = gateFavorites.has(item.symbol);
      const effectiveSource = source ?? ((isGateOnly || isGateFav) ? 'gate' : null);

      const effectiveInterval = selectedChart?.interval || '30m';

      const data = await fetchCandlesticksAndCloud(item.symbol, effectiveInterval, effectiveSource);
      setSelectedChart(data);
      if (effectiveSource === 'gate') gatePreloadCandles(item.symbol);

      // Busca trades para trade favorites e gate favorites (para mostrar marcadores no chart)
      if (tradeFavorites.has(item.symbol) || gateFavorites.has(item.symbol)) {
        const tradeConfig = tradeConfigs.get(item.symbol);
        const useGateTrades = (tradeConfig?.exchange !== 'binance') && (gateFavorites.has(item.symbol) || effectiveSource === 'gate');
        const fetcher = useGateTrades
          ? fetchGateTrades(item.symbol)
          : fetchBinanceTrades(item.symbol);
        fetcher
          .then(trades => {
            setAllTrades(trades);
            setTradePurchases(trades.filter(t => t.isBuyer));
          })
          .catch(err => console.warn('[CurrencyTable] trades indisponíveis:', err.message));
      }
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
  const tradeCount   = tradeFavorites.size;
  const activeCount  = activeTrades.size;
  const mtCount      = new Set(multitradeFavorites.filter(e => e.enabled !== false).map(e => e.symbol)).size;
  const fiveMCount   = fiveMTradeFavorites.length;

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
        <span className="text-xs text-p5 opacity-50 uppercase tracking-wider">Moedas</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-p4">{rows.length}</span>

          {/* Filtro Trade Now */}
          <button
            onClick={() => toggleShowFavorites('trade')}
            title={showFavorites === 'trade' ? 'Ver todas as moedas' : `Em trade agora (${tradeCount})`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
            style={{ opacity: showFavorites === 'trade' ? 1 : 0.5 }}
          >
            <span
              className="text-[10px] font-bold px-1 py-0.5 rounded"
              style={{
                background: showFavorites === 'trade' ? TRADE_COLOR : 'transparent',
                color: showFavorites === 'trade' ? '#fff' : TRADE_COLOR,
                border: `1px solid ${TRADE_COLOR}`,
              }}
            >
              TN{tradeCount > 0 ? ` ${tradeCount}` : ''}
            </span>
          </button>

          {/* Filtro Active Trades (posições abertas nas exchanges) */}
          <button
            onClick={() => toggleShowFavorites('active')}
            title={showFavorites === 'active' ? 'Ver todas as moedas' : `Trades ativos — posições compradas (${activeCount})`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
            style={{ opacity: showFavorites === 'active' ? 1 : 0.5 }}
          >
            <span
              className="text-[10px] font-bold px-1 py-0.5 rounded"
              style={{
                background: showFavorites === 'active' ? ACTIVE_COLOR : 'transparent',
                color: showFavorites === 'active' ? '#000' : ACTIVE_COLOR,
                border: `1px solid ${ACTIVE_COLOR}`,
              }}
            >
              AT{activeCount > 0 ? ` ${activeCount}` : ''}
            </span>
          </button>

          {/* Filtro Multi-Trade */}
          <button
            id="currency-table-btn-filter-mt"
            onClick={() => toggleShowFavorites('multitrade')}
            title={showFavorites === 'multitrade' ? 'Ver todas as moedas' : `Multi-Trade (${mtCount})`}
            className="currency-table-btn-filter-mt flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
            style={{ opacity: showFavorites === 'multitrade' ? 1 : 0.5 }}
          >
            <span
              className="text-[10px] font-bold px-1 py-0.5 rounded"
              style={{
                background: showFavorites === 'multitrade' ? MT_COLOR : 'transparent',
                color: showFavorites === 'multitrade' ? '#fff' : MT_COLOR,
                border: `1px solid ${MT_COLOR}`,
              }}
            >
              MT{mtCount > 0 ? ` ${mtCount}` : ''}
            </span>
          </button>

          {/* Filtro 5m Trade */}
          <button
            onClick={() => toggleShowFavorites('5mtrade')}
            title={showFavorites === '5mtrade' ? 'Ver todas as moedas' : `5m Trade — RSI 5m (${fiveMCount})`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
            style={{ opacity: showFavorites === '5mtrade' ? 1 : 0.5 }}
          >
            <span
              className="text-[10px] font-bold px-1 py-0.5 rounded"
              style={{
                background: showFavorites === '5mtrade' ? FIVE_M_COLOR : 'transparent',
                color: showFavorites === '5mtrade' ? '#000' : FIVE_M_COLOR,
                border: `1px solid ${FIVE_M_COLOR}`,
              }}
            >
              5M{fiveMCount > 0 ? ` ${fiveMCount}` : ''}
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
            {showFavorites === 'active' && (() => {
              const stableKeys = ['USDT_GATE', 'USDT_BNB', 'USDC_GATE', 'USDC_BNB'];
              const stableRows = [];
              for (const key of stableKeys) {
                const info = activeTrades.get(key);
                if (!info) continue;
                const label = key.startsWith('USDT') ? 'USDT' : 'USDC';
                stableRows.push(
                  <tr key={key} className="border-b border-p2/30 bg-amber-500/10 text-p5">
                    <td className="pl-2">
                      <button
                        title="Ignorar posição"
                        onClick={(e) => { e.stopPropagation(); dismissActiveTrade(key); }}
                        className="text-[10px] opacity-40 hover:opacity-90 px-1"
                      >×</button>
                    </td>
                    <td className="px-2 py-1.5 font-mono font-semibold">
                      <div className="flex flex-col">
                        <span>{label}<span className="opacity-40 font-normal text-[10px]">/USDT</span></span>
                        <span className="text-[9px] font-normal text-p5/50">
                          {info.exchange === 'gate' ? 'Gate' : 'Bnb'}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">1.00</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[10px] opacity-60">
                      {formatVolume(info.buyQty)}
                    </td>
                    <td />
                  </tr>
                );
              }
              return stableRows;
            })()}
            {rows.map((item) => {
              const { base, quote } = splitSymbol(item.symbol);
              const isGate     = gateFavorites.has(item.symbol);
              const isBinance  = binanceFavorites.has(item.symbol);
              const isTrade    = tradeFavorites.has(item.symbol);
              const isMT       = symbolHasMultitrade(multitradeFavorites, item.symbol);
              const mtEntries  = getEntriesForSymbol(multitradeFavorites, item.symbol);
              const fiveMEntry = fiveMTradeFavorites.find(e => e.symbol === item.symbol);
              const is5mTrade  = !!fiveMEntry;
              const activeInfo  = activeTrades.get(item.symbol);
              const isActive   = !!activeInfo;
              const tradeConfig = tradeConfigs.get(item.symbol);

              // P&L em % se tiver preço atual e preço de compra
              let pnlPct = null;
              if (isActive && activeInfo.buyPrice && item.price) {
                pnlPct = ((parseFloat(item.price) - activeInfo.buyPrice) / activeInfo.buyPrice) * 100;
              }

              return (
                <tr
                  key={item.symbol}
                  onClick={() => handleSelect(item)}
                  className={`border-b border-p2/30 cursor-pointer transition-colors ${
                    activeRow === item.symbol
                      ? 'bg-p2/80 text-white'
                      : isActive
                      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-p5'
                      : isTrade
                      ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-p5'
                      : isMT
                      ? 'bg-violet-500/10 hover:bg-violet-500/20 text-p5'
                      : is5mTrade
                      ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-p5'
                      : 'hover:bg-p2/40 text-p5'
                  }`}
                >
                  <td className="pl-2">
                    <div className="flex items-center gap-1">
                      <FavButton active={isTrade}   color={TRADE_COLOR}   label="Trade"   onClick={(e) => { e.stopPropagation(); setTradeModal({ symbol: item.symbol, exchange: isGate && !isBinance ? 'gate' : 'binance' }); }} />
                      <FavButton active={is5mTrade} color={FIVE_M_COLOR}  label="5m Trade"  text="5M" onClick={(e) => { e.stopPropagation(); setFiveMModal({ symbol: item.symbol, exchange: fiveMEntry?.exchange ?? (isGate && !isBinance ? 'gate' : 'binance') }); }} />
                      <FavButton active={isGate}    color={GATE_COLOR}    label="Gate"    onClick={(e) => { e.stopPropagation(); toggleGateFavorite(item.symbol); }} />
                      <FavButton active={isBinance} color={BINANCE_COLOR} label="Binance" onClick={(e) => { e.stopPropagation(); toggleBinanceFavorite(item.symbol); }} />
                      <FavButton active={isMT}      color={MT_COLOR}      label="MultiTrade" text="MT" onClick={(e) => { e.stopPropagation(); setMtModal({ symbol: item.symbol, exchange: isGate && !isBinance ? 'gate' : 'binance', entries: mtEntries }); }} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold">
                    <div className="flex flex-col">
                      <span>{base}<span className="opacity-40 font-normal text-[10px]">/{quote}</span></span>
                      {isActive && (
                        <span className="flex items-center gap-1 text-[9px] font-normal" style={{ color: ACTIVE_COLOR }}>
                          <span>@{formatPrice(activeInfo.buyPrice)}</span>
                          <button
                            title="Ignorar posição (saldo residual)"
                            onClick={(e) => { e.stopPropagation(); dismissActiveTrade(item.symbol); }}
                            className="opacity-50 hover:opacity-100 leading-none"
                          >×</button>
                        </span>
                      )}
                      {(isActive || isTrade) && tradeConfig && (
                        <span className="text-[9px] font-normal text-p5/50">
                          {tradeConfig.exchange === 'gate' ? 'Gate' : 'Bnb'}
                          {' · '}
                          {tradeConfig.interval}&lt;{tradeConfig.rsiBuy}
                          {tradeConfig.sellInterval && tradeConfig.sellInterval !== tradeConfig.interval
                            ? <> / {tradeConfig.sellInterval}&gt;{tradeConfig.rsiSell}</>
                            : <>&gt;{tradeConfig.rsiSell}</>
                          }
                        </span>
                      )}
                      {is5mTrade && fiveMEntry && (
                        <span className="text-[9px] font-normal" style={{ color: FIVE_M_COLOR }}>
                          {fiveMEntry.exchange === 'gate' ? 'Gate' : 'Bnb'}
                          {' · $'}{fiveMEntry.capital}/entrada
                          {' · '}{fiveMEntry.rsiBuy ?? 30}&lt;RSI&gt;{fiveMEntry.rsiSell ?? 70}
                          {fiveMEntry.phase === 'BOUGHT' ? ` · ${fiveMEntry.buyCount || 1}×` : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    <div className="flex flex-col items-end">
                      <span>{formatPrice(item.price)}</span>
                      {isActive && pnlPct !== null && (
                        <span
                          className="text-[9px] font-bold"
                          style={{ color: pnlPct >= 0 ? '#00c076' : '#ff4d4f' }}
                        >
                          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                        </span>
                      )}
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
                  const isTrade  = tradeFavorites.has(item.symbol);
                  const isMTGate = symbolHasMultitrade(multitradeFavorites, item.symbol);
                  const mtEntriesGate = getEntriesForSymbol(multitradeFavorites, item.symbol);
                  const fiveMEntryGate = fiveMTradeFavorites.find(e => e.symbol === item.symbol);
                  const is5mGate = !!fiveMEntryGate;
                  return (
                    <tr
                      key={`gate-${item.symbol}`}
                      onClick={() => handleSelect(item, 'gate')}
                      className={`border-b border-p2/30 cursor-pointer transition-colors ${
                        activeRow === item.symbol
                          ? 'bg-p2/80 text-white'
                          : isTrade
                          ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-p5'
                          : is5mGate
                          ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-p5'
                          : 'hover:bg-p2/40 text-p5'
                      }`}
                    >
                      <td className="pl-2">
                        <div className="flex items-center gap-1">
                          <FavButton active={isTrade}  color={TRADE_COLOR} label="Trade"     onClick={(e) => { e.stopPropagation(); setTradeModal({ symbol: item.symbol, exchange: 'gate' }); }} />
                          <FavButton active={is5mGate} color={FIVE_M_COLOR} label="5m Trade" text="5M" onClick={(e) => { e.stopPropagation(); setFiveMModal({ symbol: item.symbol, exchange: fiveMEntryGate?.exchange ?? 'gate' }); }} />
                          <FavButton active={isGate}   color={GATE_COLOR}  label="Gate"      onClick={(e) => { e.stopPropagation(); toggleGateFavorite(item.symbol); }} />
                          <FavButton active={isMTGate} color={MT_COLOR}    label="MultiTrade" text="MT" onClick={(e) => { e.stopPropagation(); setMtModal({ symbol: item.symbol, exchange: 'gate', entries: mtEntriesGate }); }} />
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

      {/* Modal de configuração Trade Now */}
      {tradeModal && (
        <TradeConfigModal
          symbol={tradeModal.symbol}
          defaultExchange={tradeModal.exchange}
          isActive={tradeFavorites.has(tradeModal.symbol)}
          currentConfig={tradeConfigs?.get(tradeModal.symbol)}
          onConfirm={(config) => {
            if (tradeFavorites.has(tradeModal.symbol)) {
              updateTradeConfig(tradeModal.symbol, config);
            } else {
              toggleTradeFavorite(tradeModal.symbol, config);
            }
            setTradeModal(null);
          }}
          onRemove={() => {
            toggleTradeFavorite(tradeModal.symbol);
            setTradeModal(null);
          }}
          onCancel={() => setTradeModal(null)}
        />
      )}

      {/* Modal Multi-Trade */}
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

      {/* Modal 5m Trade */}
      {fiveMModal && (
        <FiveMTradeModal
          key={`5m-${fiveMModal.symbol}-${fiveMTradeFavorites.find(e => e.symbol === fiveMModal.symbol)?.id ?? 'new'}`}
          symbol={fiveMModal.symbol}
          defaultExchange={fiveMModal.exchange}
          isActive={!!fiveMTradeFavorites.find(e => e.symbol === fiveMModal.symbol)}
          currentEntry={fiveMTradeFavorites.find(e => e.symbol === fiveMModal.symbol)}
          onConfirm={async ({ exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths }) => {
            const existing = fiveMTradeFavorites.find(e => e.symbol === fiveMModal.symbol);
            await saveFiveMTradeEntry({
              id: existing?.id,
              symbol: fiveMModal.symbol,
              exchange,
              capital,
              rsiBuy,
              rsiSell,
              maFilters,
              stopLoss,
              recoveryPattern,
              sellScope,
              entryPrice,
              entryPaths,
            });
            setFiveMModal(null);
          }}
          onRemove={async () => {
            const existing = fiveMTradeFavorites.find(e => e.symbol === fiveMModal.symbol);
            if (existing?.id) await removeFiveMTradeEntry(existing.id);
            setFiveMModal(null);
          }}
          onCancel={() => setFiveMModal(null)}
        />
      )}
    </div>
  );
}
