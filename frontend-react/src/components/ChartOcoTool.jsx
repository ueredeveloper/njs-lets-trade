import { useEffect, useState } from 'react';
import { buyWithManualOco, createManualOcoOrder } from '../services/api';

const USDT_STORAGE_KEY = 'chartOcoUsdt';
const DEFAULT_USDT = 20;

function fmtPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '—';
  return String(Number(n.toPrecision(6)));
}

function pctOf(entry, price) {
  return ((price - entry) / entry) * 100;
}

function readStoredUsdt() {
  try {
    const v = Number(localStorage.getItem(USDT_STORAGE_KEY));
    return v > 0 ? v : DEFAULT_USDT;
  } catch { return DEFAULT_USDT; }
}

/** Campo de % que só aplica no Enter/blur — o valor exibido acompanha o arrasto da linha, mas
 *  enquanto o usuário digita ("3." etc.) não é sobrescrito. */
function PctInput({ value, onCommit, sign }) {
  const [text, setText] = useState(value.toFixed(2));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(value.toFixed(2)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = Math.abs(parseFloat(String(text).replace(',', '.')));
    if (n > 0 && n < 100) onCommit(sign * n);
  };
  return (
    <input
      type="text" inputMode="decimal" value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-14 bg-black/40 border border-slate-600 rounded px-1 text-right"
    />
  );
}

/**
 * Cartão da OCO manual do gráfico (botão "OCO"). Entrada (amarela), alvo e stop são arrastados no
 * próprio gráfico (CandlestickChartLW.jsx); aqui ficam o ajuste fino por %, o valor em USDT e a
 * execução:
 *  - entrada A MERCADO (linha amarela seguindo o preço): "Comprar agora" — compra já e coloca a
 *    OCO (POST /services/manual-oco-buy).
 *  - entrada FIXA (linha amarela arrastada): "Criar ordem no bot" — grava em manual_oco_orders e o
 *    bot RSI Momentum arma a compra (limite abaixo do preço / rompimento acima) e põe a OCO no fill.
 * Os preços são referência: a corretora pode exigir ajuste de tick/faixa e ele é feito sozinho.
 * As duas viram linha em manual_oco_orders e aparecem no gráfico + ManualOcoOrdersPanel
 * (vender/cancelar). Depois da OCO montada o bot só vigia alvo/stop — não gerencia a posição.
 */
export default function ChartOcoTool({ symbol, exchange, ocoDraft, marketPrice, onChange, onOrdersChanged, onClose }) {
  const [usdt, setUsdt] = useState(readStoredUsdt);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok: bool, text }

  useEffect(() => { setStatus(null); }, [symbol]);

  if (!ocoDraft?.entry) return null;
  const { entry, target, stop, entryLocked } = ocoDraft;
  const targetPct = pctOf(entry, target);
  const stopPct = pctOf(entry, stop);
  const rr = stopPct < 0 ? targetPct / -stopPct : null;
  const usdtNum = Number(usdt);
  const valid = usdtNum > 0 && stop < entry && entry < target;
  const entryVsMarket = entryLocked && marketPrice ? pctOf(marketPrice, entry) : null;
  const isBreakout = entryLocked && marketPrice != null && entry >= marketPrice;
  const exchangeName = exchange === 'gate' ? 'Gate.io' : 'Binance';

  const saveUsdt = (v) => {
    setUsdt(v);
    try { if (Number(v) > 0) localStorage.setItem(USDT_STORAGE_KEY, String(v)); } catch { /* sem storage */ }
  };

  const summary = () => (
    `Alvo ${fmtPrice(target)} (+${targetPct.toFixed(2)}%)\n`
    + `Stop ${fmtPrice(stop)} (${stopPct.toFixed(2)}%)\n\n`
    + `Os preços podem ser ajustados às regras da ${exchangeName} (tick / faixa permitida).`
  );

  const handleBuyNow = async () => {
    if (!valid || busy) return;
    if (!window.confirm(`Comprar ${usdtNum} USDT de ${symbol} a MERCADO (${exchangeName}) agora?\n\nEntrada ~${fmtPrice(entry)}\n${summary()}`)) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await buyWithManualOco({ symbol, exchange, usdt: usdtNum, targetPrice: target, stopPrice: stop });
      const b = r.bracket ?? {};
      setStatus({
        ok: true,
        text: `Comprado ${fmtPrice(r.bought?.filledQty)} a ~${fmtPrice(r.bought?.avgPrice)} · OCO alvo ${fmtPrice(b.targetPrice ?? target)} / stop ${fmtPrice(b.stopPrice ?? stop)}${b.clamped?.target || b.clamped?.stop ? ' (ajustada pela corretora)' : ''}`,
      });
    } catch (err) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setBusy(false);
      onOrdersChanged?.();
    }
  };

  const handleCreateOrder = async () => {
    if (!valid || busy) return;
    const how = isBreakout
      ? `compra a MERCADO quando o preço SUBIR até ${fmtPrice(entry)} (rompimento)`
      : `LIMIT de compra em ${fmtPrice(entry)} (compra se o preço CAIR até lá)`;
    if (!window.confirm(`Criar ordem de ${usdtNum} USDT em ${symbol} (${exchangeName})?\n\n${how}\n${summary()}\n\nQuem executa é o bot RSI Momentum — ele precisa estar rodando.`)) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await createManualOcoOrder({ symbol, exchange, usdt: usdtNum, entryPrice: entry, targetPrice: target, stopPrice: stop });
      setStatus({ ok: true, text: `Ordem #${r.id} criada (${r.entry_kind === 'trigger' ? 'rompimento' : 'limite'}) — o bot arma em até ~15s.` });
    } catch (err) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setBusy(false);
      onOrdersChanged?.();
    }
  };

  return (
    <div
      className="absolute bottom-10 left-2 z-30 w-72 max-w-[calc(100%-1rem)] rounded-md border border-slate-600 bg-slate-900/95 p-2 text-[11px] font-mono text-slate-200 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold">OCO · {symbol}{exchange === 'gate' ? ' (Gate)' : ''}</span>
        <button onClick={onClose} title="Remover a OCO do gráfico" className="px-1 text-slate-400 hover:text-white">×</button>
      </div>
      <div className="mb-1 text-[10px] text-slate-400">Arraste as linhas amarela (entrada), verde e vermelha.</div>
      <div className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-x-1 gap-y-1">
        <span className="text-yellow-300">Entrada</span>
        <span>{fmtPrice(entry)}</span>
        {entryLocked ? (
          <button
            onClick={() => marketPrice && onChange({ ...ocoDraft, entry: marketPrice, entryLocked: false })}
            title="Voltar a entrada pro preço atual (compra a mercado)"
            className="text-[10px] text-yellow-300 hover:text-white"
          >
            {entryVsMarket != null ? `${entryVsMarket >= 0 ? '+' : ''}${entryVsMarket.toFixed(2)}% ` : ''}↺
          </button>
        ) : (
          <span className="text-[10px] text-slate-500">mercado</span>
        )}

        <span className="text-green-400">Alvo</span>
        <span>{fmtPrice(target)}</span>
        <span className="flex items-center gap-0.5 text-green-400">
          +<PctInput value={targetPct} sign={1} onCommit={(p) => onChange({ ...ocoDraft, target: entry * (1 + p / 100) })} />%
        </span>

        <span className="text-red-400">Stop</span>
        <span>{fmtPrice(stop)}</span>
        <span className="flex items-center gap-0.5 text-red-400">
          −<PctInput value={-stopPct} sign={-1} onCommit={(p) => onChange({ ...ocoDraft, stop: entry * (1 + p / 100) })} />%
        </span>

        <span className="text-slate-400">Valor</span>
        <span className="flex items-center gap-1">
          <input
            type="number" min="0" step="1" value={usdt}
            onChange={(e) => saveUsdt(e.target.value)}
            className="w-16 bg-black/40 border border-slate-600 rounded px-1 text-right"
          />
          USDT
        </span>
        <span />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>R:R {rr != null ? rr.toFixed(2) : '—'}</span>
        {usdtNum > 0 && (
          <span>
            <span className="text-green-400">+{(usdtNum * targetPct / 100).toFixed(2)}</span>
            {' / '}
            <span className="text-red-400">{(usdtNum * stopPct / 100).toFixed(2)}</span> USDT
          </span>
        )}
      </div>
      {entryLocked ? (
        <button
          onClick={handleCreateOrder}
          disabled={!valid || busy}
          className="mt-2 w-full rounded bg-yellow-500 py-1 font-bold text-black hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Enviando…' : `Criar ordem no bot (${isBreakout ? 'rompimento' : 'limite'})`}
        </button>
      ) : (
        <button
          onClick={handleBuyNow}
          disabled={!valid || busy}
          className="mt-2 w-full rounded bg-green-600 py-1 font-bold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Enviando…' : 'Comprar agora'}
        </button>
      )}
      {!valid && usdtNum > 0 && (
        <div className="mt-1 text-[10px] text-amber-400">Preço atual fora da OCO — reposicione as linhas.</div>
      )}
      {status && (
        <div className={`mt-1 break-words text-[10px] ${status.ok ? 'text-green-400' : 'text-red-400'}`}>{status.text}</div>
      )}
    </div>
  );
}
