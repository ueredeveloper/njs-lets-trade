import { useEffect, useState } from 'react';
import {
  placeBinanceOrder, placeGateOrder, checkBinanceOrderLock, checkGateOrderLock,
  placeBinanceBracketSell, placeGateBracketSell, fetchBinancePrice, fetchGatePrice,
} from '../services/api';
import BracketDragSlider from './BracketDragSlider';

const ACTIVE_COLOR = '#f59e0b';
const LOCK_CHECK_DEBOUNCE_MS = 400;
const DEFAULT_TARGET_PCT = 3;
const DEFAULT_STOP_PCT = 5;

function formatLotDateTime(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Confirmação + envio de ordem de venda a mercado para um lote de compra específico (AT).
 *  Quantidade é editável (venda parcial do lote) — o backend (/binance-order, /gate-order)
 *  já arredonda pro stepSize/precisão válida da corretora e limita ao saldo livre antes de
 *  enviar a ordem, então aqui só validamos que fica dentro de (0, qty do lote].
 *
 *  Como essa venda não sabe se o lote pertence a um bot (favorito AT não tem strategyId),
 *  antes de habilitar a confirmação checamos se a quantidade pedida cabe no saldo livre.
 *  Se não couber, alguma ordem OCO/TP-SL resting está travando parte do saldo — o usuário
 *  precisa marcar explicitamente que quer cancelá-la antes de vender. */
export default function TradeLotSellModal({ lot, onSold, onCancel }) {
  const [selling, setSelling] = useState(false);
  const [error, setError] = useState(null);
  const [sellQtyInput, setSellQtyInput] = useState(() => String(lot?.qty ?? ''));
  const [lockInfo, setLockInfo] = useState(null);
  const [lockChecking, setLockChecking] = useState(false);
  const [confirmCancelOco, setConfirmCancelOco] = useState(false);
  const [mode, setMode] = useState('direct'); // 'direct' | 'oco'
  const [targetPct, setTargetPct] = useState(DEFAULT_TARGET_PCT);
  const [stopPct, setStopPct] = useState(DEFAULT_STOP_PCT);
  const [currentPrice, setCurrentPrice] = useState(null);

  const symbol = lot?.symbol;
  const exchange = lot?.exchange;
  const qty = lot?.qty;
  const isGate = exchange === 'gate';
  const sellQty = Number(sellQtyInput);
  const isValidQty = Number.isFinite(sellQty) && sellQty > 0 && qty != null && sellQty <= qty;
  const isOcoMode = mode === 'oco';

  // Preço atual só importa no modo OCO (aviso de faixa no BracketDragSlider) — busca uma vez
  // ao ligar o modo, não fica repollando enquanto o usuário arrasta.
  useEffect(() => {
    if (!isOcoMode || !symbol) return;
    let cancelled = false;
    (isGate ? fetchGatePrice(symbol) : fetchBinancePrice(symbol))
      .then(({ price }) => { if (!cancelled) setCurrentPrice(price); })
      .catch(() => { if (!cancelled) setCurrentPrice(null); });
    return () => { cancelled = true; };
  }, [isOcoMode, symbol, isGate]);

  useEffect(() => {
    if (!symbol || !isValidQty) {
      setLockInfo(null);
      return undefined;
    }
    let cancelled = false;
    setLockChecking(true);
    const id = setTimeout(async () => {
      try {
        const info = isGate
          ? await checkGateOrderLock(symbol, sellQty)
          : await checkBinanceOrderLock(symbol, sellQty);
        if (!cancelled) setLockInfo(info);
      } catch {
        if (!cancelled) setLockInfo(null);
      } finally {
        if (!cancelled) setLockChecking(false);
      }
    }, LOCK_CHECK_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(id); };
  }, [symbol, isGate, sellQty, isValidQty]);

  useEffect(() => {
    setConfirmCancelOco(false);
  }, [sellQtyInput]);

  if (!lot) return null;

  const { price, time } = lot;
  const needsBracketCancel = !!lockInfo?.needsBracketCancel;
  const canConfirm = isValidQty && !lockChecking && (!needsBracketCancel || confirmCancelOco);

  function setPct(pct) {
    setSellQtyInput(String(qty * pct));
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setSelling(true);
    setError(null);
    try {
      const order = isOcoMode
        ? await (isGate
          ? placeGateBracketSell({ symbol, quantity: sellQty, entryPrice: price, targetPct, stopPct, allowCancelBracket: confirmCancelOco })
          : placeBinanceBracketSell({ symbol, quantity: sellQty, entryPrice: price, targetPct, stopPct, allowCancelBracket: confirmCancelOco }))
        : await (isGate
          ? placeGateOrder({ symbol, side: 'sell', type: 'market', amount: sellQty, allowCancelBracket: confirmCancelOco })
          : placeBinanceOrder({ symbol, side: 'SELL', type: 'MARKET', quantity: sellQty, allowCancelBracket: confirmCancelOco }));
      await onSold(order);
    } catch (err) {
      if (err?.needsBracketCancel) setLockInfo({ needsBracketCancel: true });
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
          <span className="text-sm font-bold text-p5">Confirmar venda desta compra</span>
        </div>

        <div className="px-3 py-2 space-y-2">
          <div className="flex gap-2">
            {[{ id: 'direct', label: 'Venda direta' }, { id: 'oco', label: 'OCO (alvo + stop)' }].map(m => (
              <button key={m.id} type="button" disabled={selling} onClick={() => setMode(m.id)}
                className="flex-1 py-1 text-[10px] rounded font-semibold disabled:opacity-50"
                style={{
                  background: mode === m.id ? ACTIVE_COLOR : 'transparent',
                  color: mode === m.id ? '#000' : ACTIVE_COLOR,
                  border: `1px solid ${ACTIVE_COLOR}`, opacity: mode === m.id ? 1 : 0.55,
                }}>{m.label}</button>
            ))}
          </div>

          <div className="rounded-lg px-3 py-1.5 space-y-0.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Símbolo</span>
              <span className="font-mono font-bold" style={{ color: ACTIVE_COLOR }}>{symbol}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Corretora</span>
              <span className="font-mono">{isGate ? 'Gate.io' : 'Binance'}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Comprado em</span>
              <span className="font-mono">{formatLotDateTime(time)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Preço de compra</span>
              <span className="font-mono">{Number(price).toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-p5/50">Comprado</span>
              <span className="font-mono">{qty}</span>
            </div>
          </div>

          {!qty ? (
            <p className="text-[10px] text-amber-400">
              Quantidade desta compra não disponível — não é possível vender.
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
              {isOcoMode && (
                <div className="rounded px-2 py-1" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <BracketDragSlider
                    entryPrice={price}
                    targetPct={targetPct}
                    stopPct={stopPct}
                    onChangeTarget={setTargetPct}
                    onChangeStop={setStopPct}
                    disabled={selling}
                    currentPrice={currentPrice}
                  />
                </div>
              )}
              {isValidQty && lockChecking && (
                <p className="text-[10px] text-p5/40">Checando saldo livre…</p>
              )}
              {isValidQty && !lockChecking && needsBracketCancel && (
                <label
                  className="flex items-start gap-2 rounded p-1.5 cursor-pointer"
                  style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}
                >
                  <input
                    type="checkbox"
                    checked={confirmCancelOco}
                    disabled={selling}
                    onChange={(e) => setConfirmCancelOco(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[10px] text-amber-300 leading-snug">
                    Essa quantidade não cabe no saldo livre — parte está travada numa ordem
                    OCO/TP-SL de outra compra deste símbolo (provavelmente gerenciada por um
                    bot). Marque aqui pra cancelar essa OCO e vender assim mesmo.
                  </span>
                </label>
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
            <button type="button" disabled={selling || !qty || !canConfirm} onClick={handleConfirm}
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
