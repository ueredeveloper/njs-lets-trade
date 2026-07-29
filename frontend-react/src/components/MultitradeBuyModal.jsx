import { useState } from 'react';

const MT_COLOR = '#22d3ee';

/** Confirmação + envio de ordem de compra a mercado (manual, fora do sinal do bot). */
export default function MultitradeBuyModal({ entry, onBought, onCancel }) {
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState(null);

  if (!entry) return null;

  const symbol = entry.symbol;
  const exchange = entry.exchange === 'gate' ? 'gate' : 'binance';
  const capital = entry.capital;

  async function handleConfirm() {
    setBuying(true);
    setError(null);
    try {
      await onBought();
    } catch (err) {
      setError(err?.message ?? 'Falha ao enviar ordem de compra');
      setBuying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={buying ? undefined : onCancel}>
      <div
        className="absolute inset-x-4 top-1/3 max-w-sm mx-auto rounded-lg shadow-2xl border"
        style={{ background: '#131722', borderColor: '#2a2d3a' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: '#2a2d3a' }}>
          <span className="text-sm font-bold text-p5">Confirmar compra</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-[11px] text-p5/70">Enviar ordem de compra a mercado agora (irreversível):</p>

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
              <span className="text-p5/50">Capital</span>
              <span className="font-mono">{capital != null ? `${capital} USDT` : '—'}</span>
            </div>
          </div>

          <p className="text-[10px] text-amber-400/80">
            Ignora o sinal do bot (cruzamento/pullback) — compra a mercado no preço atual, no
            capital configurado desse favorito.
          </p>
          {error && <p className="text-[10px] text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" disabled={buying} onClick={onCancel}
              className="flex-1 py-2 rounded text-[10px] font-semibold text-p5/60 disabled:opacity-50"
              style={{ background: '#2a2d3a', border: '1px solid #3a3d4a' }}>
              Cancelar
            </button>
            <button type="button" disabled={buying || !capital} onClick={handleConfirm}
              className="flex-1 py-2 rounded text-[10px] font-bold disabled:opacity-50"
              style={{ background: '#22c55e22', color: '#4ade80', border: '1px solid #22c55e55' }}>
              {buying ? 'Comprando…' : 'Confirmar compra'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
