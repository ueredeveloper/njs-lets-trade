import { useCallback, useRef, useState } from 'react';

const TRACK_HEIGHT = 100; // px
const CENTER_Y = TRACK_HEIGHT / 2;
const HALF_HEIGHT = CENTER_Y - 11; // margem pra alça não estourar a borda do trilho
const HANDLE_SIZE = 18;

// A Binance rejeita (PERCENT_PRICE_BY_SIDE) alvo/stop longe demais do preço ATUAL — o filtro
// varia por símbolo (visto na prática: até ~10% pra alguns pares), então esse limiar é só uma
// margem de segurança pra avisar ANTES de tentar (a validação real acontece no backend, ver
// binancePlaceOcoSell em ocoClient.js).
const CURRENT_PRICE_WARN_PCT = 9;

function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n < 1 ? n.toFixed(6) : n.toFixed(4);
}

function pctFromCurrent(price, currentPrice) {
  if (price == null || !currentPrice) return null;
  return ((price - currentPrice) / currentPrice) * 100;
}

/**
 * Eixo de preço vertical pra montar a bracket OCO arrastando: preço de compra no centro,
 * alça VERDE (alvo/TP) arrastável na metade de cima, alça VERMELHA (stop/SL) arrastável na
 * metade de baixo — arrastar move a alça e atualiza % + preço em tempo real (ver
 * MultitradeSellModal.jsx / TradeLotSellModal.jsx, modo OCO do botão de vender).
 * `currentPrice` (opcional) mostra o preço de mercado ao vivo e avisa quando o alvo/stop
 * (calculados sobre entryPrice, o preço de COMPRA) estiverem longe demais dele — a corretora
 * valida contra o preço atual, não o de compra, então os dois podem divergir bastante se o
 * preço já andou desde a entrada.
 */
export default function BracketDragSlider({
  entryPrice, targetPct, stopPct, onChangeTarget, onChangeStop,
  minPct = 0.1, maxPct = 20, disabled = false, currentPrice = null,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'target' | 'stop' | null

  const pctToY = useCallback((pct, side) => {
    const clamped = Math.max(minPct, Math.min(maxPct, pct));
    const ratio = (clamped - minPct) / (maxPct - minPct);
    return side === 'target' ? CENTER_Y - ratio * HALF_HEIGHT : CENTER_Y + ratio * HALF_HEIGHT;
  }, [minPct, maxPct]);

  const yToPct = useCallback((y, side) => {
    const dy = side === 'target' ? (CENTER_Y - y) : (y - CENTER_Y);
    const ratio = Math.max(0, Math.min(1, dy / HALF_HEIGHT));
    const pct = minPct + ratio * (maxPct - minPct);
    return Math.round(pct * 10) / 10;
  }, [minPct, maxPct]);

  function handleMove(side, e) {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pct = yToPct(y, side);
    if (side === 'target') onChangeTarget(pct);
    else onChangeStop(pct);
  }

  function handlePointerDown(side) {
    return (e) => {
      if (disabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDragging(side);
      handleMove(side, e);
    };
  }

  function handlePointerMove(side) {
    return (e) => {
      if (dragging !== side) return;
      handleMove(side, e);
    };
  }

  function handlePointerUp() {
    setDragging(null);
  }

  const targetY = pctToY(targetPct, 'target');
  const stopY = pctToY(stopPct, 'stop');
  const targetPrice = entryPrice ? Number(entryPrice) * (1 + Number(targetPct) / 100) : null;
  const stopPrice = entryPrice ? Number(entryPrice) * (1 - Number(stopPct) / 100) : null;
  const targetPctFromCurrent = pctFromCurrent(targetPrice, currentPrice);
  const stopPctFromCurrent = pctFromCurrent(stopPrice, currentPrice);
  const targetTooFar = targetPctFromCurrent != null && targetPctFromCurrent > CURRENT_PRICE_WARN_PCT;
  const stopTooFar = stopPctFromCurrent != null && -stopPctFromCurrent > CURRENT_PRICE_WARN_PCT;

  return (
    <div className="py-1">
      {currentPrice != null && (
        <div className="text-[9px] text-p5/50 mb-1">
          Preço atual <span className="font-mono font-semibold text-p5/80">{fmtPrice(currentPrice)}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
      <div
        ref={trackRef}
        className="relative shrink-0"
        style={{ width: HANDLE_SIZE, height: TRACK_HEIGHT, touchAction: 'none' }}
      >
        {/* trilho */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{ top: 0, bottom: 0, width: 4, background: '#2a2d3a' }} />
        {/* linha do preço de compra */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{ top: CENTER_Y - 1, width: 14, height: 2, background: '#9ca3af' }} />
        {/* trecho verde entre o centro e a alça de alvo */}
        <div className="absolute left-1/2 -translate-x-1/2"
          style={{ top: targetY, height: Math.max(0, CENTER_Y - targetY), width: 4, background: '#22c55e' }} />
        {/* trecho vermelho entre o centro e a alça de stop */}
        <div className="absolute left-1/2 -translate-x-1/2"
          style={{ top: CENTER_Y, height: Math.max(0, stopY - CENTER_Y), width: 4, background: '#ef4444' }} />
        {/* alça verde (alvo) */}
        <div
          onPointerDown={handlePointerDown('target')}
          onPointerMove={handlePointerMove('target')}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute rounded shadow"
          style={{
            left: '50%', top: targetY, width: HANDLE_SIZE, height: HANDLE_SIZE,
            transform: 'translate(-50%, -50%)', background: '#22c55e',
            border: '2px solid #052e16', touchAction: 'none',
            cursor: disabled ? 'default' : 'ns-resize', opacity: disabled ? 0.4 : 1,
          }}
        />
        {/* alça vermelha (stop) */}
        <div
          onPointerDown={handlePointerDown('stop')}
          onPointerMove={handlePointerMove('stop')}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute rounded shadow"
          style={{
            left: '50%', top: stopY, width: HANDLE_SIZE, height: HANDLE_SIZE,
            transform: 'translate(-50%, -50%)', background: '#ef4444',
            border: '2px solid #450a0a', touchAction: 'none',
            cursor: disabled ? 'default' : 'ns-resize', opacity: disabled ? 0.4 : 1,
          }}
        />
      </div>

      <div className="relative flex-1" style={{ height: TRACK_HEIGHT }}>
        <div className="absolute leading-tight" style={{ top: targetY, transform: 'translateY(-50%)' }}>
          <div className="text-[11px] font-bold" style={{ color: '#22c55e' }}>+{Number(targetPct).toFixed(1)}%</div>
          <div className="text-[10px] font-mono font-semibold text-p5/90">{fmtPrice(targetPrice)}</div>
          {targetPctFromCurrent != null && (
            <div className={`text-[9px] ${targetTooFar ? 'text-amber-400 font-semibold' : 'text-p5/40'}`}>
              {targetTooFar ? '⚠️ ' : ''}{targetPctFromCurrent >= 0 ? '+' : ''}{targetPctFromCurrent.toFixed(1)}% do atual
            </div>
          )}
        </div>
        <div className="absolute leading-tight" style={{ top: CENTER_Y, transform: 'translateY(-50%)' }}>
          <div className="text-[9px] text-p5/40">compra</div>
          <div className="text-[10px] font-mono font-semibold text-p5/80">{fmtPrice(entryPrice)}</div>
        </div>
        <div className="absolute leading-tight" style={{ top: stopY, transform: 'translateY(-50%)' }}>
          <div className="text-[11px] font-bold" style={{ color: '#ef4444' }}>-{Number(stopPct).toFixed(1)}%</div>
          <div className="text-[10px] font-mono font-semibold text-p5/90">{fmtPrice(stopPrice)}</div>
          {stopPctFromCurrent != null && (
            <div className={`text-[9px] ${stopTooFar ? 'text-amber-400 font-semibold' : 'text-p5/40'}`}>
              {stopTooFar ? '⚠️ ' : ''}{stopPctFromCurrent >= 0 ? '+' : ''}{stopPctFromCurrent.toFixed(1)}% do atual
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
