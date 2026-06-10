import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud, fetchGateCurrencies, gatePreloadCandles, fetchBinanceTrades, fetchGateTrades } from '../services/api';
import { useI18n } from '../i18n';
import TradeConfigModal from './TradeConfigModal';

const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#fcd535';
const TRADE_COLOR   = '#00c076';
const ACTIVE_COLOR  = '#f59e0b';

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
    currencies, findFilter, selectedQuote, selectedChart, setSelectedChart, setChartZoom,
    gateFavorites, binanceFavorites, tradeFavorites, tradeConfigs,
    toggleGateFavorite, toggleBinanceFavorite, toggleTradeFavorite, updateTradeConfig,
    setTradePurchases, setAllTrades,
    activeTrades, refreshActiveTrades,
  } = useCurrency();
  const { t, formatPrice } = useI18n();
  const [loadingSymbol, setLoadingSymbol]       = useState(null);
  const [activeRow, setActiveRow]               = useState(null);
  const [tradeModalSymbol, setTradeModalSymbol] = useState(null); // símbolo com modal aberto
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
    } else if (activeFilter) {
      const filter = findFilter(activeFilter);
      if (filter) {
        const isMarket = activeFilter.startsWith('Mercado|');
        list = filter.list
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
  }, [currencies, activeFilter, selectedQuote, findFilter, search, showFavorites, gateFavorites, binanceFavorites, tradeFavorites, tradeConfigs, activeTrades, sortVolume, gateAll]);

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
              .filter(c => c.symbol.includes(term) && !binanceSymbols.has(c.symbol))
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
  }, [search, currencies.list]);

  // Carrega active trades ao entrar no filtro
  useEffect(() => {
    if (showFavorites !== 'active') return;
    refreshActiveTrades();
  }, [showFavorites, refreshActiveTrades]);

  // Carrega moedas Gate.io quando necessário para favoritos ou filtros de mercado
  useEffect(() => {
    const needGate = showFavorites === 'gate' || showFavorites === 'trade'
      || showFavorites === 'active'
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
      // Se source não foi informado, detecta Gate pelo fato de o símbolo não estar na lista Binance
      const isGateOnly = !currencies.list.some(c => c.symbol === item.symbol);
      const effectiveSource = source ?? (isGateOnly ? 'gate' : null);

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
            placeholder={t('table.search')}
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

          {/* Filtro Active Trades (posições abertas do bot) */}
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
              const isTrade    = tradeFavorites.has(item.symbol);
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
                      : 'hover:bg-p2/40 text-p5'
                  }`}
                >
                  <td className="pl-2">
                    <div className="flex items-center gap-1">
                      <FavButton active={isTrade}   color={TRADE_COLOR}   label="Trade"   onClick={(e) => { e.stopPropagation(); setTradeModalSymbol(item.symbol); }} />
                      <FavButton active={isGate}    color={GATE_COLOR}    label="Gate"    onClick={(e) => { e.stopPropagation(); toggleGateFavorite(item.symbol); }} />
                      <FavButton active={isBinance} color={BINANCE_COLOR} label="Binance" onClick={(e) => { e.stopPropagation(); toggleBinanceFavorite(item.symbol); }} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold">
                    <div className="flex flex-col">
                      <span>{base}<span className="opacity-40 font-normal text-[10px]">/{quote}</span></span>
                      {isActive && (
                        <span className="text-[9px] font-normal" style={{ color: ACTIVE_COLOR }}>
                          @{formatPrice(activeInfo.buyPrice)}
                          {activeInfo.phase === 'ABOVE_70' && ' ▲70'}
                        </span>
                      )}
                      {(isActive || isTrade) && tradeConfig && (
                        <span className="text-[9px] font-normal text-p5/50">
                          {tradeConfig.interval} · &lt;{tradeConfig.rsiBuy} &gt;{tradeConfig.rsiSell}
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
                  const isGate  = gateFavorites.has(item.symbol);
                  const isTrade = tradeFavorites.has(item.symbol);
                  return (
                    <tr
                      key={`gate-${item.symbol}`}
                      onClick={() => handleSelect(item, 'gate')}
                      className={`border-b border-p2/30 cursor-pointer transition-colors ${
                        activeRow === item.symbol
                          ? 'bg-p2/80 text-white'
                          : isTrade
                          ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-p5'
                          : 'hover:bg-p2/40 text-p5'
                      }`}
                    >
                      <td className="pl-2">
                        <div className="flex items-center gap-1">
                          <FavButton active={isTrade} color={TRADE_COLOR} label="Trade" onClick={(e) => { e.stopPropagation(); setTradeModalSymbol(item.symbol); }} />
                          <FavButton active={isGate}  color={GATE_COLOR}  label="Gate"  onClick={(e) => { e.stopPropagation(); toggleGateFavorite(item.symbol); }} />
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
      {tradeModalSymbol && (
        <TradeConfigModal
          symbol={tradeModalSymbol}
          isActive={tradeFavorites.has(tradeModalSymbol)}
          currentConfig={tradeConfigs?.get(tradeModalSymbol)}
          onConfirm={(config) => {
            if (tradeFavorites.has(tradeModalSymbol)) {
              updateTradeConfig(tradeModalSymbol, config);
            } else {
              toggleTradeFavorite(tradeModalSymbol, config);
            }
            setTradeModalSymbol(null);
          }}
          onRemove={() => {
            toggleTradeFavorite(tradeModalSymbol);
            setTradeModalSymbol(null);
          }}
          onCancel={() => setTradeModalSymbol(null)}
        />
      )}
    </div>
  );
}
