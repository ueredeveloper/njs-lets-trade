import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFiveMTradeSuggestRsi, evaluateFiveMTradeLive, fetchFiveMTradeSuggestMaAdaptation, fetchFiveMTradeSuggestRecovery, fetchFiveMTradeSuggestEntryBelow, fetchFiveMTradeSuggestPathCooldown } from '../services/api';
import Tooltip from './Tooltip';
import FiveMStopLossSelector, { initialStopLossTypes, stopOptionAvailable } from './FiveMStopLossSelector';
import { stopLossTypesLabel, DEFAULT_FIVE_M_RSI_BUY, DEFAULT_FIVE_M_RSI_SELL, stopPayloadFromRecovery, hasSavedStopLossTypes, pickDefaultStopTypes } from '../constants/fiveMStopLoss';
import { ENTRY_PRICE_OPTIONS, MA_ENTRY_PRICE_OPTIONS, entryPriceLabel, initialEntryPrice, normalizeEntryPriceForm, clampBelowPct, clampMaBelowPct, parseBelowPctInput } from '../constants/fiveMEntryPrice';
import { getRecoveryPatternOptions, recoveryPatternTypesLabel, recoveryPatternZonesLabel, DEFAULT_RECOVERY_PATTERN } from '../constants/fiveMRecoveryPattern';
import { SELL_SCOPE_OPTIONS, sellScopeLabel } from '../constants/fiveMSellScope';
import {
  initialEntryPaths, normalizeEntryPathsForm, entryPathsLabel, hasEntryPath, MA5M_TRIGGER_OPTIONS,
  COMBINE_OPTIONS, pathCooldownHoursForSource, clampPathCooldownHours,
} from '../constants/fiveMEntryPaths';

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

function PathCooldownSelector({ report, source, onSelectSource, loading, stale }) {
  if (loading) {
    return <p className="mt-1 text-[9px] text-p5/40 font-mono">Calculando intervalos…</p>;
  }
  if (!report || report.error) return null;

  const options = [
    {
      id: 'rsi',
      hours: report.rsiCooldownHours,
      calc: report.rsiCalc,
      title: report.rsiCooldownHours != null
        ? `De ${report.rsiCooldownHours}h em ${report.rsiCooldownHours}h — RSI<${report.rsiBuy ?? '—'}`
        : 'RSI — sem intervalo calculável',
    },
    {
      id: 'ma',
      hours: report.maCooldownHours,
      calc: report.maCalc,
      title: report.maCooldownHours != null
        ? `De ${report.maCooldownHours}h em ${report.maCooldownHours}h — MA50 5m`
        : 'MA50 5m — sem intervalo calculável',
    },
  ];

  return (
    <div className="mt-2 space-y-1.5">
      <span className="text-[9px] uppercase tracking-wider text-p5/50 block">
        Escolha o período (histórico 5m)
      </span>
      {options.map(opt => {
        const active = source === opt.id;
        const disabled = opt.hours == null;
        return (
          <label
            key={opt.id}
            className="flex items-start gap-2 rounded px-2 py-2 cursor-pointer"
            style={{
              background: active ? '#06b6d414' : '#1e2130',
              border: `1px solid ${active ? FIVE_M_COLOR : '#2a2d3a'}`,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            <input
              type="radio"
              name="pathCooldownSource"
              checked={active}
              disabled={disabled}
              onChange={() => !disabled && onSelectSource(opt.id, opt.hours)}
              className="mt-0.5 shrink-0"
              style={{ accentColor: FIVE_M_COLOR }}
            />
            <span className="min-w-0">
              <span className="text-[10px] font-medium text-p5 block">{opt.title}</span>
              {opt.calc && !stale && (
                <span className="text-[9px] text-p5/45 block mt-0.5 leading-relaxed">{opt.calc}</span>
              )}
            </span>
          </label>
        );
      })}
      {!report.ok && !stale && (
        <p className="text-[9px] text-p5/40">Poucos episódios — use o padrão 2h (MA) ou aguarde mais histórico.</p>
      )}
    </div>
  );
}

function SuggestButton({ onClick, loading, disabled, color = FIVE_M_COLOR, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className="text-[9px] px-1.5 py-0.5 rounded font-semibold disabled:opacity-40 shrink-0"
      style={{ color, border: `1px solid ${color}44` }}
    >
      {loading ? '…' : 'Sugerir'}
    </button>
  );
}

function AnalysisAccordion({ id, openIds, onToggle, title, subtitle, accent, action, children }) {
  const open = openIds instanceof Set ? openIds.has(id) : false;
  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid #2a2d3a' }}>
      <div className="flex items-start gap-1 px-2.5 py-2 hover:bg-white/[0.03] transition-colors">
        <button
          type="button"
          onClick={() => onToggle(id)}
          className="flex-1 min-w-0 flex items-start justify-between gap-2 text-left"
        >
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-semibold block" style={{ color: accent }}>{title}</span>
            {subtitle && (
              <span className="text-[9px] font-mono text-p5/50 block mt-0.5 truncate">{subtitle}</span>
            )}
          </div>
          <span className="text-p5/40 text-[10px] shrink-0 mt-0.5">{open ? '▾' : '▸'}</span>
        </button>
        {action && (
          <div className="shrink-0 pt-0.5" onClick={e => e.stopPropagation()}>
            {action}
          </div>
        )}
      </div>
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
          {' · '}clique <strong>Sugerir</strong> para atualizar
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

function MaToleranceHint({ suggestion, onApply, loading, stale }) {
  if (loading) return <p className="text-[9px] text-p5/40 font-mono mt-1">Calculando calibragem MA…</p>;
  if (!suggestion) return null;
  const suggested = suggestion.recommendedTolerancePct ?? suggestion.suggestedTolerancePct;
  if (suggested == null) return null;
  const current = Number(suggestion.currentTolerancePct ?? 0);
  const differs = suggested !== current;

  if (stale) {
    return (
      <p className="text-[9px] text-amber-500/85 font-mono mt-1">
        Parâmetros alterados — clique <strong>Sugerir</strong> para recalcular a calibragem MA.
      </p>
    );
  }

  const detailParts = [];
  if (suggestion.reason) detailParts.push(suggestion.reason);
  if (suggestion.recommendationLabel) detailParts.push(suggestion.recommendationLabel);
  if (suggestion.entryOk != null) {
    detailParts.push(`agora ${suggestion.entryOk ? 'OK' : 'bloqueado'} (dip ${suggestion.dipNowPct ?? '—'}%)`);
  }
  if (suggestion.vsCurrent?.tradeDelta != null && suggestion.vsCurrent.tradeDelta !== 0) {
    detailParts.push(`+${suggestion.vsCurrent.tradeDelta} trades vs atual`);
  }

  return (
    <div className="mt-1 rounded px-2 py-1" style={{ background: '#161a28', border: '1px solid #2a2d3a' }}>
      <p className="text-[9px] font-mono leading-relaxed text-p5/60">
        <span style={{ color: FIVE_M_COLOR }}>Sugestão: −{suggested}%</span>
        {detailParts.length > 0 && (
          <span className="text-p5/50"> · {detailParts.join(' · ')}</span>
        )}
        {!differs && <span className="text-p5/40"> · valor atual</span>}
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

function MiniCandle({ green }) {
  const color = green ? '#26a69a' : '#ef5350';
  return (
    <span className="inline-flex flex-col items-center" style={{ gap: 1 }}>
      <span style={{ width: 2, height: 4, background: color, display: 'block', margin: '0 auto', borderRadius: 1 }} />
      <span style={{ width: 8, height: 13, background: color, display: 'block', borderRadius: 1 }} />
      <span style={{ width: 2, height: 3, background: color, display: 'block', margin: '0 auto', borderRadius: 1 }} />
    </span>
  );
}

function CandleRow({ pattern }) {
  return (
    <div className="flex items-end gap-1">
      {pattern.map((green, i) => <MiniCandle key={i} green={green} />)}
    </div>
  );
}

function initialRecoveryPattern(entry) {
  const rp = entry?.recoveryPattern;
  let types = [];
  if (Array.isArray(rp?.types)) {
    types = rp.types.filter(t => getRecoveryPatternOptions().some(o => o.type === t));
  } else if (rp?.type && rp.type !== 'none' && getRecoveryPatternOptions().some(o => o.type === rp.type)) {
    types = [rp.type];
  }
  const zones = Array.isArray(rp?.zones) ? rp.zones : [];
  const abovePct = Number(rp?.abovePct ?? DEFAULT_RECOVERY_PATTERN.abovePct) || DEFAULT_RECOVERY_PATTERN.abovePct;
  return { types, zones, abovePct };
}

function togglePatternType(list, type) {
  return list.includes(type) ? list.filter(t => t !== type) : [...list, type];
}

function MaAbovePctHint({ maZone, rsiBuy, abovePct, onApply, loading }) {
  if (loading) {
    return <p className="text-[9px] text-p5/40 font-mono mt-1">Calculando % acima da MA…</p>;
  }
  const suggested = maZone?.suggestedAbovePct;
  if (suggested == null) return null;

  const differs = suggested !== Number(abovePct);
  const stats = [
    maZone.signalCount != null ? `${maZone.signalCount} sinais RSI<${rsiBuy}` : null,
    maZone.medianStretchPct != null ? `mediana +${maZone.medianStretchPct}%` : null,
    maZone.aboveNowPct != null ? `agora +${maZone.aboveNowPct}%` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mt-1.5 rounded px-2 py-1.5" style={{ background: '#161a28', border: '1px solid #06b6d444' }}>
      <p className="text-[9px] font-mono leading-relaxed text-cyan-400/90">
        Sugestão Multi-Trade: <strong>+{suggested}%</strong> acima MA{maZone.maPeriod ?? 50} {maZone.maInterval ?? '1h'}
        {stats && <span className="block text-p5/45 mt-0.5">{stats}</span>}
        {!differs && <span className="text-p5/40"> · atual</span>}
      </p>
      {differs && (
        <button
          type="button"
          onClick={() => onApply(suggested)}
          className="mt-1 text-[9px] px-1.5 py-0.5 rounded font-medium"
          style={{ background: '#06b6d422', color: '#06b6d4', border: '1px solid #06b6d455' }}
        >
          Usar +{suggested}%
        </button>
      )}
    </div>
  );
}

function RecoveryPatternSelector({
  analysis, live, maZone, loading, rsiBuy,
  patternTypes, zones, abovePct,
  onPatternsChange, onZonesChange, onAbovePctChange,
}) {
  if (loading) {
    return <p className="text-[9px] text-p5/40 font-mono mt-1">Analisando padrões 1h…</p>;
  }
  const options     = getRecoveryPatternOptions(rsiBuy);
  const recommended = analysis?.recommended;
  const histMap     = Object.fromEntries((analysis?.patterns ?? []).map(p => [p.type, p]));

  return (
    <div className="space-y-2">
      <p className="text-[9px] text-p5/50 leading-relaxed">
        <strong className="text-p5/65">Opcional.</strong> Sem padrão selecionado, a entrada não exige confirmação 1h.
        Com padrões ativos, na zona MA marcada basta <strong className="text-p5/70">qualquer</strong> padrão.
        Entrada bloqueada se houver <strong className="text-p5/70">3 vermelhos</strong> seguidos (queda em direção à MA).
        {!analysis && (
          <span className="block text-p5/40 mt-0.5">Clique em <strong className="text-p5/55">Sugerir</strong> para ver histórico e recomendações.</span>
        )}
        {analysis?.summary && (
          <span className="block text-amber-500/85 mt-0.5">{analysis.summary}</span>
        )}
        {maZone?.ok && (
          <span className="block text-cyan-400/80 mt-0.5">{maZone.description}</span>
        )}
      </p>

      <div className="rounded px-2 py-2 space-y-1.5" style={{ background: '#161a28', border: '1px solid #2a2d3a' }}>
        <p className="text-[9px] uppercase tracking-wider text-p5/40">Zonas MA (quando exigir o padrão)</p>
        <label className="flex items-start gap-2 text-[9px] cursor-pointer flex-wrap">
          <input
            type="checkbox"
            checked={zones.includes('above_ma')}
            onChange={() => onZonesChange(
              zones.includes('above_ma')
                ? zones.filter(z => z !== 'above_ma')
                : [...zones, 'above_ma'],
            )}
            className="accent-cyan-500 mt-0.5"
          />
          <span className="text-p5/70 shrink-0">Acima da MA50 1h — mínimo +</span>
          <input
            type="number"
            value={abovePct}
            onChange={e => onAbovePctChange(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
            min={0} max={20} step={0.5}
            className="w-12 rounded px-1 py-0.5 font-mono text-p5 outline-none"
            style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}
          />
          <span className="text-p5/50">%</span>
        </label>
        <MaAbovePctHint
          maZone={maZone}
          rsiBuy={rsiBuy}
          abovePct={abovePct}
          onApply={onAbovePctChange}
          loading={loading}
        />
        <label className="flex items-center gap-2 text-[9px] cursor-pointer text-p5/70">
          <input
            type="checkbox"
            checked={zones.includes('between_ma')}
            onChange={() => onZonesChange(
              zones.includes('between_ma')
                ? zones.filter(z => z !== 'between_ma')
                : [...zones, 'between_ma'],
            )}
            className="accent-cyan-500"
          />
          Entre a MA e o piso adaptativo (calibragem % do filtro MA)
        </label>
      </div>

      {live?.threeReds && (
        <p className="text-[9px] text-red-400/90 rounded px-2 py-1" style={{ background: '#ef535414', border: '1px solid #ef535044' }}>
          Agora: 3 candles 1h vermelhos — entrada bloqueada nesta zona
        </p>
      )}

      {options.map(opt => {
        const active    = patternTypes.includes(opt.type);
        const hist      = histMap[opt.type];
        const liveOn    = live?.active?.[opt.type];
        const isRec     = recommended === opt.type;
        return (
          <label
            key={opt.type}
            className="flex items-start gap-2 rounded px-2 py-2 cursor-pointer hover:opacity-90 transition-colors"
            style={{
              background: active ? '#26a69a14' : '#1e2130',
              border: `1px solid ${active ? '#26a69a' : isRec ? '#f59e0b55' : '#2a2d3a'}`,
            }}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => onPatternsChange(togglePatternType(patternTypes, opt.type))}
              className="mt-0.5 shrink-0"
              style={{ accentColor: '#26a69a' }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CandleRow pattern={opt.visual} />
                <Tooltip text={opt.tooltip} maxW={300}>
                  <span className="text-[9px] font-semibold underline decoration-dotted decoration-p5/30 underline-offset-2 text-p5/80">
                    {opt.label}
                  </span>
                </Tooltip>
                {isRec && (
                  <span className="text-[8px] px-1 rounded font-medium" style={{ background: '#f59e0b22', color: '#f59e0b' }}>
                    sugerido
                  </span>
                )}
                {liveOn != null && (
                  <span className="text-[8px] font-mono" style={{ color: liveOn ? '#26a69a' : '#4b5563' }}>
                    agora {liveOn ? '✓' : '✗'}
                  </span>
                )}
              </div>
              <p className="text-[9px] text-p5/55 leading-relaxed mt-0.5">{opt.summary}</p>
              {hist && (
                <p className="text-[9px] font-mono text-p5/60 mt-0.5">
                  {hist.entries}× RSI&lt;{rsiBuy} · win {hist.winRate}% · +{hist.avgRisePct}% médio
                </p>
              )}
              {!hist && analysis?.ok && (
                <p className="text-[9px] font-mono text-p5/35 mt-0.5">sem ocorrências no histórico</p>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}

function CandlePatternHint({ patterns }) {
  if (!patterns?.ok) return null;
  const { threeCandles, fourCandles } = patterns;

  return (
    <div className="rounded px-2 py-2 space-y-2" style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}>
      <p className="text-[9px] uppercase tracking-wider text-p5/40">Padrão 1h — moeda já se recuperando?</p>

      {/* 3 candles */}
      <div className="flex items-center gap-3">
        <CandleRow pattern={[true, true, true]} />
        <div>
          <p className="text-[9px] font-mono" style={{ color: threeCandles ? '#26a69a' : '#4b5563' }}>
            {threeCandles ? '✓' : '✗'} 3 verdes seguidos
          </p>
          <p className="text-[9px] text-p5/30">últimos 3 candles 1h fecharam para cima</p>
        </div>
      </div>

      {/* 4 candles */}
      <div className="flex items-center gap-3">
        <CandleRow pattern={[true, true, true, false]} />
        <div>
          <p className="text-[9px] font-mono" style={{ color: fourCandles ? '#f59e0b' : '#4b5563' }}>
            {fourCandles ? '✓' : '✗'} 3 verdes + 1 vermelho
          </p>
          <p className="text-[9px] text-p5/30">padrão de reversão — subiu, respirou, pode voltar</p>
        </div>
      </div>

      {!threeCandles && !fourCandles && (
        <p className="text-[9px] text-p5/40 pt-0.5">Nenhum padrão ativo — recuperação ainda não confirmada nos candles 1h</p>
      )}
    </div>
  );
}

function MaFilterRow({ filter, onChange, onRemove, canRemove, toleranceSuggest, toleranceLoading, toleranceStale }) {
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
          loading={toleranceLoading}
          stale={toleranceStale}
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
        {data.fastPoll && ' · poll rápido 1min'}
        {data.nearMa5m && data.ma5mDistPct != null && ` · MA50 5m ${data.ma5mDistPct}%`}
        {data.ma5mTrigger?.livePrice != null && ' · preço ao vivo'}
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
  const [rsiBuy, setRsiBuy]       = useState(currentEntry?.rsiBuy ?? DEFAULT_FIVE_M_RSI_BUY);
  const [rsiSell, setRsiSell]     = useState(currentEntry?.rsiSell ?? DEFAULT_FIVE_M_RSI_SELL);
  const [maFilters, setMaFilters] = useState(() => cloneMaFilters(currentEntry?.maFilters));
  const [suggest, setSuggest]           = useState(null);
  const [liveTest, setLiveTest]         = useState(null);
  const [maAdapt, setMaAdapt]           = useState(null);
  const [recoverySuggest, setRecoverySuggest] = useState(null);
  const [stopSuggest, setStopSuggest] = useState(null);
  const [stopLossTypes, setStopLossTypes] = useState(() => initialStopLossTypes(currentEntry));
  const [recoveryPattern, setRecoveryPattern] = useState(() => initialRecoveryPattern(currentEntry));
  const [sellScope, setSellScope] = useState(() => currentEntry?.sellScope ?? 'bot_only');
  const [entryPrice, setEntryPrice] = useState(() => initialEntryPrice(currentEntry));
  const [entryPaths, setEntryPaths] = useState(() => initialEntryPaths(currentEntry));
  const [pathCooldownSuggest, setPathCooldownSuggest] = useState(null);
  const [entryBelowSuggest, setEntryBelowSuggest] = useState(null);
  const [suggestCtx, setSuggestCtx]     = useState(null);
  const [openSections, setOpenSections] = useState(() => new Set(['candles']));
  const entryHadSavedStopsRef = useRef(hasSavedStopLossTypes(currentEntry));
  function toggleSection(id) {
    setOpenSections(prev => (prev.has(id) ? new Set() : new Set([id])));
  }
  const entryKey = currentEntry?.id != null ? String(currentEntry.id) : `new:${symbol}`;

  const inPosition = currentEntry?.phase === 'BOUGHT';
  const rsiInvalid = entryPaths.rsi.enabled && Number(rsiBuy) >= Number(rsiSell);
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

  const recoveryZonesMissing = recoveryPattern.types.length > 0 && !recoveryPattern.zones.length;
  const entryPathsMissing = !hasEntryPath(entryPaths);

  const recoverySuggestStale = recoverySuggest && !recoverySuggest.loading && !recoverySuggest.error && (
    Number(rsiBuy) !== Number(recoverySuggest.rsiBuy) ||
    Number(rsiSell) !== Number(recoverySuggest.rsiSell) ||
    maFiltersKey(maFilters) !== suggestCtx?.maKey
  );
  const stopSuggestStale = stopSuggest && !stopSuggest.loading && !stopSuggest.error && (
    Number(rsiBuy) !== Number(stopSuggest.rsiBuy) ||
    Number(rsiSell) !== Number(stopSuggest.rsiSell) ||
    maFiltersKey(maFilters) !== suggestCtx?.maKey
  );

  const stopLossNeedsSuggest = !stopSuggest || stopSuggest.loading || stopSuggest.error || stopSuggestStale;
  const stopLossInvalid = stopLossTypes.some(t => !stopOptionAvailable(t, stopSuggest, rsiBuy));
  const formReady = !recoveryZonesMissing && !stopLossInvalid && !entryPathsMissing;

  const pathCooldownStale = pathCooldownSuggest && !pathCooldownSuggest.loading && !pathCooldownSuggest.error && (
    Number(rsiBuy) !== Number(pathCooldownSuggest.rsiBuy) ||
    entryPaths.ma50_5m.trigger !== pathCooldownSuggest.trigger ||
    Number(entryPaths.ma50_5m.tolerancePct) !== Number(pathCooldownSuggest.tolerancePct) ||
    maFiltersKey(maFilters) !== pathCooldownSuggest.maKey
  );

  const loadPathCooldownSuggest = useCallback(async () => {
    const buy = Number(rsiBuy);
    if (!Number.isFinite(buy)) return;
    if (!entryPaths.rsi.enabled || !entryPaths.ma50_5m.enabled) return;

    setPathCooldownSuggest({ loading: true });
    try {
      const r = await fetchFiveMTradeSuggestPathCooldown({
        symbol,
        exchange,
        rsiBuy: buy,
        maFilters,
        trigger: entryPaths.ma50_5m.trigger,
        tolerancePct: entryPaths.ma50_5m.tolerancePct,
      });
      const payload = {
        ...r,
        rsiBuy: buy,
        trigger: entryPaths.ma50_5m.trigger,
        tolerancePct: entryPaths.ma50_5m.tolerancePct,
        maKey: maFiltersKey(maFilters),
      };
      setPathCooldownSuggest(payload);

      const src = entryPaths.pathCooldownSource === 'rsi' ? 'rsi' : 'ma';
      const hours = pathCooldownHoursForSource(payload, src)
        ?? pathCooldownHoursForSource(payload, src === 'rsi' ? 'ma' : 'rsi');
      if (hours != null) {
        setEntryPaths(prev => ({ ...prev, pathCooldownHours: hours }));
      }
    } catch (err) {
      setPathCooldownSuggest({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, maFilters, entryPaths.rsi.enabled, entryPaths.ma50_5m.enabled, entryPaths.ma50_5m.trigger, entryPaths.ma50_5m.tolerancePct, entryPaths.pathCooldownSource]);

  function selectPathCooldownSource(source, hours) {
    setEntryPaths(prev => ({
      ...prev,
      pathCooldownSource: source,
      pathCooldownHours: hours != null ? clampPathCooldownHours(hours) : prev.pathCooldownHours,
    }));
  }

  const loadRsiSuggest = useCallback(async () => {
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
    } catch (err) {
      setSuggest({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, rsiSell, maFilters]);

  const loadEntryBelowSuggest = useCallback(async () => {
    const buy = Number(rsiBuy);
    if (!Number.isFinite(buy) || rsiInvalid) return;

    setEntryBelowSuggest({ loading: true });
    try {
      const r = await fetchFiveMTradeSuggestEntryBelow({ symbol, exchange, rsiBuy: buy });
      setEntryBelowSuggest({ ...r, rsiBuy: buy });
    } catch (err) {
      setEntryBelowSuggest({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, rsiInvalid]);

  const entryBelowStale = entryBelowSuggest && !entryBelowSuggest.loading && !entryBelowSuggest.error
    && Number(rsiBuy) !== Number(entryBelowSuggest.rsiBuy);

  const maAdaptStale = maAdapt && !maAdapt.loading && !maAdapt.error && (
    Number(rsiBuy) !== Number(maAdapt.rsiBuy) ||
    Number(rsiSell) !== Number(maAdapt.rsiSell) ||
    maFiltersKey(maFilters) !== maAdapt.maKey
  );

  const loadRecoverySuggest = useCallback(async () => {
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell) return;

    setRecoverySuggest({ loading: true });
    setStopSuggest({ loading: true });
    try {
      const rec = await fetchFiveMTradeSuggestRecovery({
        symbol, exchange, rsiBuy: buy, rsiSell: sell, maFilters,
      });
      const ctx = { exchange, rsiBuy: buy, rsiSell: sell, maKey: maFiltersKey(maFilters) };
      setSuggestCtx(prev => ({ ...prev, ...ctx }));
      setRecoverySuggest({ ...rec, rsiBuy: buy, rsiSell: sell });
      const stopPayload = stopPayloadFromRecovery({ ...rec, rsiBuy: buy, rsiSell: sell });
      setStopSuggest(stopPayload);
      if (!entryHadSavedStopsRef.current) {
        const picked = pickDefaultStopTypes(stopPayload, buy);
        if (picked.length) setStopLossTypes(picked);
      }
    } catch (err) {
      setRecoverySuggest({ error: err.message });
      setStopSuggest({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, rsiSell, maFilters]);

  const runLiveTest = useCallback(async () => {
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell) return;

    setLiveTest({ loading: true });
    setOpenSections(prev => { const s = new Set(prev); s.add('live'); return s; });
    try {
      const r = await evaluateFiveMTradeLive({
        symbol,
        exchange,
        rsiBuy: buy,
        rsiSell: sell,
        maFilters,
        recoveryPattern: recoveryPattern.types.length
          ? { types: recoveryPattern.types, zones: recoveryPattern.zones, abovePct: recoveryPattern.abovePct }
          : undefined,
        sellScope,
        entryPaths: normalizeEntryPathsForm(entryPaths),
        entryPath: currentEntry?.entryPath ?? 'rsi',
        phase: currentEntry?.phase ?? 'WATCHING',
        lastBuyTime: currentEntry?.lastBuyTime ?? null,
        buyCount: currentEntry?.buyCount ?? 0,
      });
      setLiveTest(r);
    } catch (err) {
      setLiveTest({ error: err.message });
    }
  }, [symbol, exchange, rsiBuy, rsiSell, maFilters, recoveryPattern, sellScope, entryPaths, currentEntry]);

  const loadMaAdaptation = useCallback(async () => {
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell || !maFilters.enabled) return;

    setMaAdapt({ loading: true });
    try {
      const r = await fetchFiveMTradeSuggestMaAdaptation({
        symbol, exchange, rsiBuy: buy, rsiSell: sell, maFilters,
      });
      setMaAdapt({
        ...r,
        rsiBuy: buy,
        rsiSell: sell,
        maKey: maFiltersKey(maFilters),
      });
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
    const buy = currentEntry?.rsiBuy ?? DEFAULT_FIVE_M_RSI_BUY;
    const sell = currentEntry?.rsiSell ?? DEFAULT_FIVE_M_RSI_SELL;
    const ma  = cloneMaFilters(currentEntry?.maFilters);
    const cap = currentEntry?.capital ?? 40;

    setExchange(ex);
    setCapital(cap);
    setRsiBuy(buy);
    setRsiSell(sell);
    setMaFilters(ma);
    setRecoveryPattern(initialRecoveryPattern(currentEntry));
    entryHadSavedStopsRef.current = hasSavedStopLossTypes(currentEntry);
    setStopLossTypes(initialStopLossTypes(currentEntry));
    setSellScope(currentEntry?.sellScope ?? 'bot_only');
    setEntryPrice(initialEntryPrice(currentEntry));
    setEntryPaths(initialEntryPaths(currentEntry));
    setEntryBelowSuggest(null);
    setSuggest(null);
    setSuggestCtx(null);
    setMaAdapt(null);
    setRecoverySuggest(null);
    setStopSuggest(null);
    setLiveTest(null);
    setOpenSections(new Set(['candles']));
  // entryKey muda ao abrir outra moeda ou quando favoritos carregam o id
  // eslint-disable-next-line react-hooks/exhaustive-deps -- currentEntry lido no corpo; entryKey evita loop
  }, [symbol, entryKey, defaultExchange]);

  useEffect(() => {
    if (!openSections.has('stop')) return;
    const buy  = Number(rsiBuy);
    const sell = Number(rsiSell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell) return;
    if (stopSuggest?.loading || recoverySuggest?.loading) return;
    if (stopLossNeedsSuggest || stopSuggestStale) {
      loadRecoverySuggest();
    }
  }, [
    openSections, rsiBuy, rsiSell, stopLossNeedsSuggest, stopSuggestStale,
    stopSuggest?.loading, recoverySuggest?.loading, loadRecoverySuggest,
  ]);

  function entryAccordionSubtitle() {
    const parts = [entryPathsLabel(entryPaths)];
    if (entryPaths.rsi.enabled) parts.push(`RSI<${rsiBuy} → >${rsiSell}`);
    if (entryPaths.ma50_5m.enabled) parts.push('MA50 5m');
    if (entryPaths.rsi.enabled && entryPaths.ma50_5m.enabled && entryPaths.combine === 'any') {
      const src = entryPaths.pathCooldownSource === 'rsi' ? 'RSI' : 'MA';
      parts.push(`${entryPaths.pathCooldownHours}h (${src})`);
    }
    return parts.join(' · ');
  }

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
    const histWarn = suggest.entry?.histStopWarning ? ' · stop hist. indisponível' : '';
    return `${b.tradeCount} trades · PnL ${fmtPct(b.avgPnl)} · win ${b.winRate}%${maStatsSuffix()}${sample}${histWarn}`;
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
    const row = maAdapt?.filters?.find(s => s.filterId === filterId);
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
    if (!Number.isFinite(cap) || cap <= 0 || !formReady) return;
    if (entryPaths.rsi.enabled && buy >= sell) return;
    onConfirm({
      exchange, capital: cap, rsiBuy: buy, rsiSell: sell, maFilters,
      stopLoss: { types: stopLossTypes },
      recoveryPattern: {
        types: recoveryPattern.types,
        zones: recoveryPattern.zones,
        abovePct: recoveryPattern.abovePct,
      },
      sellScope,
      entryPrice: normalizeEntryPriceForm(entryPrice),
      entryPaths: normalizeEntryPathsForm(entryPaths),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onCancel}
    >
      <div
        className="absolute inset-x-4 top-6 bottom-6 max-w-sm mx-auto flex flex-col rounded-lg shadow-2xl border"
        style={{ background: '#131722', borderColor: '#2a2d3a' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: '#2a2d3a' }}>
          <div>
            <span className="text-xs font-semibold text-p5">5m Trade</span>
            <span className="ml-2 text-xs font-mono font-bold" style={{ color: FIVE_M_COLOR }}>{symbol}</span>
          </div>
          <button onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none transition-colors">×</button>
        </div>

        <div className="px-4 py-4 space-y-3.5 overflow-y-auto flex-1 min-h-0">
          <AnalysisAccordion
            id="sobre"
            openIds={openSections}
            onToggle={toggleSection}
            title="Sobre a estratégia"
            subtitle="RSI(14, 5m) · DCA a cada 2h · venda total na saída"
            accent="#94a3b8"
          >
            <p className="text-[10px] leading-relaxed pt-1" style={{ color: '#94a3b8' }}>
              RSI(14, 5m) · DCA a cada 2h · saída por RSI
              <span className="block mt-0.5 text-p5/45">
                Venda: {sellScopeLabel(sellScope)}
              </span>
              {maFilters.enabled && (
                <span className="block mt-1 text-cyan-400/80">
                  Entrada só com preço {maFilters.filters.filter(f => f.enabled).map(f =>
                    `${f.mode === 'below' ? '<' : '>'} MA${f.period} ${f.interval}${f.tolerancePct > 0 ? ` (−${f.tolerancePct}%)` : ''}`,
                  ).join(' · ') || '(nenhum filtro ativo)'}
                </span>
              )}
            </p>
          </AnalysisAccordion>

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

          <AnalysisAccordion
            id="sellScope"
            openIds={openSections}
            onToggle={toggleSection}
            title="Na venda (RSI ou stop)"
            subtitle={sellScopeLabel(sellScope)}
            accent={FIVE_M_COLOR}
          >
            <div className="pt-2 space-y-1.5">
              {SELL_SCOPE_OPTIONS.map(opt => {
                const active = sellScope === opt.id;
                return (
                  <label
                    key={opt.id}
                    className="flex items-start gap-2 rounded px-2 py-2 cursor-pointer hover:opacity-90 transition-colors"
                    style={{
                      background: active ? '#06b6d414' : '#1e2130',
                      border: `1px solid ${active ? FIVE_M_COLOR : '#2a2d3a'}`,
                    }}
                  >
                    <input
                      type="radio"
                      name="sellScope"
                      value={opt.id}
                      checked={active}
                      onChange={() => setSellScope(opt.id)}
                      className="mt-0.5 shrink-0"
                      style={{ accentColor: FIVE_M_COLOR }}
                    />
                    <span className="min-w-0">
                      <span className="text-[10px] font-medium text-p5 block">{opt.label}</span>
                      <span className="text-[9px] text-p5/50 block mt-0.5 leading-relaxed">{opt.summary}</span>
                      <Tooltip text={opt.tooltip} maxW={260}>
                        <span className="text-[8px] text-p5/35 underline decoration-dotted cursor-help mt-0.5 inline-block">
                          detalhes
                        </span>
                      </Tooltip>
                    </span>
                  </label>
                );
              })}
            </div>
          </AnalysisAccordion>

          <AnalysisAccordion
            id="entry"
            openIds={openSections}
            onToggle={toggleSection}
            title="Entrada (5m)"
            subtitle={entryAccordionSubtitle()}
            accent={FIVE_M_COLOR}
          >
            <div className="pt-2 space-y-3">
              <p className="text-[9px] text-p5/45 leading-relaxed">
                Acima da MA50 1h (filtro MA): entre por RSI de sobrevenda, toque na MA50 5m, ou ambos.
              </p>

              {/* ── Caminhos ── */}
              <div className="space-y-1.5">
                <label
                  className="flex items-start gap-2 rounded px-2 py-2 cursor-pointer"
                  style={{ background: '#1e2130', border: `1px solid ${entryPaths.rsi.enabled ? FIVE_M_COLOR : '#2a2d3a'}` }}
                >
                  <input
                    type="checkbox"
                    checked={entryPaths.rsi.enabled}
                    onChange={e => setEntryPaths(prev => ({
                      ...prev,
                      rsi: { ...prev.rsi, enabled: e.target.checked },
                    }))}
                    className="mt-0.5 shrink-0"
                    style={{ accentColor: FIVE_M_COLOR }}
                  />
                  <span className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <span className="text-[10px] font-medium text-p5 block">RSI &lt; {rsiBuy}</span>
                        <span className="text-[9px] text-p5/50 block mt-0.5">Sobrevenda no candle 5m.</span>
                      </span>
                      {entryPaths.rsi.enabled && (
                        <SuggestButton
                          onClick={e => { e.preventDefault(); loadRsiSuggest(); }}
                          loading={suggest?.loading}
                          disabled={rsiInvalid}
                          color="#26a69a"
                          title="Histórico RSI — sugere compra e venda para entradas por sobrevenda"
                        />
                      )}
                    </div>
                    {entryPaths.rsi.enabled && (
                      <div className="mt-2 space-y-2">
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider mb-1" style={{ color: '#26a69a' }}>
                            Compra — abaixo de
                          </label>
                          <input
                            type="number"
                            value={rsiBuy}
                            onChange={e => setRsiBuy(e.target.value)}
                            min={10} max={50}
                            className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono"
                            style={{ background: '#161a28', border: '1px solid #2a2d3a' }}
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
                          {ready && suggest.entry?.histStopWarning && !entryHintStale && (
                            <p className="text-[9px] text-amber-500/85 mt-1 leading-relaxed">
                              {suggest.entry.histStopWarning} — prefira stop fixo −5% ou suba o RSI de compra.
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider mb-1" style={{ color: '#ef5350' }}>
                            Venda — acima de
                          </label>
                          <input
                            type="number"
                            value={rsiSell}
                            onChange={e => setRsiSell(e.target.value)}
                            min={50} max={95}
                            className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono"
                            style={{ background: '#161a28', border: '1px solid #2a2d3a' }}
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
                        {needsRecalc && !suggest?.loading && (
                          <p className="text-[9px] text-amber-500/80">
                            Parâmetros alterados — clique <strong>Sugerir</strong> acima.
                          </p>
                        )}
                        {suggest?.error && (
                          <p className="text-[9px] text-amber-500/90">{suggest.error}</p>
                        )}
                      </div>
                    )}
                  </span>
                </label>

                <label
                  className="flex items-start gap-2 rounded px-2 py-2 cursor-pointer"
                  style={{ background: '#1e2130', border: `1px solid ${entryPaths.ma50_5m.enabled ? FIVE_M_COLOR : '#2a2d3a'}` }}
                >
                  <input
                    type="checkbox"
                    checked={entryPaths.ma50_5m.enabled}
                      onChange={e => {
                        const enabled = e.target.checked;
                        setEntryPaths(prev => ({
                          ...prev,
                          ma50_5m: {
                            enabled,
                            trigger: enabled && !prev.ma50_5m.enabled ? 'touch' : (prev.ma50_5m.trigger || 'touch'),
                            tolerancePct: prev.ma50_5m.tolerancePct ?? 0.5,
                          },
                        }));
                        if (enabled && !maFilters.enabled) {
                          setMaFilters(prev => ({
                            ...cloneMaFilters(prev),
                            enabled: true,
                          }));
                        }
                      }}
                    className="mt-0.5 shrink-0"
                    style={{ accentColor: FIVE_M_COLOR }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-[10px] font-medium text-p5 block">MA50 5m</span>
                    <span className="text-[9px] text-p5/50 block mt-0.5">
                      Pullback / toque da MA50 5m · venda = RSI &gt; {rsiSell} (campo acima).
                    </span>
                    {entryPaths.ma50_5m.enabled && (
                      <div className="mt-2 space-y-2">
                        <span className="text-[9px] uppercase tracking-wider text-p5/50 block">Gatilho</span>
                        {MA5M_TRIGGER_OPTIONS.map(opt => (
                          <label key={opt.id} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="ma5mTrigger"
                              checked={entryPaths.ma50_5m.trigger === opt.id}
                              onChange={() => setEntryPaths(prev => ({
                                ...prev,
                                ma50_5m: { ...prev.ma50_5m, trigger: opt.id },
                              }))}
                              className="mt-0.5"
                              style={{ accentColor: FIVE_M_COLOR }}
                            />
                            <span className="min-w-0">
                              <span className="text-[10px] text-p5 block">{opt.label}</span>
                              <span className="text-[9px] text-p5/45">{opt.summary}</span>
                            </span>
                          </label>
                        ))}
                        {entryPaths.ma50_5m.trigger === 'touch' && (
                          <label className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] text-p5/50 shrink-0">Tolerância toque</span>
                            <input
                              type="number"
                              min={0.1}
                              max={3}
                              step={0.1}
                              value={entryPaths.ma50_5m.tolerancePct ?? 0.5}
                              onChange={e => setEntryPaths(prev => ({
                                ...prev,
                                ma50_5m: {
                                  ...prev.ma50_5m,
                                  tolerancePct: Math.max(0.1, Math.min(3, Number(e.target.value) || 0.5)),
                                },
                              }))}
                              className="w-16 px-1.5 py-0.5 rounded text-[10px] font-mono bg-p2 border border-p3 text-p5"
                            />
                            <span className="text-[9px] text-p5/40">% · poll 1min quando ≤ {Math.max(2, (entryPaths.ma50_5m.tolerancePct ?? 0.5) * 4).toFixed(1)}%</span>
                          </label>
                        )}
                        <span className="text-[9px] uppercase tracking-wider text-p5/50 block mt-2">Preço de execução (MA)</span>
                        {MA_ENTRY_PRICE_OPTIONS.map(opt => (
                          <label key={opt.id} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="maEntryPriceMode"
                              checked={(entryPrice.maMode ?? 'market') === opt.id}
                              onChange={() => setEntryPrice(prev => ({
                                ...prev,
                                maMode: opt.id,
                                maBelowPct: opt.id === 'ma_limit' ? (prev.maBelowPct ?? 0) : 0,
                              }))}
                              className="mt-0.5"
                              style={{ accentColor: FIVE_M_COLOR }}
                            />
                            <span className="min-w-0">
                              <span className="text-[10px] text-p5 block">{opt.label}</span>
                              <span className="text-[9px] text-p5/45">{opt.summary}</span>
                              <Tooltip text={opt.tooltip} maxW={280}>
                                <span className="text-[8px] text-p5/35 underline decoration-dotted cursor-help mt-0.5 inline-block">
                                  detalhes
                                </span>
                              </Tooltip>
                            </span>
                          </label>
                        ))}
                        {entryPrice.maMode === 'ma_limit' && (
                          <label className="flex items-center gap-2 mt-1 pl-5">
                            <span className="text-[9px] text-p5/50 shrink-0">Opcional abaixo da MA</span>
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.1}
                              value={entryPrice.maBelowPct ?? 0}
                              onChange={e => setEntryPrice(prev => ({
                                ...prev,
                                maBelowPct: clampMaBelowPct(e.target.value),
                              }))}
                              className="w-14 px-1.5 py-0.5 rounded text-[10px] font-mono bg-p2 border border-p3 text-p5"
                            />
                            <span className="text-[9px] text-p5/40">% (0 = exatamente na MA)</span>
                          </label>
                        )}
                      </div>
                    )}
                  </span>
                </label>
              </div>

              {entryPaths.rsi.enabled && entryPaths.ma50_5m.enabled && (
                <div className="rounded px-2 py-2 space-y-2" style={{ background: '#161a28', border: '1px solid #2a2d3a' }}>
                  <span className="text-[9px] uppercase tracking-wider text-p5/50">Quando os dois ativos</span>
                  <div className="flex gap-2 mt-1">
                    {COMBINE_OPTIONS.map(opt => (
                      <label key={opt.id} className="flex items-center gap-1.5 cursor-pointer text-[9px] text-p5/70">
                        <input
                          type="radio"
                          name="entryPathsCombine"
                          checked={entryPaths.combine === opt.id}
                          onChange={() => setEntryPaths(prev => ({ ...prev, combine: opt.id }))}
                          style={{ accentColor: FIVE_M_COLOR }}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>

                  {entryPaths.combine === 'any' && (
                    <div className="pt-2 border-t space-y-2" style={{ borderColor: '#2a2d3a' }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-[9px] uppercase tracking-wider text-p5/50 block">
                            Período sem alternar caminho
                          </span>
                          <p className="text-[9px] text-p5/45 mt-0.5 leading-relaxed">
                            Se entrou por RSI, não tenta MA50 5m (e vice-versa) durante este tempo.
                          </p>
                        </div>
                        <SuggestButton
                          onClick={loadPathCooldownSuggest}
                          loading={pathCooldownSuggest?.loading}
                          disabled={rsiInvalid}
                          title="Mediana de intervalos entre sinais RSI e toques MA50 5m"
                        />
                      </div>

                      {pathCooldownSuggest?.error && (
                        <p className="text-[9px] text-amber-500/90">{pathCooldownSuggest.error}</p>
                      )}
                      {pathCooldownStale && !pathCooldownSuggest?.loading && (
                        <p className="text-[9px] text-amber-500/80">
                          RSI ou gatilho MA alterados — clique <strong>Sugerir</strong>.
                        </p>
                      )}

                      <PathCooldownSelector
                        report={pathCooldownSuggest}
                        source={entryPaths.pathCooldownSource}
                        onSelectSource={selectPathCooldownSource}
                        loading={pathCooldownSuggest?.loading}
                        stale={pathCooldownStale}
                      />

                      {!pathCooldownSuggest && !pathCooldownSuggest?.loading && (
                        <p className="text-[9px] text-p5/40">
                          Clique <strong>Sugerir</strong> para ver de quanto em quanto tempo RSI e MA batem no histórico.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {entryPathsMissing && (
                <p className="text-[9px] text-amber-500/90">Selecione ao menos um caminho de entrada.</p>
              )}
            </div>
          </AnalysisAccordion>

          <AnalysisAccordion
            id="entryPrice"
            openIds={openSections}
            onToggle={toggleSection}
            title="Preço de compra (RSI)"
            subtitle={
              entryPrice.mode === 'below'
                ? `RSI limit −${entryPrice.belowPct}% · ${entryPriceLabel(entryPrice).split(' · ')[1] ?? 'MA mercado'}`
                : `RSI mercado · ${entryPriceLabel(entryPrice).split(' · ')[1] ?? 'MA mercado'}`
            }
            accent={FIVE_M_COLOR}
          >
            <div className="pt-2 space-y-1.5">
              {ENTRY_PRICE_OPTIONS.map(opt => {
                const active = entryPrice.mode === opt.id;
                return (
                  <label
                    key={opt.id}
                    className="flex items-start gap-2 rounded px-2 py-2 cursor-pointer hover:opacity-90 transition-colors"
                    style={{
                      background: active ? '#06b6d414' : '#1e2130',
                      border: `1px solid ${active ? FIVE_M_COLOR : '#2a2d3a'}`,
                    }}
                  >
                    <input
                      type="radio"
                      name="entryPriceMode"
                      value={opt.id}
                      checked={active}
                      onChange={() => setEntryPrice(prev => ({
                        ...prev,
                        mode: opt.id,
                        belowPct: opt.id === 'below' ? (prev.belowPct || 0.5) : 0,
                      }))}
                      className="mt-0.5 shrink-0"
                      style={{ accentColor: FIVE_M_COLOR }}
                    />
                    <span className="min-w-0">
                      <span className="text-[10px] font-medium text-p5 block">{opt.label}</span>
                      <span className="text-[9px] text-p5/50 block mt-0.5 leading-relaxed">{opt.summary}</span>
                      <Tooltip text={opt.tooltip} maxW={280}>
                        <span className="text-[8px] text-p5/35 underline decoration-dotted cursor-help mt-0.5 inline-block">
                          detalhes
                        </span>
                      </Tooltip>
                    </span>
                  </label>
                );
              })}
              {entryPrice.mode === 'below' && (
                <div className="mt-1 rounded px-2 py-2 space-y-1.5" style={{ background: '#1e2130', border: '1px solid #2a2d3a' }}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[9px] text-p5/70">
                      <span>Limit</span>
                      <span className="text-p5/40">−</span>
                      <input
                        type="number"
                        value={entryPrice.belowPct}
                        onChange={e => {
                          const parsed = parseBelowPctInput(e.target.value);
                          if (parsed != null) {
                            setEntryPrice(prev => ({ ...prev, belowPct: parsed }));
                          }
                        }}
                        min={0.1}
                        max={10}
                        step={0.01}
                        className="w-16 rounded px-1 py-0.5 font-mono text-p5 outline-none"
                        style={{ background: '#161a28', border: '1px solid #2a2d3a' }}
                      />
                      <span>%</span>
                      <span className="text-p5/40">abaixo do mercado</span>
                    </label>
                    <SuggestButton
                      onClick={loadEntryBelowSuggest}
                      loading={entryBelowSuggest?.loading}
                      disabled={rsiInvalid}
                      color={FIVE_M_COLOR}
                      title={`Histórico de quedas após RSI<${rsiBuy} até recuperar`}
                    />
                  </div>
                  {entryBelowSuggest?.loading && (
                    <p className="text-[9px] text-p5/40 font-mono">Analisando dips RSI&lt;{rsiBuy}…</p>
                  )}
                  {entryBelowStale && !entryBelowSuggest?.loading && (
                    <p className="text-[9px] text-amber-500/85">
                      RSI alterado — clique <strong>Sugerir</strong> para recalcular.
                    </p>
                  )}
                  {entryBelowSuggest?.entryBelow?.ok && !entryBelowSuggest?.loading && (
                    <div className="rounded px-2 py-1.5" style={{ background: '#161a28', border: `1px solid ${FIVE_M_COLOR}33` }}>
                      <p className="text-[9px] font-mono leading-relaxed text-p5/70">
                        <span style={{ color: FIVE_M_COLOR }}>
                          Sugestão: −{entryBelowSuggest.entryBelow.suggestedBelowPct}%
                        </span>
                        {' · '}
                        {entryBelowSuggest.entryBelow.episodeCount} episódios RSI&lt;{rsiBuy}
                        {' · '}mediana −{entryBelowSuggest.entryBelow.medianDropPct}%
                        {entryBelowSuggest.entryBelow.limitPrice != null && (
                          <> · limit ~{entryBelowSuggest.entryBelow.limitPrice}</>
                        )}
                      </p>
                      <p className="text-[9px] text-p5/45 mt-0.5 leading-relaxed">
                        {entryBelowSuggest.entryBelow.description}
                      </p>
                      {Number(entryPrice.belowPct) !== Number(entryBelowSuggest.entryBelow.suggestedBelowPct) && (
                        <button
                          type="button"
                        onClick={() => setEntryPrice(prev => ({
                          ...prev,
                          belowPct: clampBelowPct(entryBelowSuggest.entryBelow.suggestedBelowPct),
                        }))}
                          className="mt-1 text-[9px] px-1.5 py-0.5 rounded font-medium"
                          style={{ background: `${FIVE_M_COLOR}22`, color: FIVE_M_COLOR, border: `1px solid ${FIVE_M_COLOR}55` }}
                        >
                          Usar −{entryBelowSuggest.entryBelow.suggestedBelowPct}%
                        </button>
                      )}
                    </div>
                  )}
                  {entryBelowSuggest?.entryBelow && !entryBelowSuggest.entryBelow.ok && !entryBelowSuggest?.loading && (
                    <p className="text-[9px] font-mono text-p5/50">
                      Sem histórico suficiente para RSI&lt;{rsiBuy} — ajuste % manualmente ou use mercado.
                    </p>
                  )}
                  {entryBelowSuggest?.error && (
                    <p className="text-[9px] text-amber-500/90">{entryBelowSuggest.error}</p>
                  )}
                </div>
              )}
            </div>
          </AnalysisAccordion>

          {/* Filtros MA */}
          <AnalysisAccordion
            id="ma"
            openIds={openSections}
            onToggle={toggleSection}
            title="Filtros MA"
            subtitle={maFilters.enabled ? (describeMaFiltersLocal(maFilters) || 'habilitado') : 'desabilitado'}
            accent={FIVE_M_COLOR}
          >
            <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={maFilters.enabled}
                  onChange={e => setMaFilters(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="accent-cyan-500"
                />
                <span className="text-[10px] uppercase tracking-wider text-p5/50">
                  Ativar filtro MA na entrada
                </span>
              </label>
              {maFilters.enabled && (
                <div className="flex gap-1 shrink-0">
                  <SuggestButton
                    onClick={loadMaAdaptation}
                    loading={maAdapt?.loading}
                    disabled={rsiInvalid}
                    color="#a78bfa"
                    title="Analisa dips históricos e sugere calibragem % abaixo da MA"
                  />
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
                    maAdapt && !maAdapt.loading && !maAdapt.error && !maAdaptStale
                      ? maSuggestForFilter(f.id)
                      : null
                  }
                  toleranceLoading={maAdapt?.loading}
                  toleranceStale={maAdaptStale}
                />
              ))}
              <p className="text-[9px] text-p5/40 leading-relaxed pt-0.5">
                Calibragem: admite compra até X% abaixo da MA. Clique em <strong className="text-p5/60">Sugerir</strong> para ver a sugestão — use <strong className="text-p5/60">Usar −X%</strong> para aplicar no input.
              </p>
              {maAdapt?.summary && !maAdapt?.loading && (
                <div
                  className="mt-2 rounded px-2 py-1.5 space-y-1"
                  style={{ background: '#161a28', border: '1px solid #a78bfa33' }}
                >
                  <p className="text-[9px] font-mono text-p5/60 leading-relaxed">
                    {maAdapt.summary}
                  </p>
                  {maAdapt.filters?.some(
                    s => s.recommendedTolerancePct !== s.currentTolerancePct,
                  ) && (
                    <button
                      type="button"
                      onClick={() => applyAllMaAdaptation(maAdapt.filters)}
                      className="text-[9px] px-2 py-0.5 rounded font-semibold"
                      style={{ background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa55' }}
                    >
                      Aplicar todas no input
                    </button>
                  )}
                </div>
              )}
              {maAdapt?.error && (
                <p className="text-[9px] text-amber-500/90 mt-1">{maAdapt.error}</p>
              )}
            </div>
            </div>
          </AnalysisAccordion>

          <AnalysisAccordion
            id="candles"
            openIds={openSections}
            onToggle={toggleSection}
            title="Padrão 1h — recuperação"
            subtitle={
              recoverySuggest?.loading ? 'calculando…'
                : recoverySuggestStale
                  ? 'desatualizado — clique Sugerir'
                : recoveryPattern.types.length
                  ? `${recoveryPatternTypesLabel(recoveryPattern.types)} · ${recoveryPatternZonesLabel(recoveryPattern.zones, recoveryPattern.abovePct)}`
                  : recoverySuggest?.recoveryAnalysis?.summary ?? 'opcional — nenhum padrão selecionado'
            }
            accent={recoveryPattern.types.length ? '#26a69a' : undefined}
            action={(
              <SuggestButton
                onClick={loadRecoverySuggest}
                loading={recoverySuggest?.loading}
                disabled={rsiInvalid}
                color="#26a69a"
                title="Analisa padrões 1h, zonas MA e stops no histórico"
              />
            )}
          >
            <div className="pt-2">
              {recoverySuggestStale && !recoverySuggest?.loading && (
                <p className="text-[9px] text-amber-500/85 mb-2">
                  Parâmetros alterados — clique <strong>Sugerir</strong> para atualizar.
                </p>
              )}
              {recoverySuggest?.error && (
                <p className="text-[9px] text-amber-500/90 mb-2">{recoverySuggest.error}</p>
              )}
              <RecoveryPatternSelector
                analysis={recoverySuggest?.recoveryAnalysis}
                live={recoverySuggest?.candlePatterns}
                maZone={recoverySuggest?.maZone}
                loading={recoverySuggest?.loading}
                rsiBuy={Number(rsiBuy)}
                patternTypes={recoveryPattern.types}
                zones={recoveryPattern.zones}
                abovePct={recoveryPattern.abovePct}
                onPatternsChange={types => setRecoveryPattern(prev => ({ ...prev, types }))}
                onZonesChange={zones => setRecoveryPattern(prev => ({ ...prev, zones }))}
                onAbovePctChange={abovePct => setRecoveryPattern(prev => ({ ...prev, abovePct }))}
              />
            </div>
          </AnalysisAccordion>

          {(recoveryZonesMissing || entryPathsMissing || stopLossInvalid) && !recoverySuggest?.loading && !stopSuggest?.loading && (
            <p className="text-[10px]" style={{ color: '#f59e0b' }}>
              {recoveryZonesMissing
                ? 'Selecione ao menos uma zona MA para os padrões 1h.'
                : entryPathsMissing
                  ? 'Selecione ao menos um caminho de entrada (RSI ou MA50 5m).'
                  : 'Stop selecionado indisponível — clique Sugerir ou escolha fixo −5%.'}
            </p>
          )}

          <AnalysisAccordion
            id="stop"
            openIds={openSections}
            onToggle={toggleSection}
            title="Stop loss"
            subtitle={
              stopSuggest?.loading ? 'calculando…'
                : stopSuggestStale
                  ? 'desatualizado — clique Sugerir'
                : stopLossTypes.length
                  ? stopLossTypesLabel(stopLossTypes, rsiBuy)
                  : 'opcional — nenhum stop selecionado'
            }
            accent={stopLossTypes.length && !stopLossInvalid ? '#f87171' : undefined}
          >
            <div className="pt-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[9px] text-p5/45 leading-relaxed flex-1">
                  Opcional — escolha uma ou mais regras; o bot vende se qualquer stop for atingido.
                </p>
                <SuggestButton
                  onClick={loadRecoverySuggest}
                  loading={stopSuggest?.loading}
                  disabled={rsiInvalid}
                  color="#f87171"
                  title="Recalcula stops fixos, histórico RSI e MA"
                />
              </div>
              <FiveMStopLossSelector
                stop={stopSuggest}
                loading={stopSuggest?.loading}
                rsiBuy={Number(rsiBuy)}
                value={stopLossTypes}
                onChange={setStopLossTypes}
                stale={stopSuggestStale}
              />
              {stopSuggest?.error && (
                <p className="text-[9px] text-amber-500/90 mt-1">{stopSuggest.error}</p>
              )}
            </div>
          </AnalysisAccordion>

          {rsiInvalid && (
            <p className="text-[10px]" style={{ color: '#ef5350' }}>
              RSI compra deve ser menor que RSI venda.
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={runLiveTest}
              disabled={liveTest?.loading || rsiInvalid}
              className="flex-1 py-1 text-[11px] rounded font-bold transition-opacity disabled:opacity-40"
              style={{ background: '#2a2d3a', color: '#e2e8f0', border: `1px solid ${FIVE_M_COLOR}66` }}
              title="Testa com candles recentes da exchange e os parâmetros acima"
            >
              {liveTest?.loading ? '…' : '⚡ Testar agora'}
            </button>
          </div>

          {liveTest && (
            <AnalysisAccordion
              id="live"
              openIds={openSections}
              onToggle={toggleSection}
              title="Teste ao Vivo"
              subtitle={liveTest.loading ? 'Consultando…' : (liveTest.actionLabel ?? liveTest.error ?? '')}
              accent={liveTest.allowed ? '#26a69a' : '#94a3b8'}
            >
              <div className="pt-1">
                <LiveTestPanel data={liveTest} />
              </div>
            </AnalysisAccordion>
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
                openIds={openSections}
                onToggle={toggleSection}
                title="Padrão de alta %"
                subtitle={swingSubtitle()}
                accent="#26a69a"
              >
                <PatternDetail data={suggest.swingPattern} />
              </AnalysisAccordion>

              <AnalysisAccordion
                id="bot"
                openIds={openSections}
                onToggle={toggleSection}
                title="Simulação bot (DCA 2h)"
                subtitle={botSubtitle()}
                accent="#f59e0b"
              >
                <PatternDetail data={suggest.botSimulation} />
              </AnalysisAccordion>

              <AnalysisAccordion
                id="episodes"
                openIds={openSections}
                onToggle={toggleSection}
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
                  openIds={openSections}
                  onToggle={toggleSection}
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

        <div className="flex gap-2 px-4 py-2 border-t shrink-0" style={{ borderColor: '#2a2d3a' }}>
          {isActive && (
            <button
              onClick={onRemove}
              disabled={inPosition}
              title={inPosition ? 'Aguarde venda para remover' : 'Remover dos favoritos 5m Trade'}
              className="flex-1 py-1 text-[11px] rounded font-medium transition-colors disabled:opacity-40"
              style={{ border: '1px solid #ef5350', color: '#ef5350' }}
            >
              Remover
            </button>
          )}
          {!isActive && (
            <button
              onClick={onCancel}
              className="flex-1 py-1 text-[11px] rounded font-medium transition-colors text-p5/50 hover:text-p5"
              style={{ border: '1px solid #2a2d3a' }}
            >
              Cancelar
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!Number(capital) || Number(capital) <= 0 || rsiInvalid || !formReady}
            className="flex-1 py-1 text-[11px] rounded font-semibold transition-opacity disabled:opacity-40"
            style={{ background: FIVE_M_COLOR, color: '#000' }}
            title={!formReady ? 'Corrija caminhos de entrada, zonas MA ou stop inválido' : undefined}
          >
            {isActive ? 'Atualizar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
}
