import { useEffect, useState } from 'react';
import {
  placeBinanceOrder, placeGateOrder, placeBinanceBracketSell, placeGateBracketSell,
  fetchBinancePrice, fetchGatePrice,
} from '../services/api';
import { normalizeStrategyId } from '../constants/strategyPresets';
import BracketDragSlider from './BracketDragSlider';

const MT_COLOR = '#22d3ee';
const DEFAULT_TARGET_PCT = 3;
const DEFAULT_STOP_PCT = 5;

/** Confirmação + envio de ordem de venda para um favorito MC/VWAP/BB (BOUGHT) — venda direta
 *  a mercado ou uma OCO (TP/SL manual) resting na corretora, protegendo a posição mesmo se o
 *  bot cair. Quantidade é editável (venda parcial) — o backend já arredonda pro
 *  stepSize/precisão válida da corretora e limita ao saldo livre antes de enviar a ordem,
 *  então aqui só validamos que fica dentro de (0, buyQty]. */
export default function MultitradeSellModal({ entry, onSold, onCancel }) {
  const [selling, setSelling] = useState(false);
  const [error, setError] = useState(null);
  const [sellQtyInput, setSellQtyInput] = useState(() => String(entry?.buyQty ?? ''));
  const [mode, setMode] = useState('direct'); // 'direct' | 'oco'
  const [targetPct, setTargetPct] = useState(DEFAULT_TARGET_PCT);
  const [stopPct, setStopPct] = useState(DEFAULT_STOP_PCT);
  const [currentPrice, setCurrentPrice] = useState(null);

  const symbol = entry?.symbol;
  const exchange = entry?.exchange === 'gate' ? 'gate' : 'binance';
  const isOcoMode = mode === 'oco';

  // Preço atual só importa no modo OCO (aviso de faixa no BracketDragSlider) — busca uma vez
  // ao ligar o modo, não fica repollando enquanto o usuário arrasta.
  useEffect(() => {
    if (!isOcoMode || !symbol) return;
    let cancelled = false;
    (exchange === 'gate' ? fetchGatePrice(symbol) : fetchBinancePrice(symbol))
      .then(({ price }) => { if (!cancelled) setCurrentPrice(price); })
      .catch(() => { if (!cancelled) setCurrentPrice(null); });
    return () => { cancelled = true; };
  }, [isOcoMode, symbol, exchange]);

  if (!entry) return null;

  const qty = entry.buyQty;
  const buyPrice = entry.buyPrice;
  const strategyId = normalizeStrategyId(entry.strategyId);
  const sellQty = Number(sellQtyInput);
  const isValidQty = Number.isFinite(sellQty) && sellQty > 0 && sellQty <= qty;

  function setPct(pct) {
    setSellQtyInput(String(qty * pct));
  }

  async function handleConfirm() {
    if (!isValidQty) return;
    setSelling(true);
    setError(null);
    try {
      const order = isOcoMode
        ? await (exchange === 'gate'
          ? placeGateBracketSell({ symbol, quantity: sellQty, entryPrice: buyPrice, targetPct, stopPct, strategyId })
          : placeBinanceBracketSell({ symbol, quantity: sellQty, entryPrice: buyPrice, targetPct, stopPct, strategyId }))
        : await (exchange === 'gate'
          ? placeGateOrder({ symbol, side: 'sell', type: 'market', amount: sellQty, strategyId })
          : placeBinanceOrder({ symbol, side: 'SELL', type: 'MARKET', quantity: sellQty, strategyId }));
      // No modo OCO a posição continua BOUGHT — a ordem só fica resting na corretora, não
      // vendeu ainda. Quem chama precisa saber disso pra não zerar a fase pra WATCHING.
      await onSold(order, { oco: isOcoMode });
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
        <div className="px-3 py-2 border-b" style={{ borderColor: '#2a2d3a' }}>
          <span className="text-sm font-bold text-p5">Confirmar venda</span>
        </div>

        <div className="px-3 py-2 space-y-2">
          <div className="flex gap-2">
            {[{ id: 'direct', label: 'Venda direta' }, { id: 'oco', label: 'OCO (alvo + stop)' }].map(m => (
              <button key={m.id} type="button" disabled={selling} onClick={() => setMode(m.id)}
                className="flex-1 py-1 text-[10px] rounded font-semibold disabled:opacity-50"
                style={{
                  background: mode === m.id ? MT_COLOR : 'transparent',
                  color: mode === m.id ? '#000' : MT_COLOR,
                  border: `1px solid ${MT_COLOR}`, opacity: mode === m.id ? 1 : 0.55,
                }}>{m.label}</button>
            ))}
          </div>

          <div className="rounded-lg px-3 py-1.5 space-y-0.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Símbolo</span>
              <span className="font-mono font-bold" style={{ color: MT_COLOR }}>{symbol}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Corretora</span>
              <span className="font-mono">{exchange === 'gate' ? 'Gate.io' : 'Binance'}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Preço de compra</span>
              <span className="font-mono">{buyPrice != null ? Number(buyPrice).toFixed(4) : '—'}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Comprado</span>
              <span className="font-mono">{qty ?? '—'}</span>
            </div>
          </div>

          {isOcoMode && !buyPrice && (
            <p className="text-[10px] text-amber-400">
              Preço de compra não registrado — não é possível calcular alvo/stop pra OCO.
            </p>
          )}

          {!qty ? (
            <p className="text-[10px] text-amber-400">
              Quantidade de compra não registrada para este favorito — não é possível vender.
            </p>
          ) : (
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-p5/50">Quantidade a vender</span>
                <span className="text-[9px] text-p5/40">máx. {qty}</span>
              </div>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                max={qty}
                disabled={selling}
                value={sellQtyInput}
                onChange={(e) => setSellQtyInput(e.target.value)}
                className="w-full rounded px-2 py-1 text-[12px] font-mono disabled:opacity-50"
                style={{ background: '#0f1219', border: `1px solid ${isValidQty ? '#2a2d3a' : '#ef444488'}`, color: '#e5e7eb' }}
              />
              <div className="flex gap-1">
                {[0.25, 0.5, 0.75, 1].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    disabled={selling}
                    onClick={() => setPct(pct)}
                    className="flex-1 py-0.5 rounded text-[9px] font-semibold text-p5/60 hover:text-p5 disabled:opacity-50"
                    style={{ background: '#1a1d2a', border: '1px solid #2a2d3a' }}
                  >
                    {pct === 1 ? 'Tudo' : `${pct * 100}%`}
                  </button>
                ))}
              </div>
              {!isValidQty && sellQtyInput !== '' && (
                <p className="text-[10px] text-red-400">
                  Quantidade precisa ser maior que 0 e no máximo {qty}.
                </p>
              )}
              {isOcoMode && buyPrice && (
                <div className="rounded px-2 py-1" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <BracketDragSlider
                    entryPrice={buyPrice}
                    targetPct={targetPct}
                    stopPct={stopPct}
                    onChangeTarget={setTargetPct}
                    onChangeStop={setStopPct}
                    disabled={selling}
                    currentPrice={currentPrice}
                  />
                </div>
              )}
            </div>
          )}
          {error && <p className="text-[10px] text-red-400">{error}</p>}

          <div className="flex gap-2 pt-0.5">
            <button type="button" disabled={selling} onClick={onCancel}
              className="flex-1 py-1.5 rounded text-[10px] font-semibold text-p5/60 disabled:opacity-50"
              style={{ background: '#2a2d3a', border: '1px solid #3a3d4a' }}>
              Cancelar
            </button>
            <button type="button" disabled={selling || !qty || !isValidQty || (isOcoMode && !buyPrice)} onClick={handleConfirm}
              className="flex-1 py-1.5 rounded text-[10px] font-bold disabled:opacity-50"
              style={{ background: '#ef444422', color: '#f87171', border: '1px solid #ef444455' }}>
              {selling ? (isOcoMode ? 'Colocando OCO…' : 'Vendendo…') : (isOcoMode ? 'Colocar OCO' : 'Confirmar venda')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
