import { useEffect, useState, useCallback, useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchMultitradeBacktest, fetchCandlesticksAndCloud } from '../services/api';
import { ENTRY_MA_TRIGGERS } from '../constants/tradeConfigSchema';
import { STRATEGY_LABELS, STRATEGY_COLORS, normalizeStrategyId, isMaCrossStrategy } from '../constants/strategyPresets';
import { ruleBadgeStyle, formatBacktestOutcome } from '../utils/exitReasonFormat';
import { tradeFetchPlan, isMaCrossEntry, formatMaCrossEntrySummary } from '../utils/multitradeChart';

const MT_COLOR = '#8b5cf6';

function fmtDateTime(isoOrMs) {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildMarkersForRow(row, trades, msPerCandle, entry) {
  if (isMaCrossEntry(entry)) return buildMarkersForMaCrossRow(row, trades, msPerCandle);
  const { buy, sell, signalMs } = findTradesForRow(row, trades, msPerCandle);
  const markers = [];

  // Sempre: possível compra no momento do sinal RSI (bloqueado ou não)
  markers.push({
    time: signalMs,
    side: 'signal',
    price: row.price,
    outcome: row.outcome,
  });

  if (buy) {
    const sameCandle = Math.abs(buy.time - signalMs) < msPerCandle * 0.5;
    if (!sameCandle) {
      markers.push({ time: buy.time, side: 'buy', price: buy.price });
    } else if (!isBlockedOutcome(row.outcome)) {
      markers.push({ time: buy.time, side: 'buy', price: buy.price });
    }
  }

  if (sell) {
    markers.push({
      time: sell.time,
      side: 'sell',
      price: sell.price,
      pnlPct: row.pnlPct != null ? Number(row.pnlPct) : null,
    });
  } else if (buy && ['STOP_LOSS_MA', 'STOP_LOSS_ADAPTIVE', 'STOP_LOSS_PCT_CAP', 'SOLD_RSI'].includes(row.outcome)) {
    const fallbackSell = (trades ?? []).find(t => t.type === 'SELL' && t.time >= buy.time);
    if (fallbackSell) {
      markers.push({
        time: fallbackSell.time,
        side: 'sell',
        price: fallbackSell.price,
        pnlPct: fallbackSell.pnlPct != null ? Number(fallbackSell.pnlPct) : (row.pnlPct != null ? Number(row.pnlPct) : null),
      });
    }
  }

  const focus = {
    signal: markers.find(m => m.side === 'signal') ?? null,
    buy: markers.find(m => m.side === 'buy') ?? null,
    sell: markers.find(m => m.side === 'sell') ?? null,
  };
  return { markers, focus, buy, sell, signalMs };
}

function buildMarkersForMaCrossRow(row, trades, msPerCandle) {
  const { buy, sell, signalMs } = findTradesForRow(row, trades, msPerCandle);
  const markers = [{
    time: signalMs,
    side: row.outcome === 'BOUGHT' || row.outcome === 'POSITION_OPEN' ? 'entry' : 'possible_entry',
    price: row.price,
    outcome: row.outcome,
  }];

  if (buy && Math.abs(buy.time - signalMs) >= msPerCandle * 0.25) {
    markers.push({ time: buy.time, side: 'buy', price: buy.price });
  }
  if (sell) {
    markers.push({
      time: sell.time,
      side: 'sell',
      price: sell.price,
      pnlPct: row.pnlPct != null ? Number(row.pnlPct) : null,
    });
  }

  const focus = {
    entry: markers.find(m => m.side === 'entry' || m.side === 'possible_entry') ?? null,
    buy: markers.find(m => m.side === 'buy') ?? null,
    sell: markers.find(m => m.side === 'sell') ?? null,
  };
  return { markers, focus, buy, sell, signalMs };
}

function isBlockedOutcome(outcome) {
  if (!outcome) return false;
  if (outcome.startsWith('MA_')) return true;
  if (['NOT_ABOVE_MA', 'NOT_BELOW_MA', 'BELOW_ADAPTIVE_FLOOR', 'FILTER_NO_MA'].includes(outcome)) return true;
  if (outcome === 'THREE_CANDLES_BLOCKED' || outcome === 'FOUR_CANDLES_BLOCKED') return true;
  if (outcome.startsWith('CANCELLED')) return true;
  return false;
}

function TradeFocusBar({ focus }) {
  if (!focus?.signal && !focus?.buy && !focus?.sell && !focus?.entry) return null;
  const card = (kind, m) => {
    const styles = {
      signal: { color: '#f59e0b', label: '◆ Sinal', bg: 'rgba(245,158,11,0.12)' },
      entry:  { color: '#ffffff', label: '▌ Entrada', bg: 'rgba(255,255,255,0.08)' },
      buy:    { color: '#22c55e', label: '▲ Bought', bg: 'rgba(34,197,94,0.12)' },
      sell:   { color: '#ef4444', label: '▼ Sold', bg: 'rgba(239,68,68,0.12)' },
    }[kind];
    return (
      <div
        key={kind}
        id={`multitrade-focus-${kind}`}
        className="px-2 py-1 rounded text-[10px] font-mono leading-tight whitespace-nowrap truncate max-w-full"
        style={{ background: styles.bg, border: `1px solid ${styles.color}55`, color: styles.color }}
        title={`${styles.label} ${fmtDateTime(m.time)} @ ${fmtPrice(m.price)}`}>
        <span className="font-bold">{styles.label}</span>
        <span className="text-p5"> {fmtDateTime(m.time)} @ {fmtPrice(m.price)}</span>
      </div>
    );
  };
  return (
    <div id="multitrade-backtest-focus-bar" className="multitrade-backtest-focus-bar flex flex-wrap gap-2 mb-2">
      {focus.entry && card('entry', focus.entry)}
      {focus.signal && card('signal', focus.signal)}
      {focus.buy && card('buy', focus.buy)}
      {focus.sell && card('sell', focus.sell)}
    </div>
  );
}

function fmtPrice(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (v < 0.01) return v.toFixed(6);
  if (v < 1) return v.toFixed(4);
  return v.toFixed(2);
}

function fmtMaFilterPct(pct) {
  if (pct == null) return '—';
  return `${pct}%`;
}

function maFilterPctClass(pct) {
  if (pct == null) return 'text-p5/40';
  if (pct >= 70) return 'text-emerald-400';
  if (pct >= 45) return 'text-p5';
  if (pct >= 25) return 'text-amber-400';
  return 'text-red-400';
}

function outcomeClass(row) {
  const outcome = typeof row === 'string' ? row : row?.outcome;
  const pnlPct = typeof row === 'object' ? row?.pnlPct : null;
  if (!outcome) return 'text-p5/50';
  if (pnlPct != null) {
    return pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400';
  }
  if (outcome.startsWith('STOP_') || outcome === 'SOLD_RSI') {
    return outcome.includes('LOSS') ? 'text-red-400' : 'text-emerald-400';
  }
  if (outcome.startsWith('MA_') || outcome === 'THREE_CANDLES_BLOCKED') return 'text-amber-400';
  if (outcome.startsWith('CANCELLED')) return 'text-p5/40';
  if (outcome === 'BOUGHT' || outcome === 'POSITION_OPEN') return 'text-emerald-400';
  if (outcome === 'PENDING' || outcome === 'PENDING_OPEN') return 'text-sky-400';
  return 'text-p5/70';
}

function entryRuleStyle(row) {
  if (row.entryKind === 'ma_cross') {
    return { color: '#22d3ee', bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.35)' };
  }
  const ruleId = row.ruleId ?? (row.entryKind === 'ma' ? 'rule2' : row.entryKind === 'rsi' ? 'rule1' : null);
  return ruleBadgeStyle(ruleId);
}

function maCheckCell(m) {
  if (!m) return { glyph: '—', className: 'text-p5/30', title: null };
  if (m.ok) return { glyph: '✓', className: 'text-emerald-400/80', title: m.detail ?? 'OK' };
  if (m.detail === 'sem dados') {
    return { glyph: '?', className: 'text-amber-400/90', title: `${m.label}: histórico insuficiente (precisa ≥50 velas)` };
  }
  return { glyph: '✗', className: 'text-red-400/80', title: m.detail ?? `${m.label}: bloqueado` };
}

function formatResultado(row) {
  return formatBacktestOutcome(row).label;
}

function formatResultadoDetail(row) {
  return formatBacktestOutcome(row).detail;
}

function formatResultadoTitle(row) {
  return formatBacktestOutcome(row).title;
}

function formatEntryPathsSummary(entry) {
  if (isMaCrossEntry(entry)) return formatMaCrossEntrySummary(entry);
  if (!entry) return null;
  const parts = [];
  if (entry.entryRsiPath?.enabled !== false) {
    const r = entry.entryRsi ?? {};
    parts.push(`RSI(${r.interval ?? '15m'}) ${r.operator ?? '<'} ${r.value ?? 30}`);
  }
  if (entry.entryMa?.enabled) {
    const m = entry.entryMa;
    const tr = ENTRY_MA_TRIGGERS.find(t => t.id === m.trigger)?.label ?? m.trigger ?? 'toque';
    let lbl = `MA${m.period ?? 50} ${m.interval ?? '1h'} (${tr})`;
    if (m.requireRsi) {
      const r = m.entryRsi ?? {};
      lbl += ` + RSI ${r.operator ?? '<'} ${r.value ?? 40}`;
    }
    parts.push(lbl);
  }
  return parts.length ? parts.join('  OU  ') : null;
}

function displayRsiForRow(row, entry) {
  if (row.entryKind === 'ma') {
    if (entry?.entryMa?.requireRsi && row.maPathRsi != null) {
      return { value: row.maPathRsi, title: 'RSI do caminho MA' };
    }
    return { value: null, title: 'Entrada por MA — RSI não exigido neste caminho' };
  }
  if (row.rsi != null) return { value: row.rsi, title: 'RSI do caminho RSI' };
  return { value: null, title: null };
}

function fmtDate(isoOrMs) {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function findTradesForRow(row, trades, msPerCandle) {
  const signalMs = new Date(row.timeISO ?? row.time).getTime();
  let buy = row.buyTime
    ? { time: row.buyTime, price: row.buyPrice ?? row.price }
    : null;
  if (!buy) {
    buy = (trades ?? []).find(
      t => t.type === 'BUY' && Math.abs(t.time - signalMs) < msPerCandle,
    );
  }
  if (!buy) {
    buy = (trades ?? []).find(
      t => t.type === 'BUY' && t.time >= signalMs && t.time - signalMs < msPerCandle * 48,
    );
  }
  const sell = row.exitTime
    ? { time: row.exitTime, price: row.exitPrice ?? null }
    : buy
      ? (trades ?? []).find(t => t.type === 'SELL' && t.time >= buy.time)
      : null;
  return { buy, sell, signalMs };
}

function tradeZoomDates(row, trades, msPerCandle) {
  const { buy, sell, signalMs } = findTradesForRow(row, trades, msPerCandle);
  return {
    entryMs: signalMs,
    exitMs:  sell?.time ?? signalMs,
    signalMs,
    buy,
    sell,
  };
}

export default function MultitradeBacktestPanel({ entry }) {
  const { applyMultitradeChartView, clearMultitradeChartView } = useCurrency();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [activeRow, setActiveRow] = useState(null);
  const [chartLoading, setChartLoading] = useState(null);
  const [focusTrade, setFocusTrade] = useState(null);

  const load = useCallback(async () => {
    if (!entry?.symbol) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMultitradeBacktest({
        symbol: entry.symbol,
        exchange: entry.exchange,
        capital: entry.capital,
        strategyId: entry.strategyId,
      });
      setData(result);
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [entry?.symbol, entry?.exchange, entry?.capital, entry?.strategyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setData(null);
    setError(null);
    setActiveRow(null);
    setFocusTrade(null);
    clearMultitradeChartView();
  }, [entry?.id, entry?.strategyId, entry?.symbol, entry?.exchange, entry?.capital, clearMultitradeChartView]);

  const entryPathsSummary = useMemo(() => formatEntryPathsSummary(entry), [entry]);
  const dualEntryPaths = (entry?.entryRsiPath?.enabled !== false) && !!entry?.entryMa?.enabled;

  async function handleRowClick(row) {
    if (!entry?.symbol || !data) return;
    const rowKey = row.timeISO ?? String(row.time);
    setActiveRow(rowKey);
    setChartLoading(rowKey);

    const signalMs = new Date(row.timeISO ?? row.time).getTime();
    const plan = tradeFetchPlan(entry, row, signalMs);
    const { entryMs, exitMs } = tradeZoomDates(row, data.trades, plan.msPerCandle);
    const { markers, focus } = buildMarkersForRow(row, data.trades, plan.msPerCandle, entry);
    setFocusTrade(focus);

    const src = entry.exchange === 'gate' ? 'gate' : null;
    const sym = entry.symbol.toUpperCase();

    try {
      const chartData = await fetchCandlesticksAndCloud(sym, plan.interval, src, plan.candleLimit);
      applyMultitradeChartView({
        chartData,
        symbol: sym,
        interval: plan.interval,
        exchangeSource: src,
        markers,
        entryMs,
        exitMs,
        fetchFromMs: plan.fetchFromMs,
        candleLimit: plan.candleLimit,
        overlaySlots: plan.overlaySlots,
      });
    } catch (err) {
      console.warn('[MultitradeBacktest] chart zoom:', err.message);
      clearMultitradeChartView();
      setFocusTrade(null);
    } finally {
      setChartLoading(null);
    }
  }

  if (!entry) return null;

  const s = data?.summary;
  const maCross = isMaCrossStrategy(entry?.strategyId);
  const maFilterStats = data?.maFilterStats ?? [];
  const maLabels = maCross
    ? (entry.maFilters ?? []).filter(f => f.enabled !== false && f.mode !== 'off').map(f => `EMA${f.period} ${f.interval}`)
    : (entry.maConditions ?? []).map(m => `MA${m.period} ${m.interval}`);
  const showExt  = !maCross && entry.extension?.enabled !== false;

  return (
    <div id="multitrade-backtest-panel" className="multitrade-backtest-panel flex flex-col flex-1 min-h-0">
      <div className="multitrade-backtest-panel-header flex items-center justify-between px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: MT_COLOR }}>
            Análise histórica
          </span>
          <span className="font-mono text-[10px] text-p5/60 truncate">{entry.symbol}</span>
          {entry.strategyId && (
            <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0"
              style={{
                background: `${STRATEGY_COLORS[normalizeStrategyId(entry.strategyId)] ?? MT_COLOR}33`,
                color: STRATEGY_COLORS[normalizeStrategyId(entry.strategyId)] ?? MT_COLOR,
              }}>
              {STRATEGY_LABELS[normalizeStrategyId(entry.strategyId)] ?? entry.strategyId}
            </span>
          )}
        </div>
        <button
          id="multitrade-backtest-panel-btn-refresh"
          type="button"
          onClick={load}
          disabled={loading}
          className="multitrade-backtest-panel-btn-refresh text-[10px] px-2 py-0.5 rounded shrink-0 disabled:opacity-50"
          style={{ background: '#2a2d3a', color: '#94a3b8', border: '1px solid #3a3d4a' }}>
          {loading ? '…' : '↻'}
        </button>
      </div>

      <div className="multitrade-backtest-panel-body flex-1 overflow-y-auto min-h-0 px-2 pb-2">
        {loading && !data && !error && (
          <p className="multitrade-backtest-panel-loading text-[10px] text-p5/40 py-4 text-center">
            Simulando backtest{entry.strategyId ? ` (${STRATEGY_LABELS[normalizeStrategyId(entry.strategyId)] ?? entry.strategyId})` : ''}…
          </p>
        )}
        {error && (
          <p className="multitrade-backtest-panel-error text-[10px] text-red-400 py-2">{error}</p>
        )}

        {s && (
          <>
            {/* Resumo */}
            <div className="multitrade-backtest-summary grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono mb-2 p-2 rounded"
              style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}>
              {entryPathsSummary && (
                <>
                  <span className="text-p5/50">Entradas</span>
                  <span className="text-p5/80 leading-snug" title={data?.config?.entryPaths ?? entryPathsSummary}>
                    {data?.config?.entryPaths ?? entryPathsSummary}
                    {dualEntryPaths && (
                      <span className="text-p5/40"> · 2 caminhos</span>
                    )}
                  </span>
                </>
              )}
              {maCross && data?.config?.exitCross && (
                <>
                  <span className="text-p5/50">Saída</span>
                  <span className="text-p5/80">{data.config.exitCross}</span>
                </>
              )}
              {entry.entryRsi && !maCross && (
                <>
                  <span className="text-p5/50">RSI entrada</span>
                  <span className="text-p5">
                    {entry.entryRsi.interval} {entry.entryRsi.operator ?? '<'} {entry.entryRsi.value}
                    {' · saída '}
                    {entry.exitRsi?.interval} &gt; {entry.exitRsi?.value}
                  </span>
                </>
              )}
              <span className="text-p5/50">Capital</span>
              <span className="text-p5">${s.startCapital} → ${s.endCapital}
                <span className={s.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {' '}({s.totalPnlPct >= 0 ? '+' : ''}{s.totalPnlPct}%)
                </span>
              </span>
              <span className="text-p5/50">Trades</span>
              <span className="text-p5">{s.trades} · win {s.winRate ?? '—'}%</span>
              <span className="text-p5/50">PnL</span>
              <span className={s.totalPnlUsdt >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {s.totalPnlUsdt >= 0 ? '+' : ''}${s.totalPnlUsdt}
              </span>
              <span className="text-p5/50">{maCross ? 'Cruzamentos' : 'Sinais RSI'}</span>
              <span className="text-p5">{s.entrySignals} · bloq. {s.blockedCount}</span>
              {(s.stopMaCount > 0 || s.stopAdaptCount > 0) && (
                <>
                  <span className="text-p5/50">Stops</span>
                  <span className="text-p5">MA {s.stopMaCount} · adapt {s.stopAdaptCount}</span>
                </>
              )}
              {data.period && (
                <>
                  <span className="text-p5/50">Período</span>
                  <span className="text-p5/70 col-span-1">
                    {data.period.daysLbl} · {data.period.count} velas {data.period.interval ?? ''}
                  </span>
                </>
              )}
              {maFilterStats.length > 0 && (
                <>
                  <span className="text-p5/50 col-span-2 pt-1 border-t border-p2/40 mt-0.5">
                    Tempo acima da MA
                    <span className="text-p5/30 font-normal normal-case tracking-normal ml-1">
                      — histórico máximo disponível
                    </span>
                  </span>
                  {maFilterStats.map(stat => {
                    const abovePct = stat.pctAboveMa ?? stat.pct;
                    const aboveMet = stat.aboveMaMet ?? stat.met;
                    const aboveTotal = stat.aboveMaTotal ?? stat.total;
                    const showAdaptive = stat.mode === 'adaptive'
                      && stat.pctFilterMet != null
                      && stat.pctFilterMet !== abovePct;
                    return (
                      <span key={stat.label} className="contents">
                        <span
                          className="text-p5/50"
                          title={stat.periodDaysLbl
                            ? `Close > MA50 no histórico de ${stat.periodDaysLbl} (${aboveTotal} velas ${stat.interval})`
                            : 'Close acima da EMA — igual ao gráfico Binance'}>
                          {stat.label.replace(' ', '\u00a0')}
                          {stat.periodDaysLbl && (
                            <span className="text-p5/30 font-normal ml-1">{stat.periodDaysLbl}</span>
                          )}
                        </span>
                        <span
                          className={maFilterPctClass(abovePct)}
                          title={stat.detail ?? `Close > MA em ${aboveMet}/${aboveTotal} velas de ${stat.interval}`}>
                          {fmtMaFilterPct(abovePct)}
                          {abovePct != null && (
                            <span className="text-p5/35 font-normal ml-1">
                              ({aboveMet}/{aboveTotal} velas {stat.interval})
                            </span>
                          )}
                          {showAdaptive && (
                            <span
                              className="block text-[8px] text-violet-400/80 font-normal leading-snug mt-px"
                              title={`Critério do bot: close ≥ piso adaptativo (−${stat.dipPct}%)`}>
                              piso adapt −{stat.dipPct}%: {fmtMaFilterPct(stat.pctFilterMet)}
                              {' '}({stat.filterMet}/{stat.filterTotal} velas {stat.interval})
                            </span>
                          )}
                        </span>
                      </span>
                    );
                  })}
                </>
              )}
            </div>

            <TradeFocusBar focus={focusTrade} />

              {data.entryLogTruncated && (
                <p className="text-[9px] text-amber-400/80 mb-1">
                  Mostrando {data.entryLog?.length} de {data.entryLogTotal} sinais (lista reduzida)
                </p>
              )}
            {/* Tabela de sinais */}
            <div className="multitrade-backtest-table-wrap overflow-x-auto rounded"
              style={{ border: '1px solid #2a2d3a' }}>
              <table id="multitrade-backtest-table" className="multitrade-backtest-table w-full text-[9px] font-mono">
                <thead>
                  <tr className="multitrade-backtest-table-head lt-table-head" style={{ background: '#252836' }}>
                    <th className="text-left px-1.5 py-1 text-p5/50 font-normal">Entrada</th>
                    <th className="text-left px-1.5 py-1 text-p5/50 font-normal">Saída</th>
                    <th className="text-center px-1 py-1 text-p5/50 font-normal">{maCross ? 'Cruz.' : 'Regra'}</th>
                    {!maCross && (
                      <th className="text-right px-1 py-1 text-p5/50 font-normal">RSI</th>
                    )}
                    {maCross && (
                      <>
                        <th className="text-right px-1 py-1 text-p5/50 font-normal">EMA9</th>
                        <th className="text-right px-1 py-1 text-p5/50 font-normal">EMA21</th>
                      </>
                    )}
                    <th className="text-right px-1 py-1 text-p5/50 font-normal">Preço</th>
                    {maLabels.map(l => (
                      <th key={l} className="text-center px-1 py-1 text-p5/50 font-normal">{l.replace(' ', '\u00a0')}</th>
                    ))}
                    {showExt && (
                      <>
                        <th className="text-center px-1 py-1 text-p5/50 font-normal">Ext</th>
                        <th className="text-center px-1 py-1 text-p5/50 font-normal">3🕯</th>
                        <th className="text-center px-1 py-1 text-p5/50 font-normal">4🕯</th>
                      </>
                    )}
                    <th className="text-left px-1.5 py-1 text-p5/50 font-normal">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.entryLog ?? []).map((row, i) => {
                    const rowKey = row.timeISO ?? String(row.time);
                    const isActive = activeRow === rowKey;
                    const isLoading = chartLoading === rowKey;
                    const kindStyle = entryRuleStyle(row);
                    const rsiCell = displayRsiForRow(row, entry);
                    const resultado = formatResultado(row);
                    const resultadoDetail = formatResultadoDetail(row);
                    const resultadoTitle = formatResultadoTitle(row);
                    return (
                    <tr
                      key={rowKey ?? i}
                      id={`multitrade-backtest-row-${rowKey}`}
                      title="Clique para ver no gráfico"
                      onClick={() => handleRowClick(row)}
                      className={`multitrade-backtest-table-row lt-table-row cursor-pointer transition-colors ${
                        isActive ? 'bg-violet-500/10' : 'hover:bg-p2/40'
                      } ${isLoading ? 'opacity-60' : ''}`}>
                      <td className="px-1.5 py-0.5 text-p5/70 whitespace-nowrap">{fmtDate(row.timeISO ?? row.time)}</td>
                      <td className="px-1.5 py-0.5 text-p5/50 whitespace-nowrap">
                        {row.exitTimeISO ?? row.exitTime ? fmtDate(row.exitTimeISO ?? row.exitTime) : '—'}
                      </td>
                      <td className="px-1 py-0.5 text-center whitespace-nowrap">
                        {row.entryKindShort || row.ruleShort || row.entryKindShort ? (
                          <span
                            className="inline-block px-1 py-px rounded text-[8px] font-bold uppercase tracking-wide"
                            style={{
                              color: kindStyle.color,
                              background: kindStyle.bg,
                              border: `1px solid ${kindStyle.border}`,
                            }}
                            title={row.entryKindLabel ?? row.ruleId ?? row.entryKind}>
                            {row.entryKindShort ?? row.ruleShort ?? row.entryKindShort}
                          </span>
                        ) : (
                          <span className="text-p5/30">—</span>
                        )}
                      </td>
                      {!maCross && (
                      <td
                        className="px-1 py-0.5 text-right text-p5"
                        title={rsiCell.title ?? undefined}>
                        {rsiCell.value != null ? rsiCell.value.toFixed?.(1) ?? rsiCell.value : '—'}
                      </td>
                      )}
                      {maCross && (
                        <>
                          <td className="px-1 py-0.5 text-right text-p5">{fmtPrice(row.ma1)}</td>
                          <td className="px-1 py-0.5 text-right text-p5">{fmtPrice(row.ma2)}</td>
                        </>
                      )}
                      <td className="px-1 py-0.5 text-right text-p5">{fmtPrice(row.price)}</td>
                      {maLabels.map(l => {
                        const m = (row.maChecks ?? []).find(x => x.label === l);
                        const cell = maCheckCell(m);
                        return (
                          <td key={l} className={`px-1 py-0.5 text-center ${cell.className}`} title={cell.title ?? undefined}>
                            {cell.glyph}
                          </td>
                        );
                      })}
                      {showExt && (
                        <>
                          <td className="px-1 py-0.5 text-center text-p5/60">
                            {row.extension?.extended ? 'sim' : '—'}
                          </td>
                          <td className="px-1 py-0.5 text-center text-p5/60">
                            {row.extension?.extended ? (row.extension.threeOk ? '✓' : '✗') : '—'}
                          </td>
                          <td className="px-1 py-0.5 text-center text-p5/60">
                            {row.extension?.extended ? (row.extension.fourOk ? '✓' : '✗') : '—'}
                          </td>
                        </>
                      )}
                      <td className={`px-1.5 py-0.5 ${outcomeClass(row)}`} title={resultadoTitle ?? undefined}>
                        <span className="block leading-snug">{resultado}</span>
                        {resultadoDetail && (
                          <span className="block text-[8px] text-p5/45 font-normal leading-snug mt-px">
                            {resultadoDetail}
                          </span>
                        )}
                        {!resultadoDetail && row.outcomeShort && row.exitDetail?.label && row.outcomeShort !== resultado && (
                          <span className="block text-[8px] text-p5/40 font-normal">{row.outcomeShort}</span>
                        )}
                        {row.pnlPct != null && (
                          <span className="ml-1 opacity-80">
                            ({row.pnlPct >= 0 ? '+' : ''}{row.pnlPct}%)
                          </span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                  <tr className="lt-table-foot" aria-hidden="true">
                    <td colSpan={99} className="h-px p-0 leading-none" />
                  </tr>
                </tbody>
              </table>
            </div>

            {data.command && (
              <p className="multitrade-backtest-cmd text-[9px] text-p5/25 mt-1.5 font-mono truncate" title={data.command}>
                {data.command}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
