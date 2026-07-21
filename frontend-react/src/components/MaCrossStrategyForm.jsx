import { useState, useEffect } from 'react';
import { suggestMaCrossFilterBounds, checkMultitradeVolume, fetchRsiOversoldRecovery, fetchSimpleMaCross, fetchBollingerBandRecovery } from '../services/api';
import {
  MA_CROSS_INTERVALS, MA_PERIOD_PRESETS, MA_CROSS_PERIOD_MIN, MA_CROSS_PERIOD_MAX,
  CROSS_DIRECTIONS, PRICE_FILTER_MODES,
  EXIT_LOGIC_OPTIONS, RSI_INTERVALS, RSI_PERIODS, RSI_OPERATORS,
  VOLUME_OPTIONS, PENDING_TIMEOUT_OPTIONS, POLL_OPTIONS,
  MA_CROSS_DEFAULTS,
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

export default function MaCrossStrategyForm({ form, patch, symbol, exchange, hasSavedConfig = false }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [boundsSuggest, setBoundsSuggest] = useState({});
  const [volCheck, setVolCheck] = useState(null);
  const [histStats, setHistStats] = useState(null);
  const [bbTargetSuggest, setBbTargetSuggest] = useState(null);
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' };
  const entryTrend = { ...MA_CROSS_DEFAULTS.entryTrendMa, ...form.entryTrendMa };
  const entryTrendOn = entryTrend.enabled !== false;

  const entryApproach = { ...MA_CROSS_DEFAULTS.entryEmaApproach, ...form.entryEmaApproach };
  const entryApproachOn = entryApproach.enabled !== false;

  const bbFilter = { ...MA_CROSS_DEFAULTS.entryBbFilter, ...form.entryBbFilter };
  const bbOn = bbFilter.enabled !== false;

  const entryBbLower = { ...MA_CROSS_DEFAULTS.entryBbLower, ...form.entryBbLower };
  const entryBbLowerOn = entryBbLower.enabled === true;

  const exitBbUpper = { ...MA_CROSS_DEFAULTS.exit.bbUpper, ...form.exit?.bbUpper };
  const exitBbTakeProfit = { ...MA_CROSS_DEFAULTS.exit.bbTakeProfit, ...form.exit?.bbTakeProfit };

  const entryIv = form.entry?.ma1?.interval ?? '15m';
  const exitIv  = form.exit?.maCross?.ma1?.interval ?? '30m';
  const src     = exchange === 'gate' ? 'gate' : null;

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

  const addRsiCond = () => {
    const nextId = Math.max(0, ...(form.exit.rsi.conditions ?? []).map(c => c.id)) + 1;
    patch('exit.rsi.conditions', [...form.exit.rsi.conditions, {
      id: nextId, enabled: true, interval: '15m', period: 14, operator: '>', value: 70,
    }]);
  };

  const updateRsiCond = (id, field, val) => {
    patch('exit.rsi.conditions', form.exit.rsi.conditions.map(c =>
      c.id === id ? { ...c, [field]: val } : c));
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
                value={entryTrend.tolerancePct ?? 2}
                onChange={v => patch('entryTrendMa.tolerancePct', v)}
                min={0} max={5} step={0.1} className="w-14"
              />
              <span className="text-p5/40 text-[10px]">% abaixo — EMA9 até essa distância da EMA21 ainda autoriza</span>
            </div>
          </>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${FILTER_COLOR}33` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: FILTER_COLOR }}>
            Aproximação 4h — EMA9 encosta na EMA21 e sobe
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={entryApproachOn}
              onChange={e => patch('entryEmaApproach.enabled', e.target.checked)} className="accent-violet-500" />
            Ativo
          </label>
        </div>
        {entryApproachOn && (
          <>
            <p className="text-[10px] text-p5/60">
              Exige que a EMA9(4h) tenha formado um fundo perto da EMA21(4h) nos últimos candles
              e já esteja subindo de volta — não basta estar acima há muito tempo.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-p5/50">Aproximação máx.</span>
              <NumInput
                value={entryApproach.approachPct ?? 1.5}
                onChange={v => patch('entryEmaApproach.approachPct', v)}
                min={0} max={5} step={0.1} className="w-14"
              />
              <span className="text-p5/40 text-[10px]">% — quão perto o fundo da EMA9 precisa chegar da EMA21</span>
            </div>
            <p className="text-[9px] text-p5/40 font-mono">
              Sugestão com base em dados reais (120 dias, 45 moedas ma-cross): o fundo histórico da
              EMA9 antes de subir ficou em -0.85% (mediana) — 1.5% dá margem sobre esse valor.
            </p>
          </>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${FILTER_COLOR}33` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: FILTER_COLOR }}>
            Filtro BB — %B ({bbFilter.interval})
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={bbOn}
              onChange={e => patch('entryBbFilter.enabled', e.target.checked)} className="accent-violet-500" />
            Ativo
          </label>
        </div>
        {bbOn && (
          <>
            <p className="text-[10px] text-p5/60 leading-relaxed">
              Exige que o preço esteja nos <strong>%B&nbsp;&lt;&nbsp;{(bbFilter.maxPctB * 100).toFixed(0)}%</strong> inferiores
              do range BB({bbFilter.period},{bbFilter.stdDev}) {bbFilter.interval} — filtra entradas com preço esticado no HTF.
              Só se aplica ao gatilho de <em>cruzamento EMA</em> (o gatilho de Banda inferior já exige %B baixo por definição).
            </p>
            <div className="flex flex-wrap gap-3 items-center text-xs">
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Intervalo</span>
                <select value={bbFilter.interval}
                  onChange={e => patch('entryBbFilter.interval', e.target.value)}
                  className="rounded px-1 py-1 text-xs" style={sel}>
                  {MA_CROSS_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">%B máx</span>
                <NumInput value={+(bbFilter.maxPctB * 100).toFixed(0)}
                  onChange={v => patch('entryBbFilter.maxPctB', Math.max(1, Math.min(100, v)) / 100)}
                  min={5} max={95} step={5} className="w-14" placeholder="40" />
                <span className="text-p5/40 text-[10px]">%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Período</span>
                <NumInput value={bbFilter.period}
                  onChange={v => patch('entryBbFilter.period', Math.max(5, Math.round(v)))}
                  min={5} max={200} step={1} className="w-14" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">StdDev</span>
                <NumInput value={bbFilter.stdDev}
                  onChange={v => patch('entryBbFilter.stdDev', v)}
                  min={0.5} max={4} step={0.5} className="w-14" />
              </div>
            </div>
            <p className="text-[9px] text-p5/40 leading-relaxed">
              %B = (close − banda inf) / (banda sup − banda inf). 0% = toca a banda inferior · 100% = toca a superior.
            </p>
          </>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${FILTER_COLOR}33` }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: FILTER_COLOR }}>
            Filtros de preço (param3) — todos devem passar
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

        <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${EXIT_COLOR}33` }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EXIT_COLOR }}>
              Venda — RSI
            </span>
            <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
              <input type="checkbox" checked={form.exit.rsi.enabled}
                onChange={e => patch('exit.rsi.enabled', e.target.checked)} style={{ accentColor: EXIT_COLOR }} />
              Ativo
            </label>
          </div>
          {form.exit.rsi.enabled && (
            <>
              <select value={form.exit.rsi.logic} onChange={e => patch('exit.rsi.logic', e.target.value)}
                className="w-full rounded px-1.5 py-1 text-[10px] mb-2" style={sel}>
                <option value="any">Qualquer condição RSI (OU)</option>
                <option value="all">Todas as condições RSI (E)</option>
              </select>
              {(form.exit.rsi.conditions ?? []).map((cond, idx) => (
                <div key={cond.id} className="rounded p-2 mb-2" style={{ border: '1px solid #2a2d3a', background: '#141720' }}>
                  <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
                    <input type="checkbox" checked={cond.enabled !== false}
                      onChange={e => updateRsiCond(cond.id, 'enabled', e.target.checked)} className="accent-red-500" />
                    <span className="text-[10px] text-p5/50">RSI condição {idx + 1}</span>
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    <select value={cond.interval} onChange={e => updateRsiCond(cond.id, 'interval', e.target.value)}
                      className="rounded px-1 py-1 text-xs" style={sel}>
                      {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                    <select value={cond.period} onChange={e => updateRsiCond(cond.id, 'period', Number(e.target.value))}
                      className="rounded px-1 py-1 text-xs font-mono" style={sel}>
                      {RSI_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select value={cond.operator} onChange={e => updateRsiCond(cond.id, 'operator', e.target.value)}
                      className="rounded px-1 py-1 text-xs text-center" style={sel}>
                      {RSI_OPERATORS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <NumInput value={cond.value} onChange={v => updateRsiCond(cond.id, 'value', v)} min={1} max={99} className="w-full" />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addRsiCond}
                className="text-[10px] px-2 py-1 rounded w-full"
                style={{ background: `${EXIT_COLOR}18`, color: EXIT_COLOR, border: `1px solid ${EXIT_COLOR}44` }}>
                + Condição RSI
              </button>
            </>
          )}
        </div>

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
        <label className="flex items-center gap-2 text-p5 text-xs">
          <input type="checkbox" checked={form.volume.allowLowVolume}
            onChange={e => patch('volume.allowLowVolume', e.target.checked)} />
          Permitir volume baixo
        </label>
        {symbol?.trim() && (
          <p className="text-[10px] font-mono" style={{
            color: volCheck?.loading ? '#94a3b8' : volCheck?.meetsMin === false ? '#f59e0b' : volCheck?.meetsMin ? '#26a69a' : '#94a3b8',
          }}>
            {volCheck?.loading ? 'Verificando…' : volCheck?.meetsMin === false
              ? `Atual: ${volCheck.volumeFmt} — abaixo do mínimo`
              : volCheck?.volumeFmt ? `Atual: ${volCheck.volumeFmt}` : ''}
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
              <input type="checkbox" checked={form.execution.pullbackEntry?.enabled !== false}
                onChange={e => patch('execution.pullbackEntry.enabled', e.target.checked)} />
              Pending se não passar no teto MA21
            </label>
            {form.execution.pullbackEntry?.enabled !== false && (
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
