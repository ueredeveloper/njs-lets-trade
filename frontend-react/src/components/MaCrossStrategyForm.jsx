import { useState, useEffect } from 'react';
import { suggestMaCrossFilterBounds, checkMultitradeVolume, fetchRsiOversoldRecovery, fetchSimpleMaCross, fetchBollingerBandRecovery } from '../services/api';
import {
  MA_CROSS_INTERVALS, MA_PERIOD_PRESETS, MA_CROSS_PERIOD_MIN, MA_CROSS_PERIOD_MAX,
  CROSS_DIRECTIONS, PRICE_FILTER_MODES,
  EXIT_LOGIC_OPTIONS,
  VOLUME_OPTIONS, PENDING_TIMEOUT_OPTIONS, POLL_OPTIONS,
  MA_CROSS_DEFAULTS,
  computeDcaTiers,
} from '../constants/maCrossConfigSchema';

const ENTRY_COLOR  = '#22d3ee';
const EXIT_COLOR   = '#ef5350';
const FILTER_COLOR = '#a78bfa';

function NumInput({ value, onChange, min, max, step = 0.1, className = 'w-16', placeholder }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step} placeholder={placeholder}
      className={`rounded px-2 py-1 text-xs text-p5 outline-none font-mono ${className}`}
      style={{ background: '#1e2130', border: '1px solid #2a2d3a' }} />
  );
}

function MaLegInput({ label, ma1, ma2, onPatchMa1, onPatchMa2 }) {
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' };
  const Leg = ({ title, leg, onPatch }) => (
    <div>
      <span className="text-p5/50 text-[10px] block mb-1">{title}</span>
      <div className="flex gap-1 flex-wrap">
        <NumInput value={leg.period} onChange={v => onPatch('period', v)} min={MA_CROSS_PERIOD_MIN} max={MA_CROSS_PERIOD_MAX} step={1} className="w-14" />
        <select value={leg.interval} onChange={e => onPatch('interval', e.target.value)}
          className="rounded px-1 py-1 text-xs flex-1 min-w-[3.5rem]" style={sel}>
          {MA_CROSS_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
        </select>
      </div>
      <div className="flex gap-0.5 mt-1 flex-wrap">
        {MA_PERIOD_PRESETS.map(p => (
          <button key={p} type="button" onClick={() => onPatch('period', p)}
            className="text-[8px] px-1 py-0.5 rounded font-mono"
            style={{
              background: leg.period === p ? '#22d3ee22' : '#1e2130',
              color: leg.period === p ? '#22d3ee' : '#64748b',
              border: '1px solid #2a2d3a',
            }}>{p}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <Leg title={label ? `${label} — Param1` : 'Param1'} leg={ma1} onPatch={onPatchMa1} />
      <Leg title={label ? `${label} — Param2` : 'Param2'} leg={ma2} onPatch={onPatchMa2} />
    </div>
  );
}

function CrossBlock({ title, block, prefix, patch, color, showEnable }) {
  const patchBlock = (field, val) => {
    if (field.includes('.')) {
      const [k, sub] = field.split('.');
      patch(`${prefix}.${k}.${sub}`, val);
    } else {
      patch(`${prefix}.${field}`, val);
    }
  };
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' };

  return (
    <div className="space-y-2 rounded-md p-2" style={{ background: '#1a1d28', border: `1px solid ${color}33` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{title}</span>
        {showEnable && (
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={block.enabled !== false}
              onChange={e => patch(`${prefix}.enabled`, e.target.checked)} style={{ accentColor: color }} />
            Ativo
          </label>
        )}
      </div>
      {(block.enabled !== false || !showEnable) && (
        <>
          <MaLegInput
            ma1={block.ma1} ma2={block.ma2}
            onPatchMa1={(f, v) => patchBlock(`ma1.${f}`, v)}
            onPatchMa2={(f, v) => patchBlock(`ma2.${f}`, v)}
          />
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <select value={block.direction} onChange={e => patchBlock('direction', e.target.value)}
              className="rounded px-1.5 py-1 flex-1 min-w-[10rem]" style={sel}>
              {CROSS_DIRECTIONS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <span className="text-p5/40 text-[10px]">tol %</span>
            <NumInput value={block.tolerancePct} onChange={v => patchBlock('tolerancePct', v)}
              min={0} max={5} step={0.05} className="w-14" />
          </div>
        </>
      )}
    </div>
  );
}

export default function MaCrossStrategyForm({ form, patch, symbol, exchange, hasSavedConfig = false, capital }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [boundsSuggest, setBoundsSuggest] = useState({});
  const [volCheck, setVolCheck] = useState(null);
  const [histStats, setHistStats] = useState(null);
  const [bbTargetSuggest, setBbTargetSuggest] = useState(null);
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' };
  const entryTrend = { ...MA_CROSS_DEFAULTS.entryTrendMa, ...form.entryTrendMa };
  const entryTrendOn = entryTrend.enabled !== false;

  const entryBbLower = { ...MA_CROSS_DEFAULTS.entryBbLower, ...form.entryBbLower };
  const entryBbLowerOn = entryBbLower.enabled === true;

  const entryMultiDca = { ...MA_CROSS_DEFAULTS.entryMultiDca, ...form.entryMultiDca };
  const entryMultiDcaOn = entryMultiDca.enabled === true;
  const dcaTiers = computeDcaTiers(capital, entryMultiDca.minEntryUsdt);
  const dcaCapitalBelowMin = dcaTiers.length === 1 && Number(capital) > 0 && Number(capital) < entryMultiDca.minEntryUsdt;

  const exitBbUpper = { ...MA_CROSS_DEFAULTS.exit.bbUpper, ...form.exit?.bbUpper };
  const exitBbTakeProfit = { ...MA_CROSS_DEFAULTS.exit.bbTakeProfit, ...form.exit?.bbTakeProfit };

  const entryIv = form.entry?.ma1?.interval ?? '15m';
  const exitIv  = form.exit?.maCross?.ma1?.interval ?? '30m';
  const src     = exchange === 'gate' ? 'gate' : null;

  // Aproximação 4h (entryEmaApproach) foi removida deste formulário — não usada.
  // O normalize do backend trata "enabled" ausente como true (`src.enabled !== false`),
  // então forçamos explicitamente enabled:false aqui pra garantir que moedas configuradas
  // por este form nunca entrem com esse filtro ativo por baixo dos panos.
  useEffect(() => {
    if (form.entryEmaApproach?.enabled !== false) {
      patch('entryEmaApproach.enabled', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.entryEmaApproach?.enabled]);

  useEffect(() => {
    const sym = symbol?.trim()?.toUpperCase();
    if (!sym) { setVolCheck(null); return undefined; }
    let cancelled = false;
    setVolCheck({ loading: true });
    const timer = setTimeout(() => {
      checkMultitradeVolume(sym, exchange, form.volume?.minVolumeUsdt ?? 1_000_000)
        .then(data => { if (!cancelled) setVolCheck({ ...data, loading: false }); })
        .catch(err => { if (!cancelled) setVolCheck({ loading: false, error: err.message }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, exchange, form.volume?.minVolumeUsdt]);

  useEffect(() => {
    const sym = symbol?.trim()?.toUpperCase();
    if (!sym) { setHistStats(null); return undefined; }
    let cancelled = false;
    setHistStats({ loading: true });
    const timer = setTimeout(() => {
      Promise.allSettled([
        fetchRsiOversoldRecovery(sym, entryIv, 30, 70, src),
        fetchSimpleMaCross(sym, entryIv, exitIv, src),
        fetchBollingerBandRecovery(sym, '4h', 20, 2, src),
      ]).then(([rsiRes, macrossRes, bbRes]) => {
        if (cancelled) return;
        const rsi     = rsiRes.status     === 'fulfilled' ? rsiRes.value     : null;
        const macross = macrossRes.status === 'fulfilled' ? macrossRes.value : null;
        const bb      = bbRes.status      === 'fulfilled' ? bbRes.value      : null;
        setHistStats({
          loading: false,
          rsi:     rsi     ? { avg: rsi.avgAppreciationPercent,     count: rsi.totalOccurrences }     : null,
          macross: macross ? { avg: macross.avgAppreciationPercent, count: macross.totalOccurrences } : null,
          bb:      bb      ? { avg: bb.avgAppreciationPercent,      count: bb.totalOccurrences }      : null,
          rsiErr:     rsiRes.status     === 'rejected' ? rsiRes.reason?.message     : null,
          macrossErr: macrossRes.status === 'rejected' ? macrossRes.reason?.message : null,
          bbErr:      bbRes.status      === 'rejected' ? bbRes.reason?.message      : null,
        });
      });
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, exchange, entryIv, exitIv]);

  // Sugere o alvo % automaticamente ao carregar o formulário para uma moeda
  // (mesma busca do botão "Sugerir do histórico", disparada uma vez por símbolo).
  // Só aplica o valor sugerido no campo quando não há config salva no banco —
  // se a estratégia já existe (hasSavedConfig), o valor persistido prevalece
  // e a sugestão fica só como referência (ver "Média histórica" abaixo).
  useEffect(() => {
    const sym = symbol?.trim()?.toUpperCase();
    if (!sym) { setBbTargetSuggest(null); return undefined; }
    let cancelled = false;
    setBbTargetSuggest({ loading: true });
    const timer = setTimeout(() => {
      fetchBollingerBandRecovery(sym, exitBbUpper.interval, exitBbUpper.period, exitBbUpper.stdDev, src)
        .then(r => {
          if (cancelled) return;
          setBbTargetSuggest({ avg: r.avgAppreciationPercent, count: r.totalOccurrences });
          if (r.avgAppreciationPercent > 0 && !hasSavedConfig) {
            patch('exit.bbTakeProfit.targetPct', r.avgAppreciationPercent);
          }
        })
        .catch(err => { if (!cancelled) setBbTargetSuggest({ loading: false, error: err.message }); });
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, exchange, hasSavedConfig]);

  const addFilter = () => {
    const nextId = Math.max(0, ...(form.maFilters ?? []).map(f => f.id)) + 1;
    patch('maFilters', [...(form.maFilters ?? []), {
      id: nextId, enabled: true, period: 50, interval: '1h',
      mode: 'strict_above', maxDipPct: 4, fixedDipPct: '', maxAbovePct: 4, fixedAbovePct: '',
    }]);
  };

  const updateFilter = (id, field, val) => {
    patch('maFilters', form.maFilters.map(f => f.id === id ? { ...f, [field]: val } : f));
  };

  const removeFilter = (id) => {
    patch('maFilters', form.maFilters.filter(f => f.id !== id));
  };

  async function handleSuggestBounds(filterId) {
    const sym = symbol?.trim()?.toUpperCase();
    if (!sym) return;
    setBoundsSuggest(prev => ({ ...prev, [filterId]: { loading: true } }));
    try {
      const r = await suggestMaCrossFilterBounds({
        symbol: sym,
        exchange,
        form,
        filterId,
      });
      setBoundsSuggest(prev => ({ ...prev, [filterId]: r }));
      if (r.floor?.suggestedMaxDipPct != null) {
        updateFilter(filterId, 'maxDipPct', r.floor.suggestedMaxDipPct);
      }
      if (r.ceiling?.suggestedMaxAbovePct != null) {
        updateFilter(filterId, 'maxAbovePct', r.ceiling.suggestedMaxAbovePct);
      }
    } catch (err) {
      setBoundsSuggest(prev => ({ ...prev, [filterId]: { error: err.message } }));
    }
  }

  async function handleSuggestBbTarget() {
    const sym = symbol?.trim()?.toUpperCase();
    if (!sym) return;
    setBbTargetSuggest({ loading: true });
    try {
      const r = await fetchBollingerBandRecovery(sym, exitBbUpper.interval, exitBbUpper.period, exitBbUpper.stdDev, src);
      setBbTargetSuggest({ avg: r.avgAppreciationPercent, count: r.totalOccurrences });
      if (r.avgAppreciationPercent > 0) {
        patch('exit.bbTakeProfit.targetPct', r.avgAppreciationPercent);
      }
    } catch (err) {
      setBbTargetSuggest({ error: err.message });
    }
  }

  function renderBoundsSuggest(filterId) {
    const s = boundsSuggest[filterId];
    if (!s || s.loading) return null;
    if (s.error) {
      return <p className="text-[9px] text-amber-400/90 font-mono">{s.error}</p>;
    }
    const floor = s.floor;
    const ceil = s.ceiling;
    return (
      <p className="text-[9px] text-p5/50 font-mono leading-relaxed">
        {floor && (
          <>Piso: {floor.usedDefault ? `padrão ${floor.suggestedMaxDipPct}%` : `${floor.suggestedMaxDipPct}% (${floor.episodeCount} episódios, média ${floor.avgRawDipPct ?? '—'}%)`}</>
        )}
        {floor && ceil && ' · '}
        {ceil && (
          <>Teto: {ceil.usedDefault ? `padrão ${ceil.suggestedMaxAbovePct}%` : `${ceil.suggestedMaxAbovePct}% (${ceil.signalCount} sinais, mediana +${ceil.medianStretchPct ?? '—'}%)`}</>
        )}
        {s.signalCount != null && ` · ${s.signalCount} cruzamentos analisados`}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* ════════════════ GRUPO 1 — GATILHOS DE COMPRA ════════════════ */}
      <div className="pt-1 pb-1 border-b" style={{ borderColor: `${ENTRY_COLOR}55` }}>
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: ENTRY_COLOR }}>
          🟢 Opções de compra — o que dispara a compra
        </span>
        <p className="text-[10px] text-p5/60 leading-relaxed mt-1">
          Cada bloco abaixo é um <strong>gatilho independente</strong>: qualquer um ativo já é suficiente pra
          comprar. Ligue só um, os dois, ou nenhum (bot fica parado sem comprar).
        </p>
      </div>

      <CrossBlock
        title="Compra — cruzamento EMA"
        block={form.entry}
        prefix="entry"
        patch={patch}
        color={ENTRY_COLOR}
        showEnable
      />
      <div className="flex flex-wrap items-center gap-2 text-xs px-1">
        <span className="text-p5/50">Máx % acima da MA2 (param2)</span>
        <NumInput value={form.entry.maxAboveMaPct ?? 0}
          onChange={v => patch('entry.maxAboveMaPct', v)}
          min={0} max={20} step={0.5} className="w-14" />
        <span className="text-p5/40 text-[10px]">0 = desligado</span>
      </div>

      {/* ── Gatilho de entrada — Banda inferior BB ── */}
      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${ENTRY_COLOR}33` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ENTRY_COLOR }}>
            Compra — Banda inferior BB
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={entryBbLowerOn}
              onChange={e => patch('entryBbLower.enabled', e.target.checked)} style={{ accentColor: ENTRY_COLOR }} />
            Ativo
          </label>
        </div>
        {entryBbLowerOn && (
          <>
            <p className="text-[10px] text-p5/60 leading-relaxed">
              Compra assim que o preço toca/rompe a banda inferior da BB({entryBbLower.period},{entryBbLower.stdDev}) {entryBbLower.interval} —
              gatilho independente do cruzamento EMA acima, entra imediatamente (sem pending/pullback).
              Para operar <strong>só</strong> por esta regra, desligue o cruzamento EMA (bloco acima) e as
              exigências do grupo "Filtros de compra" abaixo que não quiser manter.
            </p>
            <div className="flex flex-wrap gap-3 items-center text-xs">
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Intervalo</span>
                <select value={entryBbLower.interval}
                  onChange={e => patch('entryBbLower.interval', e.target.value)}
                  className="rounded px-1 py-1 text-xs" style={sel}>
                  {MA_CROSS_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Período</span>
                <NumInput value={entryBbLower.period}
                  onChange={v => patch('entryBbLower.period', Math.max(5, Math.round(v)))}
                  min={5} max={200} step={1} className="w-14" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">StdDev</span>
                <NumInput value={entryBbLower.stdDev}
                  onChange={v => patch('entryBbLower.stdDev', v)}
                  min={0.5} max={4} step={0.5} className="w-14" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Entradas parceladas (DCA) ── */}
      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${ENTRY_COLOR}33` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ENTRY_COLOR }}>
            Entradas parceladas (DCA)
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={entryMultiDcaOn}
              onChange={e => patch('entryMultiDca.enabled', e.target.checked)} style={{ accentColor: ENTRY_COLOR }} />
            Ativo
          </label>
        </div>
        {entryMultiDcaOn && (
          <>
            <p className="text-[10px] text-p5/60 leading-relaxed">
              Divide o capital em até 3 tranches. A 1ª entrada usa a 1ª tranche (na Banda inferior BB, que
              precisa estar configurada acima); as demais entram depois, em novos toques na mesma banda,
              respeitando o intervalo mínimo abaixo. Vende tudo de uma vez quando a saída disparar.
            </p>
            <div className="flex flex-wrap gap-3 items-center text-xs">
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Mínimo por entrada (USDT)</span>
                <NumInput value={entryMultiDca.minEntryUsdt}
                  onChange={v => patch('entryMultiDca.minEntryUsdt', Math.max(0, v))}
                  min={0} max={1000} step={1} className="w-16" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Intervalo mínimo entre entradas (h)</span>
                <NumInput value={entryMultiDca.reEntryGapHours}
                  onChange={v => patch('entryMultiDca.reEntryGapHours', Math.max(0, v))}
                  min={0} max={72} step={0.5} className="w-16" />
              </div>
              <label className="flex items-center gap-1 text-[10px] text-p5/60 cursor-pointer">
                <input type="checkbox" checked={entryMultiDca.reapplyFilters}
                  onChange={e => patch('entryMultiDca.reapplyFilters', e.target.checked)} style={{ accentColor: ENTRY_COLOR }} />
                Reaplicar filtros de tendência/EMA nas reentradas
              </label>
            </div>
            {dcaCapitalBelowMin ? (
              <p className="text-[9px] text-amber-400/90 font-mono">
                ⚠️ Capital ({Number(capital).toFixed(2)} USDT) abaixo do mínimo por entrada ({entryMultiDca.minEntryUsdt} USDT) —
                vai operar com 1 entrada só de {dcaTiers[0].toFixed(2)} USDT.
              </p>
            ) : (
              <p className="text-[9px] text-p5/50 font-mono">
                Capital {Number(capital || 0).toFixed(2)} USDT → {dcaTiers.length} {dcaTiers.length === 1 ? 'entrada' : 'entradas'}:{' '}
                {dcaTiers.map(v => v.toFixed(2)).join(' + ')} USDT
              </p>
            )}
          </>
        )}
      </div>

      {/* ════════════════ GRUPO 2 — FILTROS DE COMPRA ════════════════ */}
      <div className="pt-2 pb-1 border-b" style={{ borderColor: `${FILTER_COLOR}55` }}>
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: FILTER_COLOR }}>
          🔎 Filtros de compra — não compram sozinhos
        </span>
        <p className="text-[10px] text-p5/60 leading-relaxed mt-1">
          Estes blocos <strong>não disparam compra por conta própria</strong> — só bloqueiam/liberam os
          gatilhos do grupo acima. Desligue os que não quiser exigir; se todos estiverem desligados,
          qualquer gatilho ativo compra sem restrição extra.
        </p>
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${FILTER_COLOR}33` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: FILTER_COLOR }}>
            Tendência 4h — EMA9 / EMA21
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={entryTrendOn}
              onChange={e => patch('entryTrendMa.enabled', e.target.checked)} className="accent-violet-500" />
            Ativo
          </label>
        </div>
        {entryTrendOn && (
          <>
            <p className="text-[10px] text-p5/60">
              Exigir EMA9(4h) acima de EMA21(4h) antes de entrar (imediata ou pullback).
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-p5/50">Tolerância</span>
              <NumInput
                value={entryTrend.tolerancePct ?? 1}
                onChange={v => patch('entryTrendMa.tolerancePct', v)}
                min={0} max={5} step={0.1} className="w-14"
              />
              <span className="text-p5/40 text-[10px]">% abaixo — EMA9 até essa distância da EMA21 ainda autoriza</span>
            </div>
          </>
        )}
      </div>

      {/* Aproximação 4h (entryEmaApproach) e Filtro BB %B (entryBbFilter) removidos do
          formulário a pedido do usuário — não usados. entryEmaApproach é forçado a
          enabled:false via useEffect abaixo (ver nota no componente) porque o normalize
          do backend trata "enabled" ausente como true por padrão. entryBbFilter já
          tem default enabled:false no schema, então ficar oculto é seguro. */}

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${FILTER_COLOR}33` }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: FILTER_COLOR }}>
            Tendência MA50 1H — todos devem passar
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={form.maFiltersEnabled !== false}
              onChange={e => patch('maFiltersEnabled', e.target.checked)} className="accent-violet-500" />
            Ativos
          </label>
        </div>
        {form.maFiltersEnabled !== false && (
          <>
            {(form.maFilters ?? []).map((f, idx) => (
              <div key={f.id} className="rounded p-2 space-y-2" style={{ border: '1px solid #2a2d3a', background: '#141720' }}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[10px] text-p5/60 cursor-pointer">
                    <input type="checkbox" checked={f.enabled !== false}
                      onChange={e => updateFilter(f.id, 'enabled', e.target.checked)} className="accent-violet-500" />
                    Filtro {idx + 1}
                  </label>
                  {(form.maFilters?.length ?? 0) > 1 && (
                    <button type="button" onClick={() => removeFilter(f.id)}
                      className="text-[9px] text-red-400/70 hover:text-red-400">remover</button>
                  )}
                </div>
                {f.enabled !== false && (
                  <div className="space-y-2 text-xs">
                    <select value={f.mode} onChange={e => updateFilter(f.id, 'mode', e.target.value)}
                      className="w-full rounded px-1.5 py-1" style={sel}>
                      {PRICE_FILTER_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-p5/50">EMA</span>
                      <NumInput value={f.period} onChange={v => updateFilter(f.id, 'period', v)}
                        min={MA_CROSS_PERIOD_MIN} max={MA_CROSS_PERIOD_MAX} step={1} className="w-14" />
                      <select value={f.interval} onChange={e => updateFilter(f.id, 'interval', e.target.value)}
                        className="rounded px-1 py-1" style={sel}>
                        {MA_CROSS_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                      </select>
                    </div>
                    {f.mode === 'adaptive' && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-p5/50">Piso % abaixo</span>
                          <NumInput value={f.maxDipPct} onChange={v => updateFilter(f.id, 'maxDipPct', v)}
                            min={0.5} max={20} step={0.5} className="w-14" />
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-p5/50">Teto % acima</span>
                          <NumInput value={f.maxAbovePct ?? 4} onChange={v => updateFilter(f.id, 'maxAbovePct', v)}
                            min={0} max={20} step={0.5} className="w-14" />
                          <span className="text-p5/40 text-[10px]">0 = desligado</span>
                        </div>
                        <p className="text-[9px] text-p5/40 leading-relaxed">
                          Valores fixos iguais em todas as moedas (não recalcula por histórico).
                        </p>
                        {symbol?.trim() && (
                          <button type="button" onClick={() => handleSuggestBounds(f.id)}
                            className="text-[9px] px-2 py-0.5 rounded font-semibold"
                            style={{ background: `${FILTER_COLOR}18`, color: FILTER_COLOR, border: `1px solid ${FILTER_COLOR}44` }}>
                            Sugerir do histórico (opcional)
                          </button>
                        )}
                        {renderBoundsSuggest(f.id)}
                      </div>
                    )}
                    {(f.mode === 'strict_above' || f.mode === 'below') && (
                      <div className="flex items-center gap-2">
                        <span className="text-p5/50">Tolerância %</span>
                        <NumInput value={f.tolerancePct} onChange={v => updateFilter(f.id, 'tolerancePct', v)}
                          min={0} max={10} step={0.1} className="w-14" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={addFilter}
              className="text-[10px] px-2 py-1 rounded font-semibold w-full"
              style={{ background: `${FILTER_COLOR}18`, color: FILTER_COLOR, border: `1px solid ${FILTER_COLOR}44` }}>
              + Adicionar filtro EMA
            </button>
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EXIT_COLOR }}>Saída</span>
          <select value={form.exit.logic} onChange={e => patch('exit.logic', e.target.value)}
            className="rounded px-1.5 py-1 text-[10px] flex-1" style={sel}>
            {EXIT_LOGIC_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <p className="text-[9px] text-p5/50 leading-relaxed px-1">
          Cada sinal abaixo (Cruzamento EMA, RSI, Banda superior BB, Alvo % histórico) liga/desliga
          independente dos outros. "Qualquer sinal" vende no primeiro que disparar; "Todos os sinais"
          exige que todos os ativos disparem juntos no mesmo candle. Ex.: pra vender <strong>só</strong> na
          banda superior BB, desligue Cruzamento EMA e RSI e deixe apenas Banda superior (e/ou Alvo %) ativos.
        </p>

        <CrossBlock
          title="Venda — cruzamento EMA"
          block={form.exit.maCross}
          prefix="exit.maCross"
          patch={patch}
          color={EXIT_COLOR}
          showEnable
        />

        {/* Venda — RSI (exit.rsi) removida do formulário a pedido do usuário — não usada.
            Default já é enabled:false no schema, então ficar oculta é seguro. */}

        <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${EXIT_COLOR}33` }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EXIT_COLOR }}>
              Venda — Banda superior BB
            </span>
            <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
              <input type="checkbox" checked={exitBbUpper.enabled === true}
                onChange={e => patch('exit.bbUpper.enabled', e.target.checked)} style={{ accentColor: EXIT_COLOR }} />
              Ativo
            </label>
          </div>
          {exitBbUpper.enabled === true && (
            <>
              <p className="text-[10px] text-p5/60 leading-relaxed">
                Vende quando o close fecha na/acima da banda superior da BB({exitBbUpper.period},{exitBbUpper.stdDev}) {exitBbUpper.interval} — preço no topo.
              </p>
              <div className="flex flex-wrap gap-3 items-center text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-p5/50">Intervalo</span>
                  <select value={exitBbUpper.interval}
                    onChange={e => patch('exit.bbUpper.interval', e.target.value)}
                    className="rounded px-1 py-1 text-xs" style={sel}>
                    {MA_CROSS_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-p5/50">Período</span>
                  <NumInput value={exitBbUpper.period}
                    onChange={v => patch('exit.bbUpper.period', Math.max(5, Math.round(v)))}
                    min={5} max={200} step={1} className="w-14" />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-p5/50">StdDev</span>
                  <NumInput value={exitBbUpper.stdDev}
                    onChange={v => patch('exit.bbUpper.stdDev', v)}
                    min={0.5} max={4} step={0.5} className="w-14" />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${EXIT_COLOR}33` }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EXIT_COLOR }}>
              Venda — Alvo % histórico BB
            </span>
            <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
              <input type="checkbox" checked={exitBbTakeProfit.enabled === true}
                onChange={e => patch('exit.bbTakeProfit.enabled', e.target.checked)} style={{ accentColor: EXIT_COLOR }} />
              Ativo
            </label>
          </div>
          {exitBbTakeProfit.enabled === true && (
            <>
              <p className="text-[10px] text-p5/60 leading-relaxed">
                Vende quando o ganho desde a compra atinge o alvo — sugerido a partir da valorização média
                histórica fundo→topo da BB({exitBbUpper.period},{exitBbUpper.stdDev}) {exitBbUpper.interval} desta moeda.
              </p>
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <span className="text-p5/50">Alvo</span>
                <NumInput value={exitBbTakeProfit.targetPct}
                  onChange={v => patch('exit.bbTakeProfit.targetPct', Math.max(0.5, v))}
                  min={0.5} max={100} step={0.5} className="w-16" />
                <span className="text-p5/40 text-[10px]">%</span>
                <button type="button" onClick={() => patch('exit.bbTakeProfit.targetPct', 2)}
                  title="Aplica um alvo padrão de 2%, independente do histórico da moeda"
                  className="text-[9px] px-2 py-0.5 rounded font-semibold text-p5/60 border border-p3/40 hover:text-p5 hover:border-p4 transition-colors">
                  2%
                </button>
                <button type="button" onClick={() => patch('exit.bbTakeProfit.targetPct', 9)}
                  title="Aplica um alvo padrão de 9%, independente do histórico da moeda"
                  className="text-[9px] px-2 py-0.5 rounded font-semibold text-p5/60 border border-p3/40 hover:text-p5 hover:border-p4 transition-colors">
                  9%
                </button>
                {symbol?.trim() && (
                  <button type="button" onClick={handleSuggestBbTarget}
                    className="text-[9px] px-2 py-0.5 rounded font-semibold"
                    style={{ background: `${EXIT_COLOR}18`, color: EXIT_COLOR, border: `1px solid ${EXIT_COLOR}44` }}>
                    Sugerir do histórico
                  </button>
                )}
              </div>
              {bbTargetSuggest?.loading ? (
                <p className="text-[9px] text-p5/40 font-mono">Calculando…</p>
              ) : bbTargetSuggest?.error ? (
                <p className="text-[9px] text-amber-400/90 font-mono">{bbTargetSuggest.error}</p>
              ) : bbTargetSuggest ? (
                <p className="text-[9px] text-p5/50 font-mono leading-relaxed">
                  Média histórica: +{bbTargetSuggest.avg}% ({bbTargetSuggest.count} ciclos fundo→topo)
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="rounded-md p-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <label className="flex items-center gap-2 text-xs text-p5">
          <input type="checkbox" checked={form.stopLoss.enabled}
            onChange={e => patch('stopLoss.enabled', e.target.checked)} />
          Stop-loss — máx perda %
          <NumInput value={form.stopLoss.maxLossPct} onChange={v => patch('stopLoss.maxLossPct', v)}
            min={0.5} max={20} step={0.5} className="w-14" />
        </label>
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-p5/50">Volume mín. 24h</span>
          <select value={form.volume.minVolumeUsdt}
            onChange={e => patch('volume.minVolumeUsdt', Number(e.target.value))}
            className="rounded px-1 py-1 flex-1" style={sel}>
            {VOLUME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} USDT</option>)}
          </select>
        </div>
        {symbol?.trim() && (
          <p className="text-[10px] font-mono" style={{
            color: volCheck?.loading ? '#94a3b8' : volCheck?.meetsMin === false ? '#f59e0b' : volCheck?.meetsMin ? '#26a69a' : '#94a3b8',
          }}>
            {volCheck?.loading ? 'Verificando…' : volCheck?.meetsMin === false
              ? `Atual: ${volCheck.volumeFmt} — abaixo do mínimo`
              : volCheck?.volumeFmt ? `Atual: ${volCheck.volumeFmt}` : ''}
          </p>
        )}
        {symbol?.trim() && volCheck?.meetsMin === false && (
          <p className="text-[10px] text-amber-400/90 font-mono leading-relaxed">
            ⚠️ Aviso apenas — não impede compra nem venda. Liquidez baixa pode dificultar sair da posição a um preço justo.
          </p>
        )}
      </div>

      <button type="button" onClick={() => setAdvancedOpen(v => !v)}
        className="text-[10px] text-p5/50 w-full text-left hover:text-p5/70">
        {advancedOpen ? '▼' : '▶'} Execução, polling, adaptativo
      </button>

      {advancedOpen && (
        <div className="space-y-3 rounded-md p-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
          <div className="text-xs space-y-2">
            <p className="text-p5/40 text-[10px] pl-1">
              Padrão: compra imediata se close ≤ teto MA21; se esticado, pending + pullback MA21.
            </p>
            <label className="flex items-center gap-2 text-p5">
              <input type="checkbox" checked={form.execution.immediateEntry === true}
                onChange={e => patch('execution.immediateEntry', e.target.checked)} />
              Só imediata (sem pending se esticado)
            </label>
            <label className="flex items-center gap-2 text-p5">
              <input type="checkbox" checked={form.execution.pullbackEntry?.enabled === true}
                onChange={e => patch('execution.pullbackEntry.enabled', e.target.checked)} />
              Pending se não passar no teto MA21
            </label>
            {form.execution.pullbackEntry?.enabled === true && (
              <div className="flex flex-wrap items-center gap-2 pl-4">
                <span className="text-p5/50">Máx. candles após sinal</span>
                <NumInput value={form.execution.pullbackEntry?.waitCandles ?? 2}
                  onChange={v => patch('execution.pullbackEntry.waitCandles', Math.max(1, Math.round(v)))}
                  min={1} max={6} step={1} className="w-12" />
                <span className="text-p5/40 text-[10px]">entra no 1º que passar</span>
                <label className="flex items-center gap-2 text-p5">
                  <input type="checkbox" checked={form.execution.pullbackEntry?.requirePullback !== false}
                    onChange={e => patch('execution.pullbackEntry.requirePullback', e.target.checked)} />
                  Exigir aproximação da MA21 (vs sinal)
                </label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-p5/50">Desconto entrada %</span>
              <NumInput value={+(form.execution.entryDiscount * 100).toFixed(2)}
                onChange={v => patch('execution.entryDiscount', v / 100)}
                min={0} max={10} step={0.1} className="w-16" />
            </div>
            <select value={form.execution.pendingTimeoutMs}
              onChange={e => patch('execution.pendingTimeoutMs', Number(e.target.value))}
              className="w-full rounded px-2 py-1 text-xs" style={sel}>
              {PENDING_TIMEOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} timeout</option>)}
            </select>
          </div>
          <div className="text-xs space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-p5/50">Poll</span>
              <select value={form.polling.pollMs} onChange={e => patch('polling.pollMs', Number(e.target.value))}
                className="rounded px-1 py-1" style={sel}>
                {POLL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="text-p5/50">Rápido (posição)</span>
              <select value={form.polling.fastPollMs} onChange={e => patch('polling.fastPollMs', Number(e.target.value))}
                className="rounded px-1 py-1" style={sel}>
                {POLL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="text-xs grid grid-cols-2 gap-2">
            <div>
              <span className="text-p5/50 text-[10px] block">Adaptativo default %</span>
              <NumInput value={form.adaptiveOpts.defaultPct}
                onChange={v => patch('adaptiveOpts.defaultPct', v)} min={0.5} max={20} className="w-full" />
            </div>
            <div>
              <span className="text-p5/50 text-[10px] block">Adaptativo máx %</span>
              <NumInput value={form.adaptiveOpts.maxPct}
                onChange={v => patch('adaptiveOpts.maxPct', v)} min={0.5} max={20} className="w-full" />
            </div>
          </div>
        </div>
      )}

      {symbol?.trim() && (
        <div className="rounded-md p-2 space-y-1.5" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-p5/50">Histórico</span>

          {histStats?.loading ? (
            <p className="text-[9px] text-p5/40 font-mono">Carregando…</p>
          ) : histStats ? (
            <div className="space-y-1">
              {/* RSI */}
              {histStats.rsi ? (
                <p className="text-[9px] font-mono leading-relaxed">
                  <span className="text-p5/50">RSI {entryIv} </span>
                  <span className={histStats.rsi.avg >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
                    {histStats.rsi.avg > 0 ? '+' : ''}{histStats.rsi.avg}%
                  </span>
                  <span className="text-p5/40"> média ({histStats.rsi.count} ciclos, RSI &lt;30 → &gt;70)</span>
                </p>
              ) : histStats.rsiErr ? (
                <p className="text-[9px] text-amber-400/70 font-mono">RSI: {histStats.rsiErr}</p>
              ) : null}

              {/* MA-Cross */}
              {histStats.macross ? (
                <p className="text-[9px] font-mono leading-relaxed">
                  <span className="text-p5/50">MA-Cross </span>
                  <span className={histStats.macross.avg >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
                    {histStats.macross.avg > 0 ? '+' : ''}{histStats.macross.avg}%
                  </span>
                  <span className="text-p5/40"> média ({histStats.macross.count} ciclos, EMA9/21 {entryIv}↑ → {exitIv}↓)</span>
                </p>
              ) : histStats.macrossErr ? (
                <p className="text-[9px] text-amber-400/70 font-mono">MA-Cross: {histStats.macrossErr}</p>
              ) : null}

              {/* Bollinger Bands — fundo→topo */}
              {histStats.bb ? (
                <p className="text-[9px] font-mono leading-relaxed">
                  <span className="text-p5/50">BB 4h </span>
                  <span className={histStats.bb.avg >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
                    {histStats.bb.avg > 0 ? '+' : ''}{histStats.bb.avg}%
                  </span>
                  <span className="text-p5/40"> média ({histStats.bb.count} ciclos, banda inferior → superior BB(20,2))</span>
                </p>
              ) : histStats.bbErr ? (
                <p className="text-[9px] text-amber-400/70 font-mono">BB: {histStats.bbErr}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <p className="text-[9px] text-p5/40">
        Períodos livres (2–500). Bot: <code>node backend/bot/ma-cross/ma-cross-bot.js</code>
      </p>
    </div>
  );
}
