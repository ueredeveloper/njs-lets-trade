import { useState } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import MultitradeModal, { getBacktestCmd, getAdaptiveTestCmd, hasAdaptiveMa } from './MultitradeModal';

const MT_COLOR      = '#8b5cf6';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

export default function MultitradePanel() {
  const { multitradeFavorites, addMultitradeEntry, updateMultitradeEntry, removeMultitradeEntry } = useCurrency();
  const [addModal, setAddModal]       = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [copied, setCopied]           = useState(null);

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-p2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-p5 uppercase tracking-wider">Multi-Trade</span>
          {multitradeFavorites.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: `${MT_COLOR}22`, color: MT_COLOR, border: `1px solid ${MT_COLOR}44` }}>
              {multitradeFavorites.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setAddModal(true)}
          className="text-[10px] px-2 py-1 rounded font-semibold transition-colors hover:opacity-90"
          style={{ background: MT_COLOR, color: '#fff' }}>
          + Adicionar
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {multitradeFavorites.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
            <span className="text-xs text-p5/30">Nenhuma moeda configurada</span>
            <span className="text-[10px] text-p5/20">Use o botão MT na tabela ou + Adicionar</span>
          </div>
        ) : (
          <div className="space-y-1.5 p-2">
            {multitradeFavorites.map((entry) => {
              const cmd      = getBacktestCmd(entry);
              const adaptCmd = getAdaptiveTestCmd(entry);
              const cmdKey   = `${entry.id}-cmd`;
              const adaptKey = `${entry.id}-adapt`;
              const showAdapt = hasAdaptiveMa(entry.maConditions);

              return (
                <div key={entry.id} className="rounded border p-2.5 space-y-2"
                  style={{ background: '#1e2130', borderColor: '#2a2d3a' }}>

                  {/* Row 1: symbol + exchange */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-bold text-xs text-p5">{entry.symbol}</span>
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded"
                      style={{
                        background: entry.exchange === 'gate' ? GATE_COLOR : BINANCE_COLOR,
                        color: entry.exchange === 'gate' ? '#fff' : '#000',
                      }}>
                      {entry.exchange === 'gate' ? 'Gate' : 'Bnb'}
                    </span>
                  </div>

                  {/* Row 2: conditions summary */}
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70 font-mono">
                      ${entry.capital}
                    </span>
                    {entry.entryRsi && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70 font-mono">
                        RSI{entry.entryRsi.operator}{entry.entryRsi.value} {entry.entryRsi.interval}
                      </span>
                    )}
                    {entry.exitRsi && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70 font-mono">
                        RSI{entry.exitRsi.operator}{entry.exitRsi.value} {entry.exitRsi.interval}
                      </span>
                    )}
                    {(entry.maConditions ?? []).map((ma, i) => (
                      <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70 font-mono">
                        MA{ma.period}({ma.interval}) {ma.mode === 'adaptive' ? 'adapt.' : 'fixo'}
                      </span>
                    ))}
                    {entry.extension?.enabled !== false && entry.extension?.threeCandles && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70">3🕯</span>
                    )}
                    {entry.extension?.enabled !== false && entry.extension?.fourCandles && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70">4🕯</span>
                    )}
                    {entry.stopLoss?.enabled !== false && entry.stopLoss && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-red-400/80 font-mono">
                        SL MA{entry.stopLoss.period}({entry.stopLoss.interval})
                      </span>
                    )}
                    {entry.execution?.immediateEntry && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70">imediato</span>
                    )}
                    {entry.volume?.minVolumeUsdt != null && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-p2 text-p5/70 font-mono">
                        vol≥{entry.volume.minVolumeUsdt >= 1_000_000
                          ? `${entry.volume.minVolumeUsdt / 1_000_000}M`
                          : `${entry.volume.minVolumeUsdt / 1000}K`}
                      </span>
                    )}
                    {entry.volume?.allowLowVolume && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-mono">vol↓OK</span>
                    )}
                  </div>

                  {/* Row 3: actions */}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => copy(cmd, cmdKey)}
                      className="flex-1 text-[10px] py-1 rounded transition-colors"
                      style={{
                        background: copied === cmdKey ? `${MT_COLOR}22` : '#2a2d3a',
                        color:      copied === cmdKey ? MT_COLOR        : '#94a3b8',
                        border:     `1px solid ${copied === cmdKey ? MT_COLOR : '#3a3d4a'}`,
                      }}>
                      {copied === cmdKey ? '✓ Test' : 'Test'}
                    </button>
                    {showAdapt && (
                      <button
                        onClick={() => copy(adaptCmd, adaptKey)}
                        className="flex-1 text-[10px] py-1 rounded transition-colors"
                        style={{
                          background: copied === adaptKey ? '#26a69a22' : '#2a2d3a',
                          color:      copied === adaptKey ? '#26a69a'   : '#94a3b8',
                          border:     `1px solid ${copied === adaptKey ? '#26a69a' : '#3a3d4a'}`,
                        }}>
                        {copied === adaptKey ? '✓ Adapt' : 'Adapt'}
                      </button>
                    )}
                    <button
                      onClick={() => setEditingEntry(entry)}
                      className="px-2 text-[10px] py-1 rounded text-p5/50 hover:text-p5 transition-colors"
                      style={{ background: '#2a2d3a', border: '1px solid #3a3d4a' }}>
                      ✏
                    </button>
                    <button
                      onClick={() => removeMultitradeEntry(entry.id)}
                      className="px-2 text-[10px] py-1 rounded transition-colors"
                      style={{ background: '#2a2d3a', color: '#ef5350', border: '1px solid #ef535033' }}>
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: adicionar */}
      {addModal && (
        <MultitradeModal
          onConfirm={(data) => { addMultitradeEntry(data); setAddModal(false); }}
          onCancel={() => setAddModal(false)}
        />
      )}

      {/* Modal: editar */}
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
