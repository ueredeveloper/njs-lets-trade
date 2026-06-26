import { useState, useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import MultitradeModal from './MultitradeModal';
import MultitradeBacktestPanel from './MultitradeBacktestPanel';
import {
  STRATEGY_IDS, STRATEGY_LABELS, STRATEGY_COLORS,
  getEntriesForSymbol, normalizeStrategyId, strategyBadgeLabel,
} from '../constants/strategyPresets';

const MT_COLOR      = '#8b5cf6';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

function groupBySymbol(favorites) {
  const map = new Map();
  for (const e of favorites ?? []) {
    const sym = e.symbol?.toUpperCase();
    if (!sym) continue;
    if (!map.has(sym)) map.set(sym, []);
    map.get(sym).push(e);
  }
  return map;
}

export default function MultitradePanel() {
  const {
    multitradeFavorites, selectedChart,
    saveMultitradeSymbol, removeMultitradeEntry,
  } = useCurrency();
  const [addModal, setAddModal]           = useState(false);
  const [favOpen, setFavOpen]             = useState(false);
  const [editingSymbol, setEditingSymbol] = useState(null);
  const [pickedSymbol, setPickedSymbol]   = useState(null);
  const [pickedStrategy, setPickedStrategy] = useState('amap-15m');

  const chartSymbol = selectedChart?.symbol?.toUpperCase?.() ?? null;
  const grouped = useMemo(() => groupBySymbol(multitradeFavorites), [multitradeFavorites]);
  const symbolList = useMemo(() => [...grouped.keys()].sort(), [grouped]);

  const backtestEntry = useMemo(() => {
    const sym = chartSymbol ?? pickedSymbol;
    if (!sym) return null;
    const entries = getEntriesForSymbol(multitradeFavorites, sym).filter(e => e.enabled !== false);
    if (!entries.length) return null;
    return entries.find(e => normalizeStrategyId(e.strategyId) === pickedStrategy)
      ?? entries[0];
  }, [chartSymbol, pickedSymbol, pickedStrategy, multitradeFavorites]);

  const activeSymbol = backtestEntry?.symbol ?? pickedSymbol ?? chartSymbol;

  function pickFavorite(sym) {
    setPickedSymbol(sym);
    const entries = getEntriesForSymbol(multitradeFavorites, sym).filter(e => e.enabled !== false);
    if (entries.length && !entries.some(e => normalizeStrategyId(e.strategyId) === pickedStrategy)) {
      setPickedStrategy(normalizeStrategyId(entries[0].strategyId));
    }
    setFavOpen(false);
  }

  return (
    <div id="multitrade-panel" className="multitrade-panel flex flex-col h-full min-h-0">
      <div className="multitrade-panel-header flex items-center justify-between px-3 py-2 border-b border-p2 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-p5 uppercase tracking-wider shrink-0">Multi-Trade</span>
          {symbolList.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
              style={{ background: `${MT_COLOR}22`, color: MT_COLOR, border: `1px solid ${MT_COLOR}44` }}>
              {symbolList.length}
            </span>
          )}
          {backtestEntry && (
            <span className="text-[9px] font-mono text-p5/50 truncate hidden sm:inline">
              {backtestEntry.symbol}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            id="multitrade-panel-btn-favorites"
            type="button"
            onClick={() => setFavOpen(v => !v)}
            className="multitrade-panel-btn-favorites text-[10px] px-2 py-1 rounded font-semibold transition-colors"
            style={{
              background: favOpen ? `${MT_COLOR}33` : '#2a2d3a',
              color: favOpen ? MT_COLOR : '#94a3b8',
              border: `1px solid ${favOpen ? MT_COLOR : '#3a3d4a'}`,
            }}>
            ★ Favoritas
          </button>
          <button
            id="multitrade-panel-btn-add"
            type="button"
            onClick={() => setAddModal(true)}
            className="multitrade-panel-btn-add text-[10px] px-2 py-1 rounded font-semibold transition-colors hover:opacity-90"
            style={{ background: MT_COLOR, color: '#fff' }}>
            + Adicionar
          </button>
        </div>
      </div>

      {favOpen && (
        <div id="multitrade-panel-favorites" className="multitrade-panel-favorites border-b border-p2 shrink-0 max-h-48 overflow-y-auto">
          {symbolList.length === 0 ? (
            <p className="text-[10px] text-p5/40 px-3 py-3 text-center">Nenhuma favorita MT</p>
          ) : (
            <ul className="multitrade-panel-favorites-list divide-y divide-p2/50">
              {symbolList.map(sym => {
                const entries = grouped.get(sym) ?? [];
                const active = activeSymbol === sym;
                const ex = entries[0]?.exchange ?? 'binance';
                const activeEntries = entries.filter(e => e.enabled !== false);
                return (
                  <li
                    key={sym}
                    id={`multitrade-fav-${sym}`}
                    className={`multitrade-panel-favorites-item flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${active ? 'bg-violet-500/10' : 'hover:bg-p2/40'}`}
                    onClick={() => pickFavorite(sym)}>
                    <span className="font-mono text-[10px] font-bold text-p5 flex-1 min-w-0 truncate">
                      {sym}
                    </span>
                    <div className="flex gap-0.5 shrink-0">
                      {STRATEGY_IDS.map(sid => {
                        const on = activeEntries.some(e => normalizeStrategyId(e.strategyId) === sid);
                        return (
                          <span key={sid} className="text-[7px] font-bold px-1 py-0.5 rounded"
                            style={{
                              background: on ? `${STRATEGY_COLORS[sid]}33` : '#2a2d3a',
                              color: on ? STRATEGY_COLORS[sid] : '#4a4d5a',
                              border: `1px solid ${on ? STRATEGY_COLORS[sid] + '55' : '#3a3d4a'}`,
                            }}>
                            {strategyBadgeLabel(sid)}
                          </span>
                        );
                      })}
                    </div>
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0"
                      style={{
                        background: ex === 'gate' ? GATE_COLOR : BINANCE_COLOR,
                        color: ex === 'gate' ? '#fff' : '#000',
                      }}>
                      {ex === 'gate' ? 'Gate' : 'Bnb'}
                    </span>
                    <button
                      type="button"
                      id={`multitrade-fav-edit-${sym}`}
                      className="multitrade-fav-btn-edit text-[10px] px-1.5 py-0.5 rounded text-p5/50 hover:text-p5 shrink-0"
                      style={{ background: '#2a2d3a', border: '1px solid #3a3d4a' }}
                      onClick={(e) => { e.stopPropagation(); setEditingSymbol(sym); setFavOpen(false); }}>
                      ✏
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="multitrade-panel-body flex-1 min-h-0 flex flex-col">
        {symbolList.length === 0 ? (
          <div className="multitrade-panel-empty flex flex-col items-center justify-center flex-1 gap-2 py-12">
            <span className="text-xs text-p5/30">Nenhuma moeda configurada</span>
            <span className="text-[10px] text-p5/20">Use o botão MT na tabela ou + Adicionar</span>
          </div>
        ) : !backtestEntry ? (
          <div className="multitrade-panel-empty flex flex-col items-center justify-center flex-1 gap-2 py-12 px-4 text-center">
            <span className="text-xs text-p5/40">Selecione uma favorita MT</span>
            <button
              type="button"
              id="multitrade-panel-btn-open-favorites"
              onClick={() => setFavOpen(true)}
              className="text-[10px] px-3 py-1.5 rounded font-semibold"
              style={{ background: `${MT_COLOR}22`, color: MT_COLOR, border: `1px solid ${MT_COLOR}55` }}>
              ★ Abrir favoritas
            </button>
          </div>
        ) : (
          <>
            {activeSymbol && (grouped.get(activeSymbol)?.filter(e => e.enabled !== false).length ?? 0) > 1 && (
              <div className="flex gap-1 px-2 py-1.5 border-b border-p2 shrink-0">
                {(grouped.get(activeSymbol) ?? [])
                  .filter(e => e.enabled !== false)
                  .map(e => {
                    const sid = normalizeStrategyId(e.strategyId);
                    return (
                      <button key={e.id} type="button" onClick={() => setPickedStrategy(sid)}
                        className="flex-1 py-1 text-[9px] font-bold rounded"
                        style={{
                          background: pickedStrategy === sid ? `${STRATEGY_COLORS[sid]}22` : '#1a1d28',
                          color: pickedStrategy === sid ? STRATEGY_COLORS[sid] : '#94a3b8',
                          border: `1px solid ${pickedStrategy === sid ? STRATEGY_COLORS[sid] + '55' : '#2a2d3a'}`,
                        }}>
                        {STRATEGY_LABELS[sid]}
                      </button>
                    );
                  })}
              </div>
            )}
            <MultitradeBacktestPanel
              key={`${backtestEntry.symbol}-${backtestEntry.strategyId ?? backtestEntry.id}`}
              entry={backtestEntry}
            />
          </>
        )}
      </div>

      {addModal && (
        <MultitradeModal
          onConfirm={async ({ saves }) => { await saveMultitradeSymbol({ saves }); setAddModal(false); }}
          onCancel={() => setAddModal(false)}
        />
      )}

      {editingSymbol && (
        <MultitradeModal
          symbol={editingSymbol}
          defaultExchange={grouped.get(editingSymbol)?.[0]?.exchange ?? 'binance'}
          currentEntries={grouped.get(editingSymbol) ?? []}
          onConfirm={async ({ saves }) => { await saveMultitradeSymbol({ saves }); setEditingSymbol(null); }}
          onRemove={async () => {
            for (const e of grouped.get(editingSymbol) ?? []) await removeMultitradeEntry(e.id);
            setEditingSymbol(null);
          }}
          onCancel={() => setEditingSymbol(null)}
        />
      )}
    </div>
  );
}
