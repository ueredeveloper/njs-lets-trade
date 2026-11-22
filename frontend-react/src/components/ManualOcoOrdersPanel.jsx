import { useState } from 'react';
import { cancelManualOcoOrder, sellManualOcoOrder, dropNowManualOcoOrder } from '../services/api';
import { manualOcoLevels } from '../utils/manualOco';

const STATUS_LABEL = {
  NEW: 'aguardando bot',
  OPEN: 'bot vigiando',
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

// Hora da compra em BRT, ex.: "12/09 15:30".
function fmtBuyTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

// Entrada "no fechamento do candle": "fecha 4h 13:00 sem padrão de baixa".
function candleCloseLabel(o) {
  const cc = o.close_condition ?? {};
  const at = cc.closeAt ? new Date(cc.closeAt).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  }) : '?';
  const disc = Number(cc.entryDiscount?.discountPct);
  return `fecha ${cc.interval ?? ''} ${at} sem padrão de baixa${disc > 0 ? ` → entrada −${disc}%` : ''}`;
}

// Entrada com desconto já armada (fechou sem padrão de baixa): prazo da limite em BRT.
function limitExpiryLabel(o) {
  const ms = Number(o.close_condition?.limitExpiresAt);
  return ms > 0 ? ` · até ${fmtBuyTime(new Date(ms).toISOString())}` : '';
}

// Regra de queda da Explosão automática (close_condition.exit.onDrop): o que já aconteceu / o que
// o botão "agora" adianta. null = ordem sem regra (manual, antiga ou 'off').
const DROP_STAGE_LABEL = {
  moving: 'movendo o alvo…', moved: 'alvo na entrada · comprando…', buying: 'comprando o martingale…',
  done: 'regra de queda executada', failed: 'regra de queda falhou',
};
function dropRule(o) {
  const cc = o.close_condition ?? {};
  const od = cc.exit?.onDrop;
  if (!od || !['martingale', 'breakeven'].includes(od.mode)) return null;
  return { od, state: cc.dropState ?? null, forced: !!cc.forceDrop, martingale: od.mode === 'martingale' };
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

  // confirmText null = sem confirmação (Cancelar compra — nada foi comprado ainda).
  const run = async (id, action, confirmText, spent, okText) => {
    if (busyId || (confirmText && !window.confirm(confirmText))) return;
    setBusyId(id);
    setMessage(null);
    try {
      const r = await action(id);
      setMessage({
        ok: true,
        text: okText ? okText : r?.status === 'SOLD'
          ? `#${id} vendida a ~${fmtPrice(r.exit?.exitPrice)} (${fmtPrice(r.exit?.usdtOut)} USDT${
            spent > 0 && Number.isFinite(Number(r.exit?.usdtOut))
              ? ` · ${fmtPct(spent, Number(r.exit.usdtOut))}`
              : ''})`
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
        // Resultado estimado da venda imediata a mercado (preço atual × preço médio da compra; sem
        // taxa nem slippage) — em % e em USDT sobre o valor gasto na compra.
        const sellPct = mounted && marketPrice && entry > 0 ? ((marketPrice - entry) / entry) * 100 : null;
        const spent = Number(o.fill?.quoteQty) || Number(o.usdt);
        const sellTxt = sellPct != null
          ? `${sellPct >= 0 ? '+' : ''}${sellPct.toFixed(2)}% · ${sellPct >= 0 ? '+' : ''}${(spent * sellPct / 100).toFixed(2)} USDT`
          : null;
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
                {fmtBuyTime(o.fill?.at) && <span className="text-slate-400"> · {fmtBuyTime(o.fill?.at)}</span>}
                {marketPrice && entry > 0 && (
                  <span className={marketPrice >= entry ? 'text-green-400' : 'text-red-400'}>
                    {' · agora '}<span className="text-[13px] font-bold">{fmtPct(entry, marketPrice)}</span>
                  </span>
                )}
              </div>
            ) : (
              <div className="text-yellow-300">
                {o.entry_kind === 'candle_close' ? candleCloseLabel(o) : <>{o.entry_kind === 'trigger' ? 'rompimento' : o.buy_handle ? 'limite' : 'na queda'} {fmtPrice(entry)}{limitExpiryLabel(o)}</>}
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
            {(() => {
              const rule = mounted && dropRule(o);
              if (!rule) return null;
              const { od, state, forced, martingale } = rule;
              const what = martingale ? `martingale ${Number(od.martingaleUsdt)} USDT` : 'alvo na entrada';
              const below = marketPrice && entry > 0 && marketPrice < entry;
              const canForce = o.status === 'BRACKETED' && !state && !forced;
              return (
                <div className="mt-0.5">
                  <div className="text-slate-400">
                    se cair {Number(od.dropPct)}%: {what}
                    {state && <span className={state.stage === 'failed' ? ' text-red-400' : ' text-amber-300'}>
                      {' · '}{DROP_STAGE_LABEL[state.stage] ?? state.stage}{state.forced ? ' (adiantado)' : ''}
                    </span>}
                    {forced && !state && <span className="text-amber-300"> · adiantado — bot executa em até 15s</span>}
                  </div>
                  {canForce && (
                    <button
                      onClick={() => run(o.id, dropNowManualOcoOrder,
                        `Adiantar AGORA a regra de queda da #${o.id} de ${o.symbol}?\n\n`
                        + `A regra espera −${Number(od.dropPct)}%; agora está em ${marketPrice && entry > 0 ? fmtPct(entry, marketPrice) : '?'}.\n\n`
                        + (martingale
                          ? `O bot move o alvo da OCO pra entrada (${fmtPrice(entry)}) e COMPRA ${Number(od.martingaleUsdt)} USDT a mercado, com alvo na 1ª entrada e stop −${Number(od.martingaleStopPct)}% da 2ª.`
                          : `O bot move o alvo da OCO pra entrada (${fmtPrice(entry)}), stop igual.`)
                        + '\n\nExecuta no próximo passe do bot (até 15s).',
                        0, `#${o.id}: ${what} adiantado — o bot executa em até 15s`)}
                      disabled={busy || !below}
                      title={below ? '' : 'só com o preço abaixo da compra'}
                      className="mt-1 w-full rounded bg-amber-600 py-0.5 font-bold text-white hover:bg-amber-500 disabled:opacity-40"
                    >
                      {busy ? 'Enviando…' : `${martingale ? 'Martingale agora' : 'Alvo na entrada agora'}${below ? ` (${fmtPct(entry, marketPrice)})` : ''}`}
                    </button>
                  )}
                </div>
              );
            })()}
            {o.error && <div className={`break-words ${noOco ? 'text-red-400' : 'text-amber-300'}`}>{o.error}</div>}
            {mounted && o.status !== 'SELLING' && (
              <button
                onClick={() => run(o.id, sellManualOcoOrder,
                  `Vender AGORA a mercado a posição #${o.id} de ${o.symbol}?\n\n`
                  + (sellTxt ? `Resultado estimado: ${sellTxt} (~${fmtPrice(marketPrice)}, sem taxa)\n\n` : '')
                  + 'A OCO (alvo/stop) é cancelada antes da venda.', spent)}
                disabled={busy}
                className="mt-1 w-full rounded bg-red-600 py-0.5 font-bold text-white hover:bg-red-500 disabled:opacity-40"
              >
                {busy ? 'Vendendo…' : `Vender agora${marketPrice ? ` (~${fmtPrice(marketPrice)})` : ''}`}
              </button>
            )}
            {(o.status === 'NEW' || o.status === 'OPEN') && (
              <button
                onClick={() => run(o.id, cancelManualOcoOrder, null)}
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
