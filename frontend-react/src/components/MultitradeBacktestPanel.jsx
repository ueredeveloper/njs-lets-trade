import { useEffect, useState, useCallback, useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchMultitradeBacktest, fetchCandlesticksAndCloud } from '../services/api';
import { ENTRY_MA_TRIGGERS } from '../constants/tradeConfigSchema';
import { ruleBadgeStyle } from '../utils/exitReasonFormat';

const MT_COLOR = '#8b5cf6';

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

function fmtDateTime(isoOrMs) {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildMarkersForRow(row, trades, msPerCandle) {
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
    markers.push({ time: sell.time, side: 'sell', price: sell.price });
  } else if (buy && ['STOP_LOSS_MA', 'STOP_LOSS_ADAPTIVE', 'SOLD_RSI'].includes(row.outcome)) {
    const fallbackSell = (trades ?? []).find(t => t.type === 'SELL' && t.time >= buy.time);
    if (fallbackSell) markers.push({ time: fallbackSell.time, side: 'sell', price: fallbackSell.price });
  }

  const focus = {
    signal: markers.find(m => m.side === 'signal') ?? null,
    buy: markers.find(m => m.side === 'buy') ?? null,
    sell: markers.find(m => m.side === 'sell') ?? null,
  };
  return { markers, focus, buy, sell, signalMs };
}

function isBlockedOutcome(outcome) {
  if (!outcome) return false;
  if (outcome.startsWith('MA_')) return true;
  if (outcome === 'THREE_CANDLES_BLOCKED' || outcome === 'FOUR_CANDLES_BLOCKED') return true;
  if (outcome.startsWith('CANCELLED')) return true;
  return false;
}

function TradeFocusBar({ focus }) {
  if (!focus?.signal && !focus?.buy && !focus?.sell) return null;
  const card = (kind, m) => {
    const styles = {
      signal: { color: '#f59e0b', label: '◆ Sinal', bg: 'rgba(245,158,11,0.12)' },
      buy:    { color: '#22c55e', label: '▲ Bought', bg: 'rgba(34,197,94,0.12)' },
      sell:   { color: '#ef4444', label: '▼ Sold', bg: 'rgba(239,68,68,0.12)' },
    }[kind];
    return (
      <div
        key={kind}
        id={`multitrade-focus-${kind}`}
        className="flex flex-col px-2 py-1 rounded text-[10px] font-mono leading-tight"
        style={{ background: styles.bg, border: `1px solid ${styles.color}55`, color: styles.color }}>
        <span className="font-bold">{styles.label}</span>
        <span className="text-p5">{fmtDateTime(m.time)}</span>
        <span className="text-p5/60">@ {fmtPrice(m.price)}</span>
      </div>
    );
  };
  return (
    <div id="multitrade-backtest-focus-bar" className="multitrade-backtest-focus-bar flex flex-wrap gap-2 mb-2">
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

function outcomeClass(outcome) {
  if (!outcome) return 'text-p5/50';
  if (outcome.startsWith('STOP_') || outcome === 'SOLD_RSI') {
    const pnl = outcome.includes('LOSS');
    return pnl ? 'text-red-400' : 'text-emerald-400';
  }
  if (outcome.startsWith('MA_') || outcome === 'THREE_CANDLES_BLOCKED') return 'text-amber-400';
  if (outcome.startsWith('CANCELLED')) return 'text-p5/40';
  if (outcome === 'BOUGHT' || outcome === 'POSITION_OPEN') return 'text-emerald-400';
  if (outcome === 'PENDING' || outcome === 'PENDING_OPEN') return 'text-sky-400';
  return 'text-p5/70';
}

function entryRuleStyle(row) {
  const ruleId = row.ruleId ?? (row.entryKind === 'ma' ? 'rule2' : row.entryKind === 'rsi' ? 'rule1' : null);
  return ruleBadgeStyle(ruleId);
}

function formatResultado(row) {
  if (row.exitDetail?.label) return row.exitDetail.label;
  if (row.outcomeLabel) return row.outcomeLabel;
  return row.outcome ?? '—';
}

function formatEntryPathsSummary(entry) {
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

const CANDLES_BEFORE = 10;

function fmtDate(isoOrMs) {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function findTradesForRow(row, trades, msPerCandle) {
  const signalMs = new Date(row.timeISO ?? row.time).getTime();
  let buy = (trades ?? []).find(
    t => t.type === 'BUY' && Math.abs(t.time - signalMs) < msPerCandle,
  );
  if (!buy) {
    buy = (trades ?? []).find(
      t => t.type === 'BUY' && t.time >= signalMs && t.time - signalMs < msPerCandle * 48,
    );
  }
  const sell = buy
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
      });
      setData(result);
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [entry?.symbol, entry?.exchange, entry?.capital]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setActiveRow(null);
    setFocusTrade(null);
    clearMultitradeChartView();
  }, [entry?.symbol, entry?.exchange, entry?.capital, clearMultitradeChartView]);

  const entryPathsSummary = useMemo(() => formatEntryPathsSummary(entry), [entry]);
  const dualEntryPaths = (entry?.entryRsiPath?.enabled !== false) && !!entry?.entryMa?.enabled;

  async function handleRowClick(row) {
    if (!entry?.symbol || !data) return;
    const rowKey = row.timeISO ?? String(row.time);
    setActiveRow(rowKey);
    setChartLoading(rowKey);

    const iv = entry.entryRsi?.interval ?? '15m';
    const msPerCandle = INTERVAL_MS[iv] ?? 900_000;
    const { entryMs, exitMs } = tradeZoomDates(row, data.trades, msPerCandle);
    const { markers, focus } = buildMarkersForRow(row, data.trades, msPerCandle);
    setFocusTrade(focus);

    // Busca histórico até cobrir entrada; zoom ±10 velas é aplicado no CandlestickChart
    const fetchFromMs = entryMs - CANDLES_BEFORE * msPerCandle;
    const needed = Math.min(3000, Math.max(266,
      Math.ceil((Date.now() - fetchFromMs) / msPerCandle) + 40));

    const src = entry.exchange === 'gate' ? 'gate' : null;
    const sym = entry.symbol.toUpperCase();

    try {
      const chartData = await fetchCandlesticksAndCloud(sym, iv, src, needed);
      applyMultitradeChartView({
        chartData,
        symbol: sym,
        interval: iv,
        exchangeSource: src,
        markers,
        entryMs,
        exitMs,
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
  const maLabels = (entry.maConditions ?? []).map(m => `MA${m.period} ${m.interval}`);
  const showExt  = entry.extension?.enabled !== false;

  return (
    <div id="multitrade-backtest-panel" className="multitrade-backtest-panel flex flex-col flex-1 min-h-0">
      <div className="multitrade-backtest-panel-header flex items-center justify-between px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: MT_COLOR }}>
            Análise histórica
          </span>
          <span className="font-mono text-[10px] text-p5/60 truncate">{entry.symbol}</span>
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
        {loading && !data && (
          <p className="multitrade-backtest-panel-loading text-[10px] text-p5/40 py-4 text-center">
            Simulando backtest…
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
              <span className="text-p5/50">Sinais RSI</span>
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
                  <span className="text-p5/70 col-span-1">{data.period.daysLbl} · {data.period.count} velas</span>
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
                  <tr className="multitrade-backtest-table-head" style={{ background: '#252836' }}>
                    <th className="text-left px-1.5 py-1 text-p5/50 font-normal">Data</th>
                    <th className="text-center px-1 py-1 text-p5/50 font-normal">Regra</th>
                    <th className="text-right px-1 py-1 text-p5/50 font-normal">RSI</th>
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
                    return (
                    <tr
                      key={rowKey ?? i}
                      id={`multitrade-backtest-row-${rowKey}`}
                      title="Clique para ver no gráfico"
                      onClick={() => handleRowClick(row)}
                      className={`multitrade-backtest-table-row border-t border-p2/50 cursor-pointer transition-colors ${
                        isActive ? 'bg-violet-500/10' : 'hover:bg-p2/40'
                      } ${isLoading ? 'opacity-60' : ''}`}>
                      <td className="px-1.5 py-0.5 text-p5/70 whitespace-nowrap">{fmtDate(row.timeISO ?? row.time)}</td>
                      <td className="px-1 py-0.5 text-center whitespace-nowrap">
                        {row.ruleShort || row.entryKindShort ? (
                          <span
                            className="inline-block px-1 py-px rounded text-[8px] font-bold uppercase tracking-wide"
                            style={{
                              color: kindStyle.color,
                              background: kindStyle.bg,
                              border: `1px solid ${kindStyle.border}`,
                            }}
                            title={row.entryKindLabel ?? row.ruleId ?? row.entryKind}>
                            {row.ruleShort ?? row.entryKindShort}
                          </span>
                        ) : (
                          <span className="text-p5/30">—</span>
                        )}
                      </td>
                      <td
                        className="px-1 py-0.5 text-right text-p5"
                        title={rsiCell.title ?? undefined}>
                        {rsiCell.value != null ? rsiCell.value.toFixed?.(1) ?? rsiCell.value : '—'}
                      </td>
                      <td className="px-1 py-0.5 text-right text-p5">{fmtPrice(row.price)}</td>
                      {maLabels.map(l => {
                        const m = (row.maChecks ?? []).find(x => x.label === l);
                        return (
                          <td key={l} className={`px-1 py-0.5 text-center ${m?.ok ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                            {m ? (m.ok ? '✓' : '✗') : '—'}
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
                      <td className={`px-1.5 py-0.5 ${outcomeClass(row.outcome)}`} title={row.outcomeShort ?? row.exitDetail?.short ?? undefined}>
                        <span className="block leading-snug">{resultado}</span>
                        {row.outcomeShort && row.exitDetail?.label && row.outcomeShort !== resultado && (
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
