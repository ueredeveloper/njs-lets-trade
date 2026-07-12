import { useState } from 'react';
import { placeBinanceOrder, placeGateOrder } from '../services/api';

const MT_COLOR = '#22d3ee';

/** Confirmação + envio de ordem de venda a mercado para um favorito MC (BOUGHT). */
export default function MultitradeSellModal({ entry, onSold, onCancel }) {
  const [selling, setSelling] = useState(false);
  const [error, setError] = useState(null);

  if (!entry) return null;

  const symbol = entry.symbol;
  const exchange = entry.exchange === 'gate' ? 'gate' : 'binance';
  const qty = entry.buyQty;

  async function handleConfirm() {
    setSelling(true);
    setError(null);
    try {
      const order = exchange === 'gate'
        ? await placeGateOrder({ symbol, side: 'sell', type: 'market', amount: qty })
        : await placeBinanceOrder({ symbol, side: 'SELL', type: 'MARKET', quantity: qty });
      await onSold(order);
    } catch (err) {
      setError(err?.message ?? 'Falha ao enviar ordem de venda');
      setSelling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={selling ? undefined : onCancel}>
      <div
        className="absolute inset-x-4 top-1/3 max-w-sm mx-auto rounded-lg shadow-2xl border"
        style={{ background: '#131722', borderColor: '#2a2d3a' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: '#2a2d3a' }}>
          <span className="text-sm font-bold text-p5">Confirmar venda</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-[11px] text-p5/70">Enviar ordem de venda a mercado (irreversível):</p>

          <div className="rounded-lg p-3 space-y-1" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Símbolo</span>
              <span className="font-mono font-bold" style={{ color: MT_COLOR }}>{symbol}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Corretora</span>
              <span className="font-mono">{exchange === 'gate' ? 'Gate.io' : 'Binance'}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Quantidade</span>
              <span className="font-mono">{qty ?? '—'}</span>
            </div>
          </div>

          {!qty && (
            <p className="text-[10px] text-amber-400">
              Quantidade de compra não registrada para este favorito — não é possível vender.
            </p>
          )}
          {error && <p className="text-[10px] text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" disabled={selling} onClick={onCancel}
              className="flex-1 py-2 rounded text-[10px] font-semibold text-p5/60 disabled:opacity-50"
              style={{ background: '#2a2d3a', border: '1px solid #3a3d4a' }}>
              Cancelar
            </button>
            <button type="button" disabled={selling || !qty} onClick={handleConfirm}
              className="flex-1 py-2 rounded text-[10px] font-bold disabled:opacity-50"
              style={{ background: '#ef444422', color: '#f87171', border: '1px solid #ef444455' }}>
              {selling ? 'Vendendo…' : 'Confirmar venda'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
