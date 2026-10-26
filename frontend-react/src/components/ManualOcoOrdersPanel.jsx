import { useState } from 'react';
import { cancelManualOcoOrder, sellManualOcoOrder } from '../services/api';
import { manualOcoLevels } from '../utils/manualOco';

const STATUS_LABEL = {
  NEW: 'aguardando bot',
  OPEN: 'compra armada',
  CANCEL_REQUESTED: 'cancelando…',
  FILLED: 'comprou · pondo OCO',
  BRACKETED: 'OCO montada',
  SELLING: 'vendendo…',
  OCO_FAILED: 'SEM OCO!',
};

function fmtPrice(p) {
  const n = Number(p);
  return Number.isFinite(n) ? String(Number(n.toPrecision(6))) : '—';
}

function fmtPct(base, price) {
  const pct = ((price - base) / base) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/**
 * Ordens ATIVAS da OCO manual da moeda aberta no gráfico (manual_oco_orders) — aparecem ao clicar
 * na moeda, junto com as linhas/faixas desenhadas em CandlestickChartLW.jsx:
 *  - OCO montada (comprou): verde/vermelho + "Vender agora" (cancela a OCO e vende a mercado).
 *  - Ainda na compra: previsão azul (alvo) / laranja (stop) + "Cancelar compra".
 */
export default function ManualOcoOrdersPanel({ orders, marketPrice, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null); // { ok, text }

  if (!orders?.length) return null;

  const run = async (id, action, confirmText) => {
    if (busyId || !window.confirm(confirmText)) return;
    setBusyId(id);
    setMessage(null);
    try {
      const r = await action(id);
      setMessage({
        ok: true,
        text: r?.status === 'SOLD'
          ? `#${id} vendida a ~${fmtPrice(r.exit?.exitPrice)} (${fmtPrice(r.exit?.usdtOut)} USDT)`
          : `#${id}: cancelamento enviado`,
      });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusyId(null);
      onChanged?.();
    }
  };

  return (
    <div
      className="absolute bottom-10 right-[5.5rem] z-30 w-60 max-w-[calc(100%-6rem)] rounded-md border border-slate-600 bg-slate-900/95 p-2 text-[10px] font-mono text-slate-200 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {orders.map((o) => {
        const { mounted, entry, target, stop, noOco } = manualOcoLevels(o);
        const busy = busyId === o.id;
        return (
          <div key={o.id} className="border-b border-slate-700 py-1 last:border-b-0">
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold">#{o.id} · {Number(o.usdt)} USDT</span>
              <span className={noOco ? 'font-bold text-red-400' : mounted ? 'text-green-400' : 'text-sky-300'}>
                {STATUS_LABEL[o.status] ?? o.status}
              </span>
            </div>
            {mounted ? (
              <div>
                compra {fmtPrice(entry)}
                {marketPrice && entry > 0 && (
                  <span className={marketPrice >= entry ? 'text-green-400' : 'text-red-400'}> · agora {fmtPct(entry, marketPrice)}</span>
                )}
              </div>
            ) : (
              <div className="text-yellow-300">
                {o.entry_kind === 'trigger' ? 'rompimento' : 'limite'} {fmtPrice(entry)}
                {marketPrice && entry > 0 && <span className="text-slate-400"> · preço {fmtPct(marketPrice, entry)}</span>}
              </div>
            )}
            {!noOco && (
              <div>
                <span className={mounted ? 'text-green-400' : 'text-blue-400'}>alvo {fmtPrice(target)}</span>
                {' / '}
                <span className={mounted ? 'text-red-400' : 'text-orange-400'}>stop {fmtPrice(stop)}</span>
              </div>
            )}
            {o.error && <div className={`break-words ${noOco ? 'text-red-400' : 'text-amber-300'}`}>{o.error}</div>}
            {mounted && o.status !== 'SELLING' && (
              <button
                onClick={() => run(o.id, sellManualOcoOrder,
                  `Vender AGORA a mercado a posição #${o.id} de ${o.symbol}?\n\nA OCO (alvo/stop) é cancelada antes da venda.`)}
                disabled={busy}
                className="mt-1 w-full rounded bg-red-600 py-0.5 font-bold text-white hover:bg-red-500 disabled:opacity-40"
              >
                {busy ? 'Vendendo…' : `Vender agora${marketPrice ? ` (~${fmtPrice(marketPrice)})` : ''}`}
              </button>
            )}
            {(o.status === 'NEW' || o.status === 'OPEN') && (
              <button
                onClick={() => run(o.id, cancelManualOcoOrder, `Cancelar a ordem de compra #${o.id} de ${o.symbol}?`)}
                disabled={busy}
                className="mt-1 w-full rounded bg-orange-600 py-0.5 font-bold text-white hover:bg-orange-500 disabled:opacity-40"
              >
                {busy ? 'Cancelando…' : 'Cancelar compra'}
              </button>
            )}
          </div>
        );
      })}
      {message && (
        <div className={`mt-1 break-words ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</div>
      )}
    </div>
  );
}
