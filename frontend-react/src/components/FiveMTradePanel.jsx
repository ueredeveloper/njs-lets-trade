import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud, fetchFiveMTradeSignals } from '../services/api';
import {
  buildMarkerForFiveMSignal,
  buildOverlaySlotsForFiveMEntry,
  fiveMSignalFetchPlan,
  FIVE_M_ENTRY_EVENT_TYPES,
} from '../utils/fiveMTradeChart';

const FIVE_M_COLOR = '#06b6d4';

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtPrice(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (v < 0.01) return v.toFixed(6);
  if (v < 1) return v.toFixed(4);
  return v.toFixed(2);
}

function eventLabel(type) {
  if (type === 'entry') return { text: 'ENTRADA', color: '#ffffff', solid: true };
  if (type === 'possible_entry') return { text: 'ENTRADA PRONTA', color: '#e2e8f0', solid: false };
  return { text: type, color: '#94a3b8', solid: true };
}

function pathLabel(path) {
  if (path === 'ma50_5m') return 'MA50 5m';
  if (path === 'rsi') return 'RSI';
  return path ?? '—';
}

function phaseBadge(phase) {
  if (phase === 'BOUGHT') return { text: 'posição', color: '#22c55e' };
  return { text: 'watch', color: '#94a3b8' };
}

export default function FiveMTradePanel() {
  const {
    fiveMTradeFavorites,
    selectedChart,
    applyFiveMTradeChartView,
    clearFiveMTradeChartView,
  } = useCurrency();

  const [pickedSymbol, setPickedSymbol] = useState(null);
  const [favOpen, setFavOpen] = useState(false);
  const [signals, setSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState(null);
  const [activeSignalId, setActiveSignalId] = useState(null);
  const [chartLoading, setChartLoading] = useState(null);

  const chartSymbol = selectedChart?.symbol?.toUpperCase?.() ?? null;
  const symbolList = useMemo(
    () => [...new Set((fiveMTradeFavorites ?? []).map(e => e.symbol?.toUpperCase()).filter(Boolean))].sort(),
    [fiveMTradeFavorites],
  );

  const activeSymbol = pickedSymbol ?? chartSymbol ?? symbolList[0] ?? null;

  const activeEntry = useMemo(
    () => (fiveMTradeFavorites ?? []).find(e => e.symbol?.toUpperCase() === activeSymbol) ?? null,
    [fiveMTradeFavorites, activeSymbol],
  );

  const entrySignals = useMemo(
    () => (signals ?? []).filter(s => FIVE_M_ENTRY_EVENT_TYPES.has(s.event_type)),
    [signals],
  );

  const loadSignals = useCallback(async (sym) => {
    if (!sym) {
      setSignals([]);
      return;
    }
    setSignalsLoading(true);
    setSignalsError(null);
    try {
      const rows = await fetchFiveMTradeSignals({ symbol: sym, limit: 100 });
      setSignals(rows ?? []);
    } catch (err) {
      setSignalsError(err.message);
      setSignals([]);
    } finally {
      setSignalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSymbol) loadSignals(activeSymbol);
  }, [activeSymbol, loadSignals]);

  function pickSymbol(sym) {
    setPickedSymbol(sym);
    setActiveSignalId(null);
    setFavOpen(false);
    clearFiveMTradeChartView();
  }

  async function handleSignalClick(signal) {
    if (!activeEntry?.symbol || !signal?.event_time) return;
    setActiveSignalId(signal.id);
    setChartLoading(signal.id);

    const eventMs = new Date(signal.event_time).getTime();
    const plan = fiveMSignalFetchPlan(eventMs);
    const overlaySlots = buildOverlaySlotsForFiveMEntry(activeEntry);
    const markers = buildMarkerForFiveMSignal(signal);
    const src = activeEntry.exchange === 'gate' ? 'gate' : null;
    const sym = activeEntry.symbol.toUpperCase();

    try {
      const chartData = await fetchCandlesticksAndCloud(sym, plan.interval, src, plan.candleLimit);
      applyFiveMTradeChartView({
        chartData,
        symbol: sym,
        interval: plan.interval,
        exchangeSource: src,
        markers,
        entryMs: plan.entryMs,
        exitMs: plan.exitMs,
        fetchFromMs: plan.fetchFromMs,
        candleLimit: plan.candleLimit,
        overlaySlots,
      });
    } catch (err) {
      console.warn('[FiveMTradePanel] chart:', err.message);
      clearFiveMTradeChartView();
      setActiveSignalId(null);
    } finally {
      setChartLoading(null);
    }
  }

  return (
    <div id="five-m-trade-panel" className="five-m-trade-panel flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-p2 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-p5 uppercase tracking-wider shrink-0">5m Trade</span>
          {symbolList.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
              style={{ background: `${FIVE_M_COLOR}22`, color: FIVE_M_COLOR, border: `1px solid ${FIVE_M_COLOR}44` }}>
              {symbolList.length}
            </span>
          )}
          {activeSymbol && (
            <span className="text-[9px] font-mono text-p5/50 truncate hidden sm:inline">{activeSymbol}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setFavOpen(v => !v)}
            className="text-[10px] px-2 py-1 rounded font-semibold transition-colors"
            style={{
              background: favOpen ? `${FIVE_M_COLOR}33` : '#2a2d3a',
              color: favOpen ? FIVE_M_COLOR : '#94a3b8',
              border: `1px solid ${favOpen ? FIVE_M_COLOR : '#3a3d4a'}`,
            }}>
            ★ Moedas
          </button>
          <button
            type="button"
            onClick={() => activeSymbol && loadSignals(activeSymbol)}
            disabled={!activeSymbol || signalsLoading}
            className="text-[10px] px-2 py-1 rounded font-semibold transition-colors disabled:opacity-50"
            style={{ background: '#2a2d3a', color: '#94a3b8', border: '1px solid #3a3d4a' }}>
            {signalsLoading ? '…' : '↻'}
          </button>
        </div>
      </div>

      {favOpen && (
        <div className="border-b border-p2 shrink-0 max-h-40 overflow-y-auto">
          {symbolList.length === 0 ? (
            <p className="text-[10px] text-p5/40 px-3 py-3 text-center">
              Nenhuma moeda em five_min_bot_state — use o botão 5M na tabela
            </p>
          ) : (
            <ul className="divide-y divide-p2/50">
              {symbolList.map(sym => {
                const entry = fiveMTradeFavorites.find(e => e.symbol?.toUpperCase() === sym);
                const active = activeSymbol === sym;
                const ph = phaseBadge(entry?.phase);
                return (
                  <li
                    key={sym}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${active ? 'bg-cyan-500/10' : 'hover:bg-p2/40'}`}
                    onClick={() => pickSymbol(sym)}>
                    <span className="font-mono text-[10px] font-bold text-p5 flex-1 min-w-0 truncate">{sym}</span>
                    <span className="text-[8px] font-mono px-1 py-0.5 rounded shrink-0"
                      style={{ background: `${ph.color}22`, color: ph.color }}>
                      {ph.text}
                    </span>
                    {entry?.exchange && (
                      <span className="text-[8px] text-p5/40 shrink-0">{entry.exchange}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-1.5 border-b border-p2/50 shrink-0 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: FIVE_M_COLOR }}>
            Sinais de entrada
          </span>
          <span className="text-[9px] text-p5/40 font-mono">
            {activeSymbol ? `${entrySignals.length} registro(s)` : 'selecione uma moeda'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          {!activeSymbol && (
            <p className="text-[10px] text-p5/40 py-4 text-center">Escolha uma moeda 5m Trade</p>
          )}
          {activeSymbol && signalsLoading && !entrySignals.length && (
            <p className="text-[10px] text-p5/40 py-4 text-center">Carregando sinais…</p>
          )}
          {signalsError && (
            <p className="text-[10px] text-red-400/90 py-2 text-center">{signalsError}</p>
          )}
          {activeSymbol && !signalsLoading && !signalsError && entrySignals.length === 0 && (
            <p className="text-[10px] text-p5/40 py-4 text-center">
              Nenhuma entrada ou entrada pronta registrada para {activeSymbol}
            </p>
          )}

          {entrySignals.length > 0 && (
            <table className="w-full text-[10px] font-mono border-collapse">
              <thead>
                <tr className="text-p5/50 text-left">
                  <th className="pb-1 pr-2 font-normal">Quando</th>
                  <th className="pb-1 pr-2 font-normal">Tipo</th>
                  <th className="pb-1 pr-2 font-normal">Via</th>
                  <th className="pb-1 pr-2 font-normal text-right">Preço</th>
                  <th className="pb-1 font-normal text-right">RSI</th>
                </tr>
              </thead>
              <tbody>
                {entrySignals.map(sig => {
                  const lbl = eventLabel(sig.event_type);
                  const active = activeSignalId === sig.id;
                  const loading = chartLoading === sig.id;
                  return (
                    <tr
                      key={sig.id}
                      onClick={() => handleSignalClick(sig)}
                      className={`cursor-pointer border-t border-p2/30 transition-colors ${active ? 'bg-white/10' : 'hover:bg-p2/30'}`}
                      title={sig.motivation ?? ''}>
                      <td className="py-1.5 pr-2 text-p5/80 whitespace-nowrap">
                        {loading ? '… ' : ''}{fmtDateTime(sig.event_time)}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <span
                          className="px-1 py-0.5 rounded text-[9px] font-bold"
                          style={{
                            color: lbl.color,
                            border: `1px solid ${lbl.color}66`,
                            borderStyle: lbl.solid ? 'solid' : 'dashed',
                          }}>
                          {lbl.text}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-p5/60">{pathLabel(sig.entry_path)}</td>
                      <td className="py-1.5 pr-2 text-right text-p5">{fmtPrice(sig.price)}</td>
                      <td className="py-1.5 text-right text-p5/70">
                        {sig.rsi != null ? Number(sig.rsi).toFixed(1) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
