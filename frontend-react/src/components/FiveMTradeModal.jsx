import { useState, useEffect, useCallback } from 'react';
import { fetchFiveMTradeSuggestRsi, evaluateFiveMTradeLive, fetchFiveMTradeSuggestMaAdaptation } from '../services/api';

const FIVE_M_COLOR  = '#06b6d4';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

const EXCHANGES = [
  { id: 'gate',    label: 'Gate.io', color: GATE_COLOR    },
  { id: 'binance', label: 'Binance', color: BINANCE_COLOR },
];

const MA_INTERVALS = ['1h', '2h', '4h', '8h', '1d'];
const MA_PERIODS   = [20, 50, 100, 200];

const DEFAULT_MA_FILTERS = {
  enabled: false,
  filters: [
    { id: 'ma50-1h', enabled: true, period: 50, interval: '1h', mode: 'above', tolerancePct: 0 },
  ],
};

function cloneMaFilters(src) {
  const base = src?.filters?.length ? src : DEFAULT_MA_FILTERS;
  return {
    enabled: base.enabled === true,
    filters: base.filters.map((f, i) => ({
      id:       f.id ?? `ma${f.period}-${f.interval}-${i}`,
      enabled:  f.enabled !== false,
      period:   Number(f.period ?? 50),
      interval: MA_INTERVALS.includes(f.interval) ? f.interval : '1h',
      mode:     f.mode === 'below' ? 'below' : 'above',
      tolerancePct: Math.max(0, Number(f.tolerancePct ?? 0)),
    })),
  };
}

function maFiltersKey(cfg) {
  return JSON.stringify(cfg);
}

function describeMaFiltersLocal(cfg) {
  if (!cfg?.enabled) return '';
  const active = cfg.filters?.filter(f => f.enabled) ?? [];
  if (!active.length) return 'MA ligado';
  return active.map(f => {
    const op = f.mode === 'below' ? '<' : '>';
    const tol = f.tolerancePct > 0 ? ` −${f.tolerancePct}%` : '';
    return `${op} MA${f.period} ${f.interval}${tol}`;
  }).join(' · ');
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v}%`;
}

function AnalysisAccordion({ id, openId, onToggle, title, subtitle, accent, children }) {
  const open = openId === id;
  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid #2a2d3a' }}>
      <button
        type="button"
        onClick={() => onToggle(open ? null : id)}
        className="w-full flex items-start justify-between gap-2 px-2.5 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold block" style={{ color: accent }}>{title}</span>
          {subtitle && (
            <span className="text-[9px] font-mono text-p5/50 block mt-0.5 truncate">{subtitle}</span>
          )}
        </div>
        <span className="text-p5/40 text-[10px] shrink-0 mt-0.5">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 border-t" style={{ borderColor: '#2a2d3a' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function RsiSuggestHint({ label, suggested, current, stats, onApply, loading, stale, accent }) {
  if (loading) {
    return <p className="mt-1 text-[9px] text-p5/40 font-mono">…</p>;
  }
  if (suggested == null) return null;

  const differs = suggested !== Number(current);
  if (stale) {
    return (
      <div className="mt-1.5 rounded px-2 py-1.5 opacity-80" style={{ background: '#1e2130', border: '1px solid #f59e0b44' }}>
        <p className="text-[9px] font-mono leading-relaxed text-amber-500/90">
          Última sugestão: {label} {suggested}
          {stats && <> · {stats}</>}
          {' · '}clique <strong>Calcular</strong> para atualizar
        </p>
      </div>
    );
  }

  return (
    <div className="mt-1.5 rounded px-2 py-1.5" style={{ background: '#1e2130', border: `1px solid ${accent}33` }}>
      <p className="text-[9px] font-mono leading-relaxed" style={{ color: '#94a3b8' }}>
        <span style={{ color: accent }}>{label} {suggested}</span>
        {stats && <> · {stats}</>}
        {!differs && <span className="text-p5/40"> · atual</span>}
      </p>
      {differs && (
        <button
          type="button"
          onClick={onApply}
          className="mt-1 text-[9px] px-1.5 py-0.5 rounded font-medium"
          style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}
        >
          Usar {label} {suggested}
        </button>
      )}
    </div>
  );
}

function RiseDistribution({ distribution }) {
  if (!distribution?.length) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      <p className="text-[9px] text-p5/40 uppercase tracking-wider">Distribuição de alta</p>
      {distribution.map(d => (
        <div key={d.label} className="flex items-center gap-2 text-[9px] font-mono">
          <span className="w-10 text-p5/50">{d.label}</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2d3a' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, d.sharePct)}%`, background: FIVE_M_COLOR }}
            />
          </div>
          <span className="w-14 text-right text-p5/60">{d.count}× ({d.sharePct}%)</span>
        </div>
      ))}
    </div>
  );
}

function PatternDetail({ data }) {
  if (!data) return null;
  if (data.count === 0) {
    return (
      <p className="text-[9px] font-mono text-p5/50">
        Nenhum ciclo completo RSI &lt;{data.entryRsi} → &gt;{data.exitRsi} no histórico.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-mono leading-relaxed text-p5/70">
        {data.count} ciclos · média {fmtPct(data.avgPct)} · mediana {fmtPct(data.medianPct)}
        {' · '}mín {fmtPct(data.minPct)} · máx {fmtPct(data.maxPct)}
        {' · '}win {data.winRate}%
        {data.medianHours != null && <> · ~{data.medianHours}h mediano</>}
        {data.dcaAvgBuys != null && <> · {data.dcaAvgBuys} compras/trade</>}
        {data.medianPeakRsi != null && <> · pico RSI med. {data.medianPeakRsi}</>}
      </p>
      <RiseDistribution distribution={data.distribution} />
      {data.recentMoves?.length > 0 && (
        <p className="text-[9px] font-mono text-p5/40">
          Últimos: {data.recentMoves.map(m => fmtPct(m.risePct)).join(', ')}
        </p>
      )}
      {data.recentTrades?.length > 0 && (
        <p className="text-[9px] font-mono text-p5/40">
          Últimos: {data.recentTrades.map(t => fmtPct(t.pnlPct)).join(', ')}
        </p>
      )}
      {data.incompleteOpen && (
        <p className="text-[9px] text-amber-500/80">1 movimento em aberto (RSI ainda não passou de {data.exitRsi})</p>
      )}
      {data.blockedByMa > 0 && (
        <p className="text-[9px] text-p5/50">
          {data.blockedByMa} sinais RSI bloqueados por MA
          {data.maPassRate != null && ` · ${data.maPassRate}% passaram`}
        </p>
      )}
    </div>
  );
}

function MaToleranceHint({ suggestion, onApply, loading }) {
  if (loading) return <p className="text-[9px] text-p5/40 font-mono mt-1">…</p>;
  if (!suggestion) return null;
  const suggested = suggestion.recommendedTolerancePct ?? suggestion.suggestedTolerancePct;
  const differs = suggested != null && suggested !== Number(suggestion.currentTolerancePct ?? 0);
  return (
    <div className="mt-1 rounded px-2 py-1" style={{ background: '#161a28', border: '1px solid #2a2d3a' }}>
      <p className="text-[9px] font-mono leading-relaxed text-p5/60">
        {suggestion.reason ?? (
          suggestion.usedDefault
            ? `Poucos episódios (${suggestion.episodeCount ?? 0}) — padrão ${suggested}%`
            : `${suggestion.episodeCount} dips: média ${suggestion.avgRaw}% → sugerido −${suggested}%`
        )}
        {suggestion.recommendationLabel && (
          <span className="text-p5/40"> · {suggestion.recommendationLabel}</span>
        )}
        {suggestion.entryOk != null && (
          <> · agora {suggestion.entryOk ? 'OK' : 'bloqueado'} (dip {suggestion.dipNowPct ?? '—'}%)</>
        )}
        {suggestion.vsCurrent?.tradeDelta != null && suggestion.vsCurrent.tradeDelta !== 0 && (
          <> · +{suggestion.vsCurrent.tradeDelta} trades vs atual</>
        )}
      </p>
      {differs && onApply && (
        <button
          type="button"
          onClick={() => onApply(suggested)}
          className="mt-1 text-[9px] px-1.5 py-0.5 rounded font-medium"
          style={{ background: `${FIVE_M_COLOR}22`, color: FIVE_M_COLOR, border: `1px solid ${FIVE_M_COLOR}55` }}
        >
          Usar −{suggested}%
        </button>
      )}
    </div>
  );
}

function MaFilterRow({ filter, onChange, onRemove, canRemove, toleranceSuggest }) {
  const modeLabel = filter.mode === 'below' ? '<' : '>';
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
        <label className="flex items-center gap-1 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={filter.enabled}
            onChange={e => onChange({ ...filter, enabled: e.target.checked })}
            className="accent-cyan-500"
          />
        </label>
        <span className="text-p5/40 font-mono">{modeLabel}</span>
        <select
          value={filter.period}
          onChange={e => onChange({ ...filter, period: Number(e.target.value) })}
          className="rounded px-1 py-0.5 font-mono text-p5 outline-none"
          style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
        >
          {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
        </select>
        <select
          value={filter.interval}
          onChange={e => onChange({ ...filter, interval: e.target.value })}
          className="rounded px-1 py-0.5 font-mono text-p5 outline-none"
          style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
        >
          {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
        </select>
        <select
          value={filter.mode}
          onChange={e => onChange({ ...filter, mode: e.target.value })}
          className="rounded px-1 py-0.5 font-mono text-p5 outline-none"
          style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
          title="above = comprar só acima da MA · below = só abaixo"
        >
          <option value="above">acima</option>
          <option value="below">abaixo</option>
        </select>
        {filter.mode === 'above' && (
          <>
            <span className="text-p5/40 font-mono">−</span>
            <input
              type="number"
              value={filter.tolerancePct ?? 0}
              onChange={e => onChange({ ...filter, tolerancePct: Math.max(0, Number(e.target.value) || 0) })}
              min={0}
              max={20}
              step={0.1}
              className="w-12 rounded px-1 py-0.5 font-mono text-p5 outline-none"
              style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
              title="Calibragem: admite até X% abaixo da MA (ex.: 5 = piso em MA×0,95)"
            />
            <span className="text-p5/40">%</span>
          </>
        )}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-p5/30 hover:text-red-400 px-1"
            title="Remover filtro"
          >
            ×
          </button>
        )}
      </div>
      {filter.mode === 'above' && filter.enabled && (
        <MaToleranceHint
          suggestion={toleranceSuggest}
          onApply={pct => onChange({ ...filter, tolerancePct: pct })}
        />
      )}
    </div>
  );
}

function LiveTestPanel({ data }) {
  if (!data) return null;
  if (data.loading) {
    return <p className="text-[10px] text-center text-p5/40 py-2">Consultando candles ao vivo…</p>;
  }
  if (data.error) {
    return (
      <p className="text-[10px] text-center py-2" style={{ color: '#f59e0b' }}>{data.error}</p>
    );
  }

  const actionColor = data.allowed ? '#26a69a' : (
    data.action?.includes('bloqueada') ? '#ef5350' : '#94a3b8'
  );

  return (
    <div
      className="rounded px-2.5 py-2 space-y-1.5"
      style={{ background: '#1e2130', border: `1px solid ${actionColor}44` }}
    >
      <p className="text-[10px] font-semibold" style={{ color: actionColor }}>
        {data.actionLabel}
      </p>
      <p className="text-[9px] font-mono text-p5/70 leading-relaxed">{data.reason}</p>
      {data.detail && (
        <p className="text-[9px] font-mono text-p5/50">{data.detail}</p>
      )}
      <p className="text-[9px] font-mono text-p5/50">
        RSI(5m) {data.rsiNow} · preço {data.price}
        {' · '}fase {data.phase}
        {data.fastPoll && ' · poll rápido 30s'}
      </p>
      {data.maChecks?.length > 0 && (
        <div className="space-y-0.5 pt-1 border-t" style={{ borderColor: '#2a2d3a' }}>
          <p className="text-[9px] text-p5/40 uppercase tracking-wider">Filtros MA</p>
          {data.maChecks.map(m => (
            <p
              key={m.id}
              className="text-[9px] font-mono"
              style={{ color: m.ok ? '#26a69a' : '#ef5350' }}
            >
              {m.ok ? '✓' : '✗'} {m.label}
              {m.distPct != null && ` · ${m.distPct}% vs MA`}
              {m.threshold != null && !m.ok && ` · piso ${m.threshold}`}
            </p>
          ))}
        </div>
      )}
      <p className="text-[8px] text-p5/30 font-mono">
        {new Date(data.evaluatedAt).toLocaleTimeString()} · candles recentes da {data.exchange}
      </p>
    </div>
  );
}

export default function FiveMTradeModal({
  symbol, isActive, currentEntry, defaultExchange, onConfirm, onRemove, onCancel,
}) {
  const [exchange, setExchange]   = useState(currentEntry?.exchange ?? defaultExchange ?? 'binance');
  const [capital, setCapital]     = useState(currentEntry?.capital ?? 40);
  const [rsiBuy, setRsiBuy]       = useState(currentEntry?.rsiBuy ?? 30);
  const [rsiSell, setRsiSell]     = useState(currentEntry?.rsiSell ?? 70);
  const [maFilters, setMaFilters] = useState(() => cloneMaFilters(currentEntry?.maFilters));
  const [suggest, setSuggest]     = useState(null);
  const [liveTest, setLiveTest]     = useState(null);
  const [maAdapt, setMaAdapt]       = useState(null);
  const [suggestCtx, setSuggestCtx] = useState(null);
  const [openSection, setOpenSection] = useState(null);
  const entryKey = currentEntry?.id != null ? String(currentEntry.id) : `new:${symbol}`;

  const inPosition = currentEntry?.phase === 'BOUGHT';
  const rsiInvalid = Number(rsiBuy) >= Number(rsiSell);
  const ready      = suggest && !suggest.loading && !suggest.error;

  const maKeyNow = maFiltersKey(maFilters);
  const ctxStale = suggestCtx != null && (
    suggestCtx.exchange !== exchange || suggestCtx.maKey !== maKeyNow
  );
  const entryHintStale = ctxStale || (
    suggestCtx != null && !ctxStale && (
      Number(rsiBuy) !== suggestCtx.rsiBuy &&
      Number(rsiBuy) !== Number(suggest?.entryRsiValue)
    )
  );
  const exitHintStale = ctxStale || (
    suggestCtx != null && !ctxStale && (
      Number(rsiSell) !== suggestCtx.rsiSell &&
      Number(rsiSell) !== Number(suggest?.exitRsiValue)
    )
  );
  const needsRecalc = suggestCtx != null && !suggest?.loading && (
    ctxStale ||
    Number(rsiBuy) !== suggestCtx.rsiBuy ||
    Number(rsiSell) !== suggestCtx.rsiSell
  );

  const loadSuggest = useCallback(async () => {
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell) return;

    setSuggest({ loading: true });
    try {
      const r = await fetchFiveMTradeSuggestRsi({
        symbol, exchange, entryValue: buy, exitValue: sell, maFilters,
      });
      setSuggestCtx({ exchange, rsiBuy: buy, rsiSell: sell, maKey: maFiltersKey(maFilters) });
      setSuggest(r);
      if (maFilters.enabled) {
        setMaAdapt({ loading: true });
        try {
          const maR = await fetchFiveMTradeSuggestMaAdaptation({
            symbol, exchange, rsiBuy: buy, rsiSell: sell, maFilters,
          });
          setMaAdapt(maR);
        } catch (err) {
          setMaAdapt({ error: err.message });
        }
      } else {
        setMaAdapt(null);
      }
    } catch (err) {
      setSuggest({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, rsiSell, maFilters]);

  const runLiveTest = useCallback(async () => {
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell) return;

    setLiveTest({ loading: true });
    try {
      const r = await evaluateFiveMTradeLive({
        symbol,
        exchange,
        rsiBuy: buy,
        rsiSell: sell,
        maFilters,
        phase: currentEntry?.phase ?? 'WATCHING',
        lastBuyTime: currentEntry?.lastBuyTime ?? null,
        buyCount: currentEntry?.buyCount ?? 0,
      });
      setLiveTest(r);
    } catch (err) {
      setLiveTest({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, rsiSell, maFilters, currentEntry]);

  const loadMaAdaptation = useCallback(async () => {
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell || !maFilters.enabled) return;

    setMaAdapt({ loading: true });
    try {
      const r = await fetchFiveMTradeSuggestMaAdaptation({
        symbol, exchange, rsiBuy: buy, rsiSell: sell, maFilters,
      });
      setMaAdapt(r);
    } catch (err) {
      setMaAdapt({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, rsiSell, maFilters]);

  function applyAllMaAdaptation(filterSuggestions) {
    const list = filterSuggestions ?? maAdapt?.filters ?? suggest?.maToleranceSuggestions;
    if (!list?.length) return;
    setMaFilters(prev => ({
      ...prev,
      filters: prev.filters.map(f => {
        const s = list.find(x => x.filterId === f.id);
        if (!s || s.recommendedTolerancePct == null) return f;
        return { ...f, tolerancePct: s.recommendedTolerancePct };
      }),
    }));
  }

  useEffect(() => {
    const ex  = currentEntry?.exchange ?? defaultExchange ?? 'binance';
    const buy = currentEntry?.rsiBuy ?? 30;
    const sell = currentEntry?.rsiSell ?? 70;
    const ma  = cloneMaFilters(currentEntry?.maFilters);
    const cap = currentEntry?.capital ?? 40;

    setExchange(ex);
    setCapital(cap);
    setRsiBuy(buy);
    setRsiSell(sell);
    setMaFilters(ma);
    setSuggest(null);
    setSuggestCtx(null);
    setMaAdapt(null);
    setLiveTest(null);
    setOpenSection(null);

    let cancelled = false;
    (async () => {
      const b = Number(buy);
      const s = Number(sell);
      if (!Number.isFinite(b) || !Number.isFinite(s) || b >= s) return;

      setSuggest({ loading: true });
      try {
        const r = await fetchFiveMTradeSuggestRsi({
          symbol, exchange: ex, entryValue: b, exitValue: s, maFilters: ma,
        });
        if (cancelled) return;
        setSuggestCtx({ exchange: ex, rsiBuy: b, rsiSell: s, maKey: maFiltersKey(ma) });
        setSuggest(r);

        if (ma.enabled) {
          setMaAdapt({ loading: true });
          try {
            const maR = await fetchFiveMTradeSuggestMaAdaptation({
              symbol, exchange: ex, rsiBuy: b, rsiSell: s, maFilters: ma,
            });
            if (!cancelled) setMaAdapt(maR);
          } catch (err) {
            if (!cancelled) setMaAdapt({ error: err.message });
          }
        }
      } catch (err) {
        if (!cancelled) setSuggest({ error: err.message });
      }
    })();

    return () => { cancelled = true; };
  // entryKey muda ao abrir outra moeda ou quando favoritos carregam o id
  // eslint-disable-next-line react-hooks/exhaustive-deps -- currentEntry lido no corpo; entryKey evita loop
  }, [symbol, entryKey, defaultExchange]);

  function maStatsSuffix() {
    if (!maFilters.enabled || !suggest?.maDescription) return '';
    return ` · ${suggest.maDescription}`;
  }

  function entryStatsLine() {
    if (!ready) return null;
    const b = suggest.entry?.bestStats ?? suggest.entry?.anchorStats;
    if (!b?.tradeCount) {
      if (maFilters.enabled && suggest.botSimulation?.blockedByMa > 0) {
        return `${suggest.botSimulation.blockedByMa} sinais RSI bloqueados por MA${maStatsSuffix()}`;
      }
      return maFilters.enabled ? suggest.maDescription : null;
    }
    const sample = suggest.entry?.lowSample ? ' · amostra pequena' : '';
    return `${b.tradeCount} trades · PnL ${fmtPct(b.avgPnl)} · win ${b.winRate}%${maStatsSuffix()}${sample}`;
  }

  function exitStatsLine() {
    if (!ready) return null;
    const e = suggest.exit;
    if (!e) return null;
    const parts = [];
    if (e.tradeCount) parts.push(`${e.tradeCount} trades`);
    if (e.medianPeakRsi != null) parts.push(`pico med. ${e.medianPeakRsi}`);
    if (e.hitRate75 != null) parts.push(`atinge 75: ${e.hitRate75}%`);
    if (e.lowSample) parts.push('amostra pequena');
    const line = parts.join(' · ');
    if (!line) return maFilters.enabled ? suggest.maDescription : null;
    return `${line}${maStatsSuffix()}`;
  }

  function swingSubtitle() {
    const d = suggest?.swingPattern;
    if (!d || d.count === 0) return 'sem ciclos no histórico';
    return `${d.count} ciclos · média ${fmtPct(d.avgPct)} · win ${d.winRate}%`;
  }

  function botSubtitle() {
    const d = suggest?.botSimulation;
    if (!d || d.count === 0) {
      if (d?.blockedByMa > 0) return `${d.blockedByMa} sinais bloqueados por MA`;
      return 'sem trades simulados';
    }
    return `${d.count} trades · PnL ${fmtPct(d.avgPct)} · win ${d.winRate}%`;
  }

  function patchMaFilter(idx, next) {
    setMaFilters(prev => ({
      ...prev,
      filters: prev.filters.map((f, i) => (i === idx ? next : f)),
    }));
  }

  function addMaFilter() {
    setMaFilters(prev => ({
      ...prev,
      filters: [
        ...prev.filters,
        { id: `ma-${Date.now()}`, enabled: true, period: 50, interval: '1h', mode: 'above', tolerancePct: 0 },
      ],
    }));
  }

  function removeMaFilter(idx) {
    setMaFilters(prev => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== idx),
    }));
  }

  function maSuggestForFilter(filterId) {
    const fromAdapt = maAdapt?.filters?.find(s => s.filterId === filterId);
    const fromHist  = suggest?.maToleranceSuggestions?.find(s => s.filterId === filterId);
    const row = fromAdapt ?? fromHist;
    if (!row) return null;
    return {
      ...row,
      currentTolerancePct: maFilters.filters.find(f => f.id === filterId)?.tolerancePct ?? 0,
    };
  }

  function handleConfirm() {
    const cap  = Number(capital);
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(cap) || cap <= 0 || buy >= sell) return;
    onConfirm({ exchange, capital: cap, rsiBuy: buy, rsiSell: sell, maFilters });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onCancel}
    >
      <div
        className="w-80 max-h-[90vh] overflow-y-auto rounded-lg shadow-2xl border"
        style={{ background: '#131722', borderColor: '#2a2d3a' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10" style={{ borderColor: '#2a2d3a', background: '#131722' }}>
          <div>
            <span className="text-xs font-semibold text-p5">5m Trade</span>
            <span className="ml-2 text-xs font-mono font-bold" style={{ color: FIVE_M_COLOR }}>{symbol}</span>
          </div>
          <button onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none transition-colors">×</button>
        </div>

        <div className="px-4 py-4 space-y-3.5">
          <div
            className="rounded px-2.5 py-2 text-[10px] leading-relaxed"
            style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#94a3b8' }}
          >
            RSI(14, 5m) · DCA a cada 2h · venda total na saída
            {maFilters.enabled && (
              <span className="block mt-1 text-cyan-400/80">
                Entrada só com preço {maFilters.filters.filter(f => f.enabled).map(f =>
                  `${f.mode === 'below' ? '<' : '>'} MA${f.period} ${f.interval}${f.tolerancePct > 0 ? ` (−${f.tolerancePct}%)` : ''}`,
                ).join(' · ') || '(nenhum filtro ativo)'}
              </span>
            )}
          </div>

          {inPosition && (
            <p className="text-[10px]" style={{ color: '#f59e0b' }}>
              Em posição ({currentEntry.buyCount || 1} entrada{(currentEntry.buyCount || 1) > 1 ? 's' : ''}) — edite capital/RSI para próximos ciclos.
            </p>
          )}

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

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1">
              Capital por entrada (USDT)
            </label>
            <input
              type="number"
              value={capital}
              onChange={e => setCapital(e.target.value)}
              min={1}
              step={1}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono"
              style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
            />
          </div>

          {/* RSI compra + sugestão colada */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: '#26a69a' }}>
              RSI Compra (5m) — abaixo de
            </label>
            <input
              type="number"
              value={rsiBuy}
              onChange={e => setRsiBuy(e.target.value)}
              min={10} max={50}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono"
              style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
            />
            <RsiSuggestHint
              label="<"
              suggested={ready ? suggest.entryRsiValue : null}
              current={rsiBuy}
              stats={entryStatsLine()}
              onApply={() => setRsiBuy(suggest.entryRsiValue)}
              loading={suggest?.loading}
              stale={entryHintStale}
              accent="#26a69a"
            />
          </div>

          {/* RSI venda + sugestão colada */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: '#ef5350' }}>
              RSI Venda (5m) — acima de
            </label>
            <input
              type="number"
              value={rsiSell}
              onChange={e => setRsiSell(e.target.value)}
              min={50} max={95}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono"
              style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
            />
            <RsiSuggestHint
              label=">"
              suggested={ready ? suggest.exitRsiValue : null}
              current={rsiSell}
              stats={exitStatsLine()}
              onApply={() => setRsiSell(suggest.exitRsiValue)}
              loading={suggest?.loading}
              stale={exitHintStale}
              accent="#ef5350"
            />
          </div>

          {/* Filtros MA */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={maFilters.enabled}
                  onChange={e => setMaFilters(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="accent-cyan-500"
                />
                <span className="text-[10px] uppercase tracking-wider text-p5/50">
                  Filtro MA na entrada
                </span>
              </label>
              {maFilters.enabled && (
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={loadMaAdaptation}
                    disabled={maAdapt?.loading || rsiInvalid}
                    className="text-[9px] px-1.5 py-0.5 rounded font-semibold disabled:opacity-40"
                    style={{ color: '#a78bfa', border: '1px solid #a78bfa44' }}
                    title="Analisa dips históricos + simulação bot para sugerir calibragem %"
                  >
                    {maAdapt?.loading ? '…' : 'Sugerir adaptação'}
                  </button>
                  <button
                    type="button"
                    onClick={addMaFilter}
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ color: FIVE_M_COLOR, border: `1px solid ${FIVE_M_COLOR}44` }}
                  >
                    + MA
                  </button>
                </div>
              )}
            </div>
            <div
              className={`space-y-1.5 rounded px-2 py-2 ${maFilters.enabled ? '' : 'opacity-40 pointer-events-none'}`}
              style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
            >
              {maFilters.filters.map((f, idx) => (
                <MaFilterRow
                  key={f.id}
                  filter={f}
                  onChange={next => patchMaFilter(idx, next)}
                  onRemove={() => removeMaFilter(idx)}
                  canRemove={maFilters.filters.length > 1}
                  toleranceSuggest={
                    (ready || (maAdapt && !maAdapt.loading && !maAdapt.error))
                      ? maSuggestForFilter(f.id)
                      : null
                  }
                />
              ))}
              <p className="text-[9px] text-p5/40 leading-relaxed pt-0.5">
                Calibragem: admite compra até X% abaixo da MA. Use <strong className="text-p5/60">Sugerir adaptação</strong> para calcular pelo histórico da moeda.
              </p>
              {(maAdapt?.summary || suggest?.maAdaptSummary) && !maAdapt?.loading && (
                <div
                  className="mt-2 rounded px-2 py-1.5 space-y-1"
                  style={{ background: '#161a28', border: '1px solid #a78bfa33' }}
                >
                  <p className="text-[9px] font-mono text-p5/60 leading-relaxed">
                    {maAdapt?.summary ?? suggest?.maAdaptSummary}
                  </p>
                  {(maAdapt?.filters ?? suggest?.maToleranceSuggestions)?.some(
                    s => s.recommendedTolerancePct !== s.currentTolerancePct,
                  ) && (
                    <button
                      type="button"
                      onClick={() => applyAllMaAdaptation(maAdapt?.filters ?? suggest?.maToleranceSuggestions)}
                      className="text-[9px] px-2 py-0.5 rounded font-semibold"
                      style={{ background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa55' }}
                    >
                      Aplicar todas as sugestões MA
                    </button>
                  )}
                </div>
              )}
              {maAdapt?.error && (
                <p className="text-[9px] text-amber-500/90 mt-1">{maAdapt.error}</p>
              )}
            </div>
          </div>

          {rsiInvalid && (
            <p className="text-[10px]" style={{ color: '#ef5350' }}>
              RSI compra deve ser menor que RSI venda.
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadSuggest}
              disabled={suggest?.loading || rsiInvalid}
              className="flex-1 py-2 text-xs rounded font-bold transition-opacity disabled:opacity-40"
              style={{ background: needsRecalc ? '#f59e0b' : FIVE_M_COLOR, color: '#000' }}
            >
              {suggest?.loading
                ? 'Calculando…'
                : needsRecalc
                  ? '↻ Calcular'
                  : '↻ Histórico'}
            </button>
            <button
              type="button"
              onClick={runLiveTest}
              disabled={liveTest?.loading || rsiInvalid}
              className="flex-1 py-2 text-xs rounded font-bold transition-opacity disabled:opacity-40"
              style={{ background: '#2a2d3a', color: '#e2e8f0', border: `1px solid ${FIVE_M_COLOR}66` }}
              title="Testa com candles recentes da exchange e os parâmetros acima"
            >
              {liveTest?.loading ? '…' : '⚡ Testar agora'}
            </button>
          </div>

          <LiveTestPanel data={liveTest} />

          {needsRecalc && !suggest?.loading && (
            <p className="text-[9px] text-center text-amber-500/90">
              Parâmetros alterados — clique para atualizar as análises
            </p>
          )}

          {suggest?.loading && (
            <p className="text-[10px] text-center text-p5/40">
              Simulando RSI &lt;{rsiBuy} → &gt;{rsiSell}
              {maFilters.enabled ? ` · ${describeMaFiltersLocal(maFilters)}` : ''}…
            </p>
          )}

          {suggest && !suggest.loading && suggest.error && (
            <p className="text-[10px] text-center" style={{ color: '#f59e0b' }}>{suggest.error}</p>
          )}

          {ready && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[10px] uppercase tracking-wider text-p5/50">Análises</span>
                {suggest.candleCount && (
                  <span className="text-[9px] font-mono text-p5/40">
                    {suggest.candleCount} candles
                    {suggest.evaluatedAt && ` · ${new Date(suggest.evaluatedAt).toLocaleTimeString()}`}
                    {suggest.rsiNow != null && ` · RSI ${suggest.rsiNow}`}
                    {suggest.maDescription && ` · ${suggest.maDescription}`}
                  </span>
                )}
              </div>

              <AnalysisAccordion
                id="swing"
                openId={openSection}
                onToggle={setOpenSection}
                title="Padrão de alta %"
                subtitle={swingSubtitle()}
                accent="#26a69a"
              >
                <PatternDetail data={suggest.swingPattern} />
              </AnalysisAccordion>

              <AnalysisAccordion
                id="bot"
                openId={openSection}
                onToggle={setOpenSection}
                title="Simulação bot (DCA 2h)"
                subtitle={botSubtitle()}
                accent="#f59e0b"
              >
                <PatternDetail data={suggest.botSimulation} />
              </AnalysisAccordion>

              <AnalysisAccordion
                id="episodes"
                openId={openSection}
                onToggle={setOpenSection}
                title="Episódios de sobrevenda"
                subtitle={suggest.entry?.mostFrequentEpisode
                  ? `mais frequente: < ${suggest.entry.mostFrequentEpisode.value} (${suggest.entry.mostFrequentEpisode.episodes}×)`
                  : 'frequência por limiar'}
                accent={FIVE_M_COLOR}
              >
                {suggest.entry?.frequency?.length > 0 ? (
                  <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[9px] font-mono text-p5/60">
                    {suggest.entry.frequency.map(f => (
                      <span
                        key={f.value}
                        className={f.value === suggest.entryRsiValue ? 'text-cyan-400 font-semibold' : ''}
                      >
                        &lt;{f.value}: {f.episodes}× ({f.pctCandles}%)
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-p5/50">Sem dados de frequência.</p>
                )}
              </AnalysisAccordion>

              {suggest.summary && (
                <AnalysisAccordion
                  id="summary"
                  openId={openSection}
                  onToggle={setOpenSection}
                  title="Resumo"
                  subtitle="visão geral do histórico"
                  accent="#94a3b8"
                >
                  <p className="text-[9px] leading-relaxed text-p5/60">{suggest.summary}</p>
                </AnalysisAccordion>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-4 pb-4">
          {isActive && (
            <button
              onClick={onRemove}
              disabled={inPosition}
              title={inPosition ? 'Aguarde venda para remover' : 'Remover dos favoritos 5m Trade'}
              className="flex-1 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
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
            disabled={!Number(capital) || Number(capital) <= 0 || rsiInvalid}
            className="flex-1 py-1.5 text-xs rounded font-semibold transition-opacity disabled:opacity-40"
            style={{ background: FIVE_M_COLOR, color: '#000' }}
          >
            {isActive ? 'Atualizar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
}
