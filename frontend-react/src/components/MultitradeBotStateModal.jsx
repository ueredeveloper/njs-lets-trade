import { useEffect, useMemo, useState } from 'react';
import {
  STRATEGY_LABELS, STRATEGY_COLORS, normalizeStrategyId,
} from '../constants/strategyPresets';
import { multitradePhaseBadge, PHASE_HINT_PT, fmtBuyTimeShort } from '../utils/multitradePhase';
import { useI18n } from '../i18n';
import { fetchBinancePrice, fetchGatePrice } from '../services/api';
import BracketDragSlider from './BracketDragSlider';

const MT_COLOR = '#22d3ee';
const DEFAULT_OCO_TARGET_PCT = 3;
const DEFAULT_OCO_STOP_PCT = 5;

function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function PhaseStatusCard({ phase, entry }) {
  const { lang } = useI18n();
  const ph = multitradePhaseBadge(phase, lang);
  const isBought = phase === 'BOUGHT';
  const isPending = phase === 'PENDING';

  let botDoes = 'Monitora sinais de entrada (cruzamento de MAs) e compra automaticamente quando der.';
  if (isBought) botDoes = 'Considera que você tem posição aberta e monitora sinais de saída (cruzamento inverso, stop-loss).';
  if (isPending) botDoes = 'Aguardando preço de compra (estado pendente legado).';

  return (
    <div className="rounded-lg p-3 space-y-2" style={{ background: `${ph.color}10`, border: `1px solid ${ph.color}44` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-p5/50">Situação agora</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: `${ph.color}22`, color: ph.color }}>
          {ph.text}
        </span>
      </div>
      <p className="text-[10px] text-p5/55 leading-relaxed">{PHASE_HINT_PT[phase] ?? PHASE_HINT_PT.WATCHING}</p>
      <p className="text-[9px] text-p5/40 leading-relaxed">
        <span className="text-p5/60 font-semibold">Bot: </span>
        {botDoes}
      </p>
      {isBought && entry?.buyTime && (
        <div className="text-[9px] font-mono text-p5/60 pt-1 border-t border-p2/30 space-y-0.5">
          <div>Compra registrada: {fmtBuyTimeShort(entry.buyTime)}</div>
          {entry.buyPrice != null && <div>Preço: {Number(entry.buyPrice)}</div>}
          {entry.buyQty != null && <div>Quantidade: {Number(entry.buyQty)}</div>}
        </div>
      )}
    </div>
  );
}

function ActionCard({ number, title, when, children, accent = MT_COLOR }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${accent}44` }}>
      <div className="px-3 py-2 flex items-start gap-2" style={{ background: `${accent}12` }}>
        <span
          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ background: `${accent}33`, color: accent }}>
          {number}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-p5 leading-snug">{title}</p>
          {when && <p className="text-[9px] text-p5/45 mt-0.5 leading-relaxed">{when}</p>}
        </div>
      </div>
      <div className="px-3 py-3 space-y-2" style={{ background: '#0f1219' }}>{children}</div>
    </div>
  );
}

const PULLBACK_PRESETS = [1, 2, 3, 5];

/** Comprar mais (média de preço) numa posição BOUGHT — mercado (imediato, atualiza
 *  buy_price/buy_qty na hora) ou pullback (ordem LIMIT resting X% abaixo do preço atual,
 *  só preenche depois — bookkeeping não muda até lá, ver /multitrade-buy-more). No modo
 *  mercado dá pra já configurar a OCO (alvo+stop) que o backend coloca logo depois da compra
 *  preencher, sobre a posição já com a média/quantidade atualizadas — no modo pullback isso
 *  não é oferecido porque a ordem fica resting e pode nunca encher (não dá pra saber a posição
 *  final na hora de montar a OCO). */
function BuyMoreCard({ symbol, exchange, strategyId, defaultAmount, currentBuyPrice, onBuyMore }) {
  const [mode, setMode] = useState('market'); // 'market' | 'pullback'
  const [pullbackPct, setPullbackPct] = useState(PULLBACK_PRESETS[0]);
  const [amount, setAmount] = useState(defaultAmount != null ? String(defaultAmount) : '');
  const [wantsOco, setWantsOco] = useState(false);
  const [ocoTargetPct, setOcoTargetPct] = useState(DEFAULT_OCO_TARGET_PCT);
  const [ocoStopPct, setOcoStopPct] = useState(DEFAULT_OCO_STOP_PCT);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const amountNum = Number(amount);
  const isValidAmount = Number.isFinite(amountNum) && amountNum > 0;
  const showOco = mode === 'market';

  // Preço atual só importa pro aviso de faixa do slider (mesma ideia do modo OCO em
  // MultitradeSellModal) — busca uma vez ao ligar, não repolla enquanto o usuário arrasta.
  useEffect(() => {
    if (!showOco || !wantsOco || !symbol) return;
    let cancelled = false;
    (exchange === 'gate' ? fetchGatePrice(symbol) : fetchBinancePrice(symbol))
      .then(({ price }) => { if (!cancelled) setCurrentPrice(price); })
      .catch(() => { if (!cancelled) setCurrentPrice(null); });
    return () => { cancelled = true; };
  }, [showOco, wantsOco, symbol, exchange]);

  async function handleConfirm() {
    if (!isValidAmount) return;
    setBuying(true);
    setError(null);
    setResult(null);
    try {
      const res = await onBuyMore({
        strategyId,
        amountUsdt: amountNum,
        mode,
        pullbackPct: mode === 'pullback' ? pullbackPct : undefined,
        oco: showOco && wantsOco ? { targetPct: ocoTargetPct, stopPct: ocoStopPct } : undefined,
      });
      setResult(res);
    } catch (err) {
      setError(err?.message ?? 'Falha ao comprar mais');
    } finally {
      setBuying(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        {[{ id: 'market', label: 'Preço de mercado' }, { id: 'pullback', label: 'Pullback' }].map(m => (
          <button key={m.id} type="button" disabled={buying} onClick={() => { setMode(m.id); setResult(null); }}
            className="flex-1 py-1 text-[10px] rounded font-semibold disabled:opacity-50"
            style={{
              background: mode === m.id ? '#22c55e' : 'transparent',
              color: mode === m.id ? '#000' : '#4ade80',
              border: '1px solid #22c55e', opacity: mode === m.id ? 1 : 0.55,
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'pullback' && (
        <div className="flex gap-1">
          {PULLBACK_PRESETS.map(pct => (
            <button key={pct} type="button" disabled={buying} onClick={() => setPullbackPct(pct)}
              className="flex-1 py-1 rounded text-[9px] font-semibold disabled:opacity-50"
              style={{
                background: pullbackPct === pct ? '#22c55e22' : '#1a1d2a',
                color: pullbackPct === pct ? '#4ade80' : '#94a3b8',
                border: `1px solid ${pullbackPct === pct ? '#22c55e55' : '#2a2d3a'}`,
              }}>
              -{pct}%
            </button>
          ))}
        </div>
      )}

      <label className="block">
        <span className="text-[9px] text-p5/40">Valor a comprar (USDT)</span>
        <input type="number" step="any" min="0" disabled={buying} value={amount}
          onChange={e => { setAmount(e.target.value); setResult(null); }}
          className="w-full mt-0.5 px-2 py-1.5 rounded text-[11px] font-mono bg-p1 border border-p2 text-p5" />
      </label>

      {mode === 'pullback' && (
        <p className="text-[9px] text-p5/40 leading-relaxed">
          Ordem LIMIT fica parada na corretora {pullbackPct}% abaixo do preço atual — só executa se o preço cair até lá.
          OCO não dá pra configurar aqui nesse modo (a posição final só se sabe quando/se a ordem encher) — coloque
          depois em "Vender → OCO" se preencher.
        </p>
      )}

      {showOco && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a2d3a' }}>
          <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer" style={{ background: '#1a1d2a' }}>
            <input type="checkbox" checked={wantsOco} disabled={buying}
              onChange={e => { setWantsOco(e.target.checked); setResult(null); }}
              className="shrink-0 accent-cyan-500" />
            <span className="text-[10px] font-semibold text-p5/80">Colocar OCO (alvo + stop) logo após a compra</span>
          </label>
          {wantsOco && (
            <div className="px-2 py-2" style={{ background: '#0f1219' }}>
              <BracketDragSlider
                entryPrice={currentBuyPrice}
                targetPct={ocoTargetPct}
                stopPct={ocoStopPct}
                onChangeTarget={setOcoTargetPct}
                onChangeStop={setOcoStopPct}
                disabled={buying}
                currentPrice={currentPrice}
              />
              <p className="text-[9px] text-p5/40 leading-relaxed mt-1">
                Alvo/stop calculados sobre a média de preço DEPOIS dessa compra (não sobre o preço de compra atual
                mostrado no eixo, que é só referência).
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {result && !error && (
        <p className="text-[10px] text-emerald-400">
          {result.order?.mode === 'pullback'
            ? `Ordem LIMIT colocada a ${Number(result.order.price ?? result.order.referencePrice).toFixed(6)} — aguardando preenchimento.`
            : `Comprado mais ${Number(result.order?.filledQty ?? 0).toFixed(6)} a ${Number(result.order?.avgPrice ?? 0).toFixed(6)}.`}
          {result.oco && ' OCO colocada.'}
        </p>
      )}
      {result?.ocoError && <p className="text-[10px] text-amber-400">{result.ocoError}</p>}

      <button type="button" disabled={buying || !isValidAmount} onClick={handleConfirm}
        className="w-full py-2 rounded text-[10px] font-bold disabled:opacity-50"
        style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e55' }}>
        {buying ? 'Comprando…' : mode === 'pullback' ? `Colocar ordem -${pullbackPct}%` : 'Comprar mais agora'}
      </button>
    </>
  );
}

function BoughtFormFields({ buyPrice, buyQty, buyTime, onPrice, onQty, onTime }) {
  return (
    <>
      <label className="block">
        <span className="text-[9px] text-p5/40">Preço de compra</span>
        <input type="number" step="any" value={buyPrice} onChange={e => onPrice(e.target.value)}
          className="w-full mt-0.5 px-2 py-1.5 rounded text-[11px] font-mono bg-p1 border border-p2 text-p5" />
      </label>
      <label className="block">
        <span className="text-[9px] text-p5/40">Quantidade</span>
        <input type="number" step="any" value={buyQty} onChange={e => onQty(e.target.value)}
          className="w-full mt-0.5 px-2 py-1.5 rounded text-[11px] font-mono bg-p1 border border-p2 text-p5" />
      </label>
      <label className="block">
        <span className="text-[9px] text-p5/40">Data e hora da compra</span>
        <input type="datetime-local" value={buyTime} onChange={e => onTime(e.target.value)}
          className="w-full mt-0.5 px-2 py-1.5 rounded text-[11px] font-mono bg-p1 border border-p2 text-p5" />
      </label>
    </>
  );
}

export default function MultitradeBotStateModal({
  symbol,
  entries,
  onConfirm,
  onCancel,
  onBuyMore,
}) {
  const activeEntries = useMemo(
    () => (entries ?? []).filter(e => e.enabled !== false),
    [entries],
  );

  const [strategyId, setStrategyId] = useState(
    () => normalizeStrategyId(activeEntries[0]?.strategyId ?? 'ma-cross'),
  );
  const [buyPrice, setBuyPrice] = useState('');
  const [buyQty, setBuyQty] = useState('');
  const [buyTime, setBuyTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmSold, setConfirmSold] = useState(false);
  const [showEditBought, setShowEditBought] = useState(false);

  const entry = activeEntries.find(e => normalizeStrategyId(e.strategyId) === strategyId)
    ?? activeEntries[0];

  const phase = entry?.phase ?? 'WATCHING';
  const isWatching = phase === 'WATCHING';
  const isBought = phase === 'BOUGHT';
  const isPending = phase === 'PENDING';

  useEffect(() => {
    if (!entry) return;
    setBuyPrice(entry.buyPrice != null ? String(entry.buyPrice) : '');
    setBuyQty(entry.buyQty != null ? String(entry.buyQty) : '');
    setBuyTime(toLocalInputValue(entry.buyTime));
    setError(null);
    setConfirmSold(false);
    setShowEditBought(false);
  }, [entry?.id, entry?.phase, entry?.buyPrice, entry?.buyQty, entry?.buyTime]);

  async function applyPhase(nextPhase) {
    if (!entry) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { symbol, strategyId: normalizeStrategyId(entry.strategyId), phase: nextPhase };
      if (nextPhase === 'BOUGHT') {
        const price = Number(buyPrice);
        const qty = Number(buyQty);
        const timeIso = localInputToIso(buyTime);
        if (!Number.isFinite(price) || price <= 0) throw new Error('Preço de compra inválido');
        if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantidade inválida');
        if (!timeIso) throw new Error('Data/hora da compra obrigatória');
        payload.buyPrice = price;
        payload.buyQty = qty;
        payload.buyTime = timeIso;
      }
      await onConfirm(payload);
      onCancel?.();
    } catch (err) {
      setError(err?.message ?? 'Não foi possível atualizar o estado');
    } finally {
      setSaving(false);
    }
  }

  if (!activeEntries.length) return null;

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onCancel}>
      <div
        className="absolute inset-x-4 top-12 bottom-8 max-w-sm mx-auto rounded-lg shadow-2xl border flex flex-col"
        style={{ background: '#131722', borderColor: '#2a2d3a' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b shrink-0" style={{ borderColor: '#2a2d3a' }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-sm font-bold text-p5">Estado do bot</span>
              <p className="text-[11px] font-mono font-bold mt-0.5" style={{ color: MT_COLOR }}>{symbol}</p>
            </div>
            <button type="button" onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none">×</button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 min-h-0">
          {activeEntries.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              {activeEntries.map(e => {
                const sid = normalizeStrategyId(e.strategyId);
                const on = sid === strategyId;
                return (
                  <button key={e.id} type="button" onClick={() => setStrategyId(sid)}
                    className="text-[9px] font-bold px-2 py-1 rounded"
                    style={{
                      background: on ? `${STRATEGY_COLORS[sid]}33` : '#2a2d3a',
                      color: on ? STRATEGY_COLORS[sid] : '#94a3b8',
                      border: `1px solid ${on ? STRATEGY_COLORS[sid] + '55' : '#3a3d4a'}`,
                    }}>
                    {STRATEGY_LABELS[sid]}
                  </button>
                );
              })}
            </div>
          )}

          <PhaseStatusCard phase={phase} entry={entry} />

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-p5/50 mb-2">
              O que você pode fazer
            </p>
            <div className="space-y-2.5">

              {/* WATCHING: só registrar compra manual */}
              {isWatching && (
                <ActionCard
                  number={1}
                  title="Registrar compra manual → BOUGHT"
                  when="Use se você comprou na corretora por conta própria e quer que o bot gerencie a saída."
                  accent="#22c55e"
                >
                  <BoughtFormFields
                    buyPrice={buyPrice} buyQty={buyQty} buyTime={buyTime}
                    onPrice={setBuyPrice} onQty={setBuyQty} onTime={setBuyTime}
                  />
                  <button type="button" disabled={saving} onClick={() => applyPhase('BOUGHT')}
                    className="w-full py-2 rounded text-[10px] font-bold disabled:opacity-50"
                    style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e55' }}>
                    Salvar como BOUGHT
                  </button>
                </ActionCard>
              )}

              {/* BOUGHT: vender / limpar posição */}
              {isBought && (
                <>
                  <ActionCard
                    number={1}
                    title="Vendi na corretora → WATCHING"
                    when="Use depois de vender manualmente. O bot para de gerenciar saída e volta a buscar nova entrada."
                    accent="#3b82f6"
                  >
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={confirmSold} onChange={e => setConfirmSold(e.target.checked)}
                        className="mt-0.5 shrink-0 accent-cyan-500" />
                      <span className="text-[10px] text-p5/70 leading-snug">
                        Confirmo que não tenho mais esta moeda na carteira (venda manual feita)
                      </span>
                    </label>
                    <button type="button" disabled={saving || !confirmSold} onClick={() => applyPhase('WATCHING')}
                      className="w-full py-2 rounded text-[10px] font-bold disabled:opacity-40"
                      style={{ background: '#3b82f622', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                      Aplicar WATCHING
                    </button>
                  </ActionCard>

                  <ActionCard
                    number={2}
                    title="Corrigir dados da compra"
                    when="Ajuste preço, quantidade ou hora se o registro estiver errado (continua BOUGHT)."
                    accent="#94a3b8"
                  >
                    {!showEditBought ? (
                      <button type="button" onClick={() => setShowEditBought(true)}
                        className="w-full py-2 rounded text-[10px] font-semibold text-p5/60"
                        style={{ background: '#2a2d3a', border: '1px solid #3a3d4a' }}>
                        Abrir formulário de correção
                      </button>
                    ) : (
                      <>
                        <BoughtFormFields
                          buyPrice={buyPrice} buyQty={buyQty} buyTime={buyTime}
                          onPrice={setBuyPrice} onQty={setBuyQty} onTime={setBuyTime}
                        />
                        <button type="button" disabled={saving} onClick={() => applyPhase('BOUGHT')}
                          className="w-full py-2 rounded text-[10px] font-bold disabled:opacity-50"
                          style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e55' }}>
                          Atualizar BOUGHT
                        </button>
                      </>
                    )}
                  </ActionCard>

                  {onBuyMore && (
                    <ActionCard
                      number={3}
                      title="Comprar mais (média de preço)"
                      when="Adiciona à posição atual — a mercado (imediato) ou pullback (ordem limite abaixo do preço atual, só executa se cair até lá)."
                      accent="#22c55e"
                    >
                      <BuyMoreCard
                        symbol={symbol}
                        exchange={entry?.exchange}
                        strategyId={normalizeStrategyId(entry.strategyId)}
                        defaultAmount={entry?.capital}
                        currentBuyPrice={entry?.buyPrice}
                        onBuyMore={onBuyMore}
                      />
                    </ActionCard>
                  )}
                </>
              )}

              {/* PENDING: cancelar ou registrar compra */}
              {isPending && (
                <>
                  <ActionCard
                    number={1}
                    title="Cancelar pendência → WATCHING"
                    when="Remove o estado pendente. O bot não tentará mais aquela compra limit."
                    accent="#3b82f6"
                  >
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={confirmSold} onChange={e => setConfirmSold(e.target.checked)}
                        className="mt-0.5 shrink-0 accent-cyan-500" />
                      <span className="text-[10px] text-p5/70">Confirmo cancelar o estado pendente</span>
                    </label>
                    <button type="button" disabled={saving || !confirmSold} onClick={() => applyPhase('WATCHING')}
                      className="w-full py-2 rounded text-[10px] font-bold disabled:opacity-40"
                      style={{ background: '#3b82f622', color: '#93c5fd', border: '1px solid #3b82f655' }}>
                      Aplicar WATCHING
                    </button>
                  </ActionCard>
                  <ActionCard
                    number={2}
                    title="Registrar compra executada → BOUGHT"
                    when="Se a ordem pendente foi preenchida ou você comprou manualmente."
                    accent="#22c55e"
                  >
                    <BoughtFormFields
                      buyPrice={buyPrice} buyQty={buyQty} buyTime={buyTime}
                      onPrice={setBuyPrice} onQty={setBuyQty} onTime={setBuyTime}
                    />
                    <button type="button" disabled={saving} onClick={() => applyPhase('BOUGHT')}
                      className="w-full py-2 rounded text-[10px] font-bold disabled:opacity-50"
                      style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e55' }}>
                      Salvar como BOUGHT
                    </button>
                  </ActionCard>
                </>
              )}
            </div>
          </div>

          {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
