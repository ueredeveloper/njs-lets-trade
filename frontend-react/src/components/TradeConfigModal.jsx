import { useState } from 'react';

const TRADE_COLOR   = '#00c076';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';
const INTERVALS     = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'];

const EXCHANGES = [
  { id: 'gate',    label: 'Gate.io',  color: GATE_COLOR    },
  { id: 'binance', label: 'Binance',  color: BINANCE_COLOR },
];

export default function TradeConfigModal({ symbol, isActive, currentConfig, onConfirm, onRemove, onCancel }) {
  const [exchange,  setExchange]   = useState(currentConfig?.exchange  ?? 'binance');
  const [interval,  setIntervalVal] = useState(currentConfig?.interval ?? '30m');
  const [rsiBuy,    setRsiBuy]     = useState(currentConfig?.rsiBuy    ?? 30);
  const [rsiSell,   setRsiSell]    = useState(currentConfig?.rsiSell   ?? 70);

  function handleConfirm() {
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (buy >= sell) return;
    onConfirm({ exchange, interval, rsiBuy: buy, rsiSell: sell });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onCancel}
    >
      <div
        className="w-72 rounded-lg shadow-2xl border"
        style={{ background: '#131722', borderColor: '#2a2d3a' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2a2d3a' }}>
          <div>
            <span className="text-xs font-semibold text-p5">Trade Now</span>
            <span className="ml-2 text-xs font-mono font-bold" style={{ color: TRADE_COLOR }}>{symbol}</span>
          </div>
          <button onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none transition-colors">×</button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3.5">
          {/* Exchange */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5">Corretora</label>
            <div className="flex gap-2">
              {EXCHANGES.map(ex => {
                const active = exchange === ex.id;
                return (
                  <button
                    key={ex.id}
                    onClick={() => setExchange(ex.id)}
                    className="flex-1 py-1.5 text-xs rounded font-semibold transition-all"
                    style={{
                      background: active ? ex.color : 'transparent',
                      color:      active ? (ex.id === 'binance' ? '#000' : '#fff') : ex.color,
                      border:     `1px solid ${ex.color}`,
                      opacity:    active ? 1 : 0.55,
                    }}
                  >
                    {ex.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Intervalo */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1">Intervalo</label>
            <select
              value={interval}
              onChange={e => setIntervalVal(e.target.value)}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer"
              style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
            >
              {INTERVALS.map(iv => (
                <option key={iv} value={iv}>{iv}</option>
              ))}
            </select>
          </div>

          {/* RSI Compra */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: '#26a69a' }}>
              RSI Compra — abaixo de
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={rsiBuy}
                onChange={e => setRsiBuy(e.target.value)}
                min={1} max={99}
                className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono"
                style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
              />
              <span className="text-xs text-p5/40 shrink-0">RSI &lt; {rsiBuy}</span>
            </div>
          </div>

          {/* RSI Venda */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: '#ef5350' }}>
              RSI Venda — acima de
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={rsiSell}
                onChange={e => setRsiSell(e.target.value)}
                min={1} max={100}
                className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono"
                style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
              />
              <span className="text-xs text-p5/40 shrink-0">RSI &gt; {rsiSell}</span>
            </div>
          </div>

          {Number(rsiBuy) >= Number(rsiSell) && (
            <p className="text-[10px]" style={{ color: '#ef5350' }}>
              RSI compra deve ser menor que RSI venda.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 pb-4">
          {isActive && (
            <button
              onClick={onRemove}
              className="flex-1 py-1.5 text-xs rounded font-medium transition-colors"
              style={{ border: '1px solid #ef5350', color: '#ef5350' }}
            >
              Remover
            </button>
          )}
          {!isActive && (
            <button
              onClick={onCancel}
              className="flex-1 py-1.5 text-xs rounded font-medium transition-colors text-p5/50 hover:text-p5"
              style={{ border: '1px solid #2a2d3a' }}
            >
              Cancelar
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={Number(rsiBuy) >= Number(rsiSell)}
            className="flex-1 py-1.5 text-xs rounded font-semibold transition-opacity disabled:opacity-40"
            style={{ background: TRADE_COLOR, color: '#fff' }}
          >
            {isActive ? 'Atualizar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
