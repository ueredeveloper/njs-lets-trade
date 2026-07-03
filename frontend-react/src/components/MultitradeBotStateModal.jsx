import { useEffect, useMemo, useState } from 'react';
import {
  STRATEGY_LABELS, STRATEGY_COLORS, normalizeStrategyId,
} from '../constants/strategyPresets';
import { multitradePhaseBadge, PHASE_HINT_PT, fmtBuyTimeShort } from '../utils/multitradePhase';

const MT_COLOR = '#22d3ee';

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
  const ph = multitradePhaseBadge(phase);
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
