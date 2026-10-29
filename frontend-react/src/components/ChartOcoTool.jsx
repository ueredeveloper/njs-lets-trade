import { useEffect, useMemo, useState } from 'react';
import { buyWithManualOco, createManualOcoOrder } from '../services/api';

// v3: o padrão caiu de 50 pra 40 USDT — chave nova pra não herdar o 50 já salvo.
const USDT_STORAGE_KEY = 'chartOcoUsdtV3';
const DEFAULT_USDT = 40;

function fmtPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '—';
  return String(Number(n.toPrecision(6)));
}

/** "1h", "4h", "15m"… a partir da duração do candle (ms). */
function fmtIntervalMs(ms) {
  if (!(ms > 0)) return '?';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

/** Duração aproximada legível: "~6 h", "~1 dia", "~4 dias". */
function fmtSpan(ms) {
  const h = ms / 3_600_000;
  if (h < 20) return `~${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `~${d} dia${d === 1 ? '' : 's'}`;
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
 *    bot RSI Momentum vigia o preço e compra A MERCADO quando ele chega na entrada (caindo até ela /
 *    rompendo acima) e põe a OCO — nada na corretora antes, o saldo só é usado na compra.
 * Os preços são referência: a corretora pode exigir ajuste de tick/faixa e ele é feito sozinho.
 * As duas viram linha em manual_oco_orders e aparecem no gráfico + ManualOcoOrdersPanel
 * (vender/cancelar). Depois da OCO montada o bot só vigia alvo/stop — não gerencia a posição.
 */
export default function ChartOcoTool({ symbol, exchange, ocoDraft, marketPrice, suggester, onChange, onOrdersChanged, onClose }) {
  const [usdt, setUsdt] = useState(readStoredUsdt);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok: bool, text }

  useEffect(() => { setStatus(null); }, [symbol]);

  // Sugestão pra entrada atual (ocoSuggest.js) + a MESMA estatística aplicada ao alvo/stop que
  // está desenhado agora — dá pra comparar "12%/6% que eu quero" × "o que a moeda anda fazendo".
  const entryPx = ocoDraft?.entry;
  const suggestion = useMemo(() => (entryPx ? suggester?.suggest(entryPx) ?? null : null), [suggester, entryPx]);
  const currentStats = useMemo(() => {
    if (!suggestion || !ocoDraft?.entry) return null;
    const t = pctOf(ocoDraft.entry, ocoDraft.target);
    const s = -pctOf(ocoDraft.entry, ocoDraft.stop);
    return t > 0 && s > 0 ? suggestion.evalPct(t, s) : null;
  }, [suggestion, ocoDraft]);

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
      : `compra a MERCADO quando o preço CAIR até ${fmtPrice(entry)}`;
    if (!window.confirm(`Criar ordem de ${usdtNum} USDT em ${symbol} (${exchangeName})?\n\n${how}\n${summary()}\n\nNada vai pra corretora antes disso: o bot RSI Momentum vigia o preço (precisa estar rodando) e o saldo só é usado na hora da compra. Alvo e stop ficam nos mesmos % sobre o preço que for realmente comprado.`)) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await createManualOcoOrder({ symbol, exchange, usdt: usdtNum, entryPrice: entry, targetPrice: target, stopPrice: stop });
      setStatus({ ok: true, text: `Ordem #${r.id} criada no bot (${r.entry_kind === 'trigger' ? 'rompimento' : 'queda'}) — compra a mercado quando o preço chegar em ${fmtPrice(entry)}.` });
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
        <span>
          R:R {rr != null ? rr.toFixed(2) : '—'}
          {currentStats && (
            <span
              className={currentStats.winRate >= currentStats.lossRate ? 'text-slate-300' : 'text-orange-300'}
              title="Chance de bater o alvo / o stop primeiro com as linhas desenhadas"
            >
              {' · '}alvo {(currentStats.winRate * 100).toFixed(0)}% · stop {(currentStats.lossRate * 100).toFixed(0)}%
            </span>
          )}
        </span>
        {usdtNum > 0 && (
          <span>
            <span className="text-green-400">+{(usdtNum * targetPct / 100).toFixed(2)}</span>
            {' / '}
            <span className="text-red-400">{(usdtNum * stopPct / 100).toFixed(2)}</span>
          </span>
        )}
      </div>
      {suggestion && (
        <div className="mt-1 flex items-center justify-between gap-1 rounded border border-sky-800 bg-sky-950/40 px-1 py-0.5 text-[10px]">
          <span className="text-sky-300">
            Sugestão <span className="text-green-400">+{suggestion.targetPct}%</span>/<span className="text-red-400">−{suggestion.stopPct}%</span>
            <span className="text-slate-400"> · alvo {(suggestion.winRate * 100).toFixed(0)}% · stop {(suggestion.lossRate * 100).toFixed(0)}%</span>
            {suggestion.notes.length > 0 && <span className="text-amber-300" title={suggestion.notes.join('\n')}> ⚠</span>}
          </span>
          <button
            onClick={() => onChange({ ...ocoDraft, target: suggestion.targetPrice, stop: suggestion.stopPrice })}
            title="Aplicar alvo e stop sugeridos"
            className="rounded bg-sky-700 px-1.5 text-white hover:bg-sky-600"
          >
            Aplicar
          </button>
        </div>
      )}
      <details className="mt-1 text-[10px] leading-snug">
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">Detalhes</summary>
        <div className="mt-0.5">
          <div className="text-slate-400">Arraste as linhas amarela (entrada), verde e vermelha.</div>
          {suggestion && (<>
          <div className="text-sky-200">
            gráfico {fmtIntervalMs(suggestion.intervalMs)} · horizonte {suggestion.horizon} candles ({fmtSpan(suggestion.horizonMs)})
          </div>
          <div className="text-slate-300">
            em {suggestion.horizon} candles: alvo {(suggestion.winRate * 100).toFixed(0)}% · stop {(suggestion.lossRate * 100).toFixed(0)}% · nenhum {(suggestion.openRate * 100).toFixed(0)}%
          </div>
          <div className="text-slate-400">
            com stop −{suggestion.stopPct}%: {suggestion.ladder.map((l) => `+${l.targetPct}% ${(l.winRate * 100).toFixed(0)}%`).join(' · ')}
          </div>
          <div className="text-slate-400">
            máx. de alta em {suggestion.horizon} candles: mediana +{suggestion.mfeMedian.toFixed(1)}% · 1 em 4 +{suggestion.mfeP75.toFixed(1)}%
            {suggestion.atrPct != null && ` · ATR ${suggestion.atrPct.toFixed(1)}%`}
          </div>
          {(suggestion.resistance || suggestion.support) && (
            <div className="text-slate-400">
              {suggestion.resistance && `R ${fmtPrice(suggestion.resistance.price)} (${pctOf(entry, suggestion.resistance.price).toFixed(1)}%)`}
              {suggestion.resistance && suggestion.support && ' · '}
              {suggestion.support && `S ${fmtPrice(suggestion.support.price)} (${pctOf(entry, suggestion.support.price).toFixed(1)}%)`}
            </div>
          )}
          {suggestion.notes.length > 0 && <div className="text-amber-300">{suggestion.notes.join(' · ')}</div>}
          <div className="text-slate-500">frequência em {suggestion.samples} candles de {fmtIntervalMs(suggestion.intervalMs)} desta tela, sem sinal — chance, não garantia (trocou o intervalo? clique em Aplicar)</div>
          </>)}
        </div>
      </details>
      {entryLocked ? (
        <button
          onClick={handleCreateOrder}
          disabled={!valid || busy}
          className="mt-2 w-full rounded bg-yellow-500 py-1 font-bold text-black hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Enviando…' : `Criar ordem no bot (${isBreakout ? 'rompimento' : 'queda'})`}
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
