import { useState } from 'react';
import { suggestMaCrossFilterBounds } from '../services/api';
import {
  MA_CROSS_INTERVALS, MA_PERIOD_PRESETS, MA_CROSS_PERIOD_MIN, MA_CROSS_PERIOD_MAX,
  CROSS_DIRECTIONS, PRICE_FILTER_MODES,
  EXIT_LOGIC_OPTIONS, RSI_INTERVALS, RSI_PERIODS, RSI_OPERATORS,
  VOLUME_OPTIONS, PENDING_TIMEOUT_OPTIONS, POLL_OPTIONS,
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

export default function MaCrossStrategyForm({ form, patch, symbol, exchange }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [boundsSuggest, setBoundsSuggest] = useState({});
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' };

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
        <NumInput value={form.entry.maxAboveMaPct ?? 3}
          onChange={v => patch('entry.maxAboveMaPct', v)}
          min={0} max={20} step={0.5} className="w-14" />
        <span className="text-p5/40 text-[10px]">0 = desligado</span>
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

      <button type="button" onClick={() => setAdvancedOpen(v => !v)}
        className="text-[10px] text-p5/50 w-full text-left hover:text-p5/70">
        {advancedOpen ? '▼' : '▶'} Execução, polling, volume, adaptativo
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
          <div className="text-xs space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-p5/50">Volume mín. 24h</span>
              <select value={form.volume.minVolumeUsdt}
                onChange={e => patch('volume.minVolumeUsdt', Number(e.target.value))}
                className="rounded px-1 py-1 flex-1" style={sel}>
                {VOLUME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-p5">
              <input type="checkbox" checked={form.volume.allowLowVolume}
                onChange={e => patch('volume.allowLowVolume', e.target.checked)} />
              Permitir volume baixo
            </label>
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

      <p className="text-[9px] text-p5/40">
        Períodos livres (2–500). Bot: <code>node backend/bot/ma-cross/ma-cross-bot.js</code>
      </p>
    </div>
  );
}
