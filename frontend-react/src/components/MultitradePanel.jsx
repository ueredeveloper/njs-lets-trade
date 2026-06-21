import { useState, useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import MultitradeModal from './MultitradeModal';
import MultitradeBacktestPanel from './MultitradeBacktestPanel';

const MT_COLOR      = '#8b5cf6';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

export default function MultitradePanel() {
  const {
    multitradeFavorites, selectedChart,
    addMultitradeEntry, updateMultitradeEntry, removeMultitradeEntry,
  } = useCurrency();
  const [addModal, setAddModal]           = useState(false);
  const [favOpen, setFavOpen]             = useState(false);
  const [editingEntry, setEditingEntry]   = useState(null);
  const [pickedSymbol, setPickedSymbol]   = useState(null);

  const chartSymbol = selectedChart?.symbol?.toUpperCase?.() ?? null;

  const backtestEntry = useMemo(() => {
    if (chartSymbol) {
      const match = multitradeFavorites.find(e => e.symbol === chartSymbol);
      if (match) return match;
    }
    if (pickedSymbol) {
      return multitradeFavorites.find(e => e.symbol === pickedSymbol) ?? null;
    }
    if (multitradeFavorites.length === 1) return multitradeFavorites[0];
    return null;
  }, [chartSymbol, pickedSymbol, multitradeFavorites]);

  function pickFavorite(entry) {
    setPickedSymbol(entry.symbol);
    setFavOpen(false);
  }

  return (
    <div id="multitrade-panel" className="multitrade-panel flex flex-col h-full min-h-0">
      <div className="multitrade-panel-header flex items-center justify-between px-3 py-2 border-b border-p2 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-p5 uppercase tracking-wider shrink-0">Multi-Trade</span>
          {multitradeFavorites.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
              style={{ background: `${MT_COLOR}22`, color: MT_COLOR, border: `1px solid ${MT_COLOR}44` }}>
              {multitradeFavorites.length}
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
          {multitradeFavorites.length === 0 ? (
            <p className="text-[10px] text-p5/40 px-3 py-3 text-center">Nenhuma favorita MT</p>
          ) : (
            <ul className="multitrade-panel-favorites-list divide-y divide-p2/50">
              {multitradeFavorites.map(entry => {
                const active = backtestEntry?.symbol === entry.symbol;
                return (
                  <li
                    key={entry.id}
                    id={`multitrade-fav-${entry.symbol}`}
                    className={`multitrade-panel-favorites-item flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${active ? 'bg-violet-500/10' : 'hover:bg-p2/40'}`}
                    onClick={() => pickFavorite(entry)}>
                    <span className="font-mono text-[10px] font-bold text-p5 flex-1 min-w-0 truncate">
                      {entry.symbol}
                    </span>
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0"
                      style={{
                        background: entry.exchange === 'gate' ? GATE_COLOR : BINANCE_COLOR,
                        color: entry.exchange === 'gate' ? '#fff' : '#000',
                      }}>
                      {entry.exchange === 'gate' ? 'Gate' : 'Bnb'}
                    </span>
                    <span className="text-[9px] font-mono text-p5/50 shrink-0">${entry.capital}</span>
                    <button
                      type="button"
                      id={`multitrade-fav-edit-${entry.symbol}`}
                      className="multitrade-fav-btn-edit text-[10px] px-1.5 py-0.5 rounded text-p5/50 hover:text-p5 shrink-0"
                      style={{ background: '#2a2d3a', border: '1px solid #3a3d4a' }}
                      onClick={(e) => { e.stopPropagation(); setEditingEntry(entry); setFavOpen(false); }}>
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
        {multitradeFavorites.length === 0 ? (
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
          <MultitradeBacktestPanel entry={backtestEntry} />
        )}
      </div>

      {addModal && (
        <MultitradeModal
          onConfirm={(data) => { addMultitradeEntry(data); setAddModal(false); }}
          onCancel={() => setAddModal(false)}
        />
      )}

      {editingEntry && (
        <MultitradeModal
          symbol={editingEntry.symbol}
          defaultExchange={editingEntry.exchange}
          currentEntry={editingEntry}
          onConfirm={(data) => { updateMultitradeEntry(editingEntry.id, data); setEditingEntry(null); }}
          onRemove={() => { removeMultitradeEntry(editingEntry.id); setEditingEntry(null); }}
          onCancel={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}
