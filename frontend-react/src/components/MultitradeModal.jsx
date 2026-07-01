import { useState, useCallback, useEffect } from 'react';
import { checkMultitradeVolume, suggestMultitradeDiscount, suggestMultitradeAdaptive, suggestMultitradeExitRsi, suggestMultitradeEntryRsi, suggestMultitradeEntryMa } from '../services/api';
import {
  RSI_INTERVALS, MA_INTERVALS, MA_PERIODS, RSI_PERIODS, MA_MODES,
  RSI_OPERATORS, ENTRY_MA_TRIGGERS,
  ENTRY_DISCOUNT_OPTIONS, VOLUME_OPTIONS, PENDING_TIMEOUT_OPTIONS, POLL_OPTIONS,
  formStateFromEntry, formStateToPayload,
} from '../constants/tradeConfigSchema';
import {
  STRATEGY_IDS, STRATEGY_LABELS, STRATEGY_COLORS,
  buildDualStrategyState, isSwingStrategy, isMaCrossStrategy,
} from '../constants/strategyPresets';
import { swingFormToPayload } from '../constants/swingConfigSchema';
import { maCrossFormToPayload } from '../constants/maCrossConfigSchema';
import { MT_HELP } from '../constants/multitradeHelp';
import { FieldLabel, FieldHint } from './MultitradeFieldHint';
import SwingStrategyForm from './SwingStrategyForm';
import MaCrossStrategyForm from './MaCrossStrategyForm';

const MT_COLOR      = '#8b5cf6';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';
const ENTRY_COLOR   = '#26a69a';
const EXIT_COLOR    = '#ef5350';

function getBacktestCmd({ symbol, exchange, capital }) {
  return `node backend/bot/amap/amap-bot.js --backtest ${symbol} ${exchange} ${capital}`;
}

function getAdaptiveTestCmd({ symbol, exchange, maConditions }) {
  const intervals = [...new Set(
    (maConditions ?? []).filter(m => m.mode === 'adaptive' || m.adaptive).map(m => m.interval),
  )];
  const ivs = intervals.length ? intervals.join(' ') : '1h 4h';
  return `node backend/bot/amap/amap-bot.js --adaptive-test ${symbol} ${exchange} ${ivs}`;
}

function getExtensionTestCmd({ symbol, exchange, extension }) {
  const t3 = extension?.threeInterval ?? extension?.confirmInterval ?? '1h';
  const t4 = extension?.fourInterval ?? extension?.confirmInterval ?? '1h';
  const ivs = t3 === t4 ? t3 : `${t3} ${t4}`;
  return `node backend/bot/amap/amap-bot.js --extension-test ${symbol} ${exchange} ${ivs}`;
}

function hasAdaptiveMa(maConditions) {
  return (maConditions ?? []).some(m => m.mode === 'adaptive' || m.adaptive);
}

export { getBacktestCmd, getAdaptiveTestCmd, getExtensionTestCmd, hasAdaptiveMa };

function SectionHeader({ label, color = '#94a3b8', hint }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color }}>{label}</span>
        <div className="flex-1 h-px bg-p2" />
      </div>
      {hint && <FieldHint className="mt-1">{hint}</FieldHint>}
    </div>
  );
}

function RuleGroup({ title, subtitle, color, children }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${color}44` }}>
      <div className="px-3 py-2" style={{ background: `${color}14`, borderBottom: `1px solid ${color}33` }}>
        <span className="text-[11px] uppercase tracking-wider font-bold block" style={{ color }}>{title}</span>
        {subtitle && <span className="text-[9px] text-p5/45 block mt-0.5">{subtitle}</span>}
      </div>
      <div className="px-3 py-3 space-y-4" style={{ background: '#0f1219' }}>{children}</div>
    </div>
  );
}

function NumInput({ value, onChange, min, max, step = 1, className = 'w-16', ...rest }) {
  const safe = value ?? '';
  return (
    <input type="number" value={safe} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className={`rounded px-2 py-1 text-xs text-p5 outline-none font-mono ${className}`}
      style={{ background: '#1e2130', border: '1px solid #2a2d3a' }} {...rest} />
  );
}

function EntryPathCard({ active, onToggle, title, subtitle, color, children }) {
  return (
    <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${active ? color + '66' : '#2a2d3a'}` }}>
      <label className="flex items-start gap-2 px-2.5 py-2 cursor-pointer" style={{ background: active ? `${color}12` : '#1a1d28' }}>
        <input type="checkbox" checked={active} onChange={e => onToggle(e.target.checked)}
          className="mt-0.5 shrink-0" style={{ accentColor: color }} />
        <div className="min-w-0">
          <span className="text-[10px] font-bold block" style={{ color: active ? color : '#94a3b8' }}>{title}</span>
          {subtitle && <span className="text-[9px] text-p5/40 block mt-0.5">{subtitle}</span>}
        </div>
      </label>
      {active && children && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-1.5" style={{ background: '#131722' }}>{children}</div>
      )}
    </div>
  );
}

function RsiRuleFields({ rsi, onPatch, sel, compact }) {
  const cls = compact ? 'text-[10px] py-1' : 'text-xs py-1.5';
  return (
    <div className="grid grid-cols-4 gap-1">
      <select value={rsi.interval} onChange={e => onPatch('interval', e.target.value)}
        className={`rounded px-1 ${cls} text-p5 outline-none cursor-pointer col-span-1`} style={sel}>
        {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
      </select>
      <select value={rsi.period} onChange={e => onPatch('period', Number(e.target.value))}
        className={`rounded px-1 ${cls} text-p5 outline-none font-mono`} style={sel}>
        {RSI_PERIODS.map(p => <option key={p} value={p}>p{p}</option>)}
      </select>
      <select value={rsi.operator ?? '<'} onChange={e => onPatch('operator', e.target.value)}
        className={`rounded px-1 ${cls} text-p5 outline-none font-mono text-center`} style={sel}>
        {RSI_OPERATORS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <NumInput value={rsi.value} onChange={v => onPatch('value', v)} min={1} max={99} className="w-full" />
    </div>
  );
}

export default function MultitradeModal({
  symbol: initialSymbol,
  defaultExchange,
  currentEntries,
  currentEntry,
  onConfirm,
  onRemove,
  onCancel,
}) {
  const entries = currentEntries ?? (currentEntry ? [currentEntry] : []);
  const isEditing = entries.length > 0;
  const newId = useCallback(() => Date.now() + Math.random(), []);
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a' };

  const [dual, setDual] = useState(() => buildDualStrategyState(entries, {
    symbol: initialSymbol ?? entries[0]?.symbol ?? '',
    exchange: defaultExchange ?? entries[0]?.exchange ?? 'binance',
  }));
  const [activeStrategy, setActiveStrategy] = useState('amap-15m');
  const [activeTab, setActiveTab] = useState('rule1');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [volCheck, setVolCheck] = useState(null);
  const [volumeWarnOpen, setVolumeWarnOpen] = useState(false);
  const [discountSuggest, setDiscountSuggest] = useState(null);
  const [adaptiveSuggest, setAdaptiveSuggest] = useState({});
  const [exitRsiSuggest, setExitRsiSuggest] = useState(null);
  const [exitRsi2Suggest, setExitRsi2Suggest] = useState(null);
  const [entryRsiSuggest, setEntryRsiSuggest] = useState(null);
  const [entryMaSuggest, setEntryMaSuggest] = useState(null);
  const [copied, setCopied] = useState(null);
  const [entryPathError, setEntryPathError] = useState(null);

  const symbol = dual.symbol;
  const exchange = dual.exchange;
  const strat = dual.strategies[activeStrategy];
  const form = strat.form;
  const capital = strat.capital;
  const strategyEnabled = strat.enabled;

  const setSymbol = useCallback(v => setDual(prev => ({ ...prev, symbol: v })), []);
  const setExchange = useCallback(v => setDual(prev => ({ ...prev, exchange: v })), []);
  const setCapital = useCallback(v => {
    setDual(prev => ({
      ...prev,
      strategies: {
        ...prev.strategies,
        [activeStrategy]: { ...prev.strategies[activeStrategy], capital: v },
      },
    }));
  }, [activeStrategy]);

  const patchStrategy = useCallback((sid, updater) => {
    setDual(prev => ({
      ...prev,
      strategies: {
        ...prev.strategies,
        [sid]: typeof updater === 'function' ? updater(prev.strategies[sid]) : updater,
      },
    }));
  }, []);

  const setStrategyEnabled = useCallback((sid, enabled) => {
    patchStrategy(sid, st => ({ ...st, enabled }));
    setEntryPathError(null);
  }, [patchStrategy]);

  const isSwing = isSwingStrategy(activeStrategy);
  const isMaCross = isMaCrossStrategy(activeStrategy);
  const rule1On = !isSwing && !isMaCross && form.rule1?.enabled !== false;
  const rule2On = !isSwing && !isMaCross && form.rule2?.enabled === true;

  const entrySummary = rule1On
    ? `RSI(${form.rule1.entryRsi.interval}) ${form.rule1.entryRsi.operator ?? '<'} ${form.rule1.entryRsi.value}`
    : '';
  const rule2Summary = rule2On
    ? `MA${form.rule2.entryMa.period} ${form.rule2.entryMa.interval} · ${form.rule2.entryMa.aboveMaCandles ?? 10} candles acima · ${ENTRY_MA_TRIGGERS.find(t => t.id === form.rule2.entryMa.trigger)?.label ?? 'toque'}`
    : '';

  const rule2TabLabel = rule2On
    ? `Regra 2 — MA${form.rule2.entryMa.period} ${form.rule2.entryMa.interval}`
    : 'Regra 2 — MA';

  function patchExitRsiCondition(id, field, value) {
    patchStrategy(activeStrategy, st => ({
      ...st,
      form: {
        ...st.form,
        rule2: {
          ...st.form.rule2,
          exitRsiConditions: (st.form.rule2.exitRsiConditions ?? []).map(c =>
            c.id === id ? { ...c, [field]: value } : c),
        },
      },
    }));
  }

  const patch = useCallback((path, value) => {
    setDual(prev => {
      const sid = activeStrategy;
      const st = prev.strategies[sid];
      const nextForm = { ...st.form };
      const keys = path.split('.');
      let obj = nextForm;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return {
        ...prev,
        strategies: {
          ...prev.strategies,
          [sid]: { ...st, form: nextForm },
        },
      };
    });
  }, [activeStrategy]);

  function addMa() {
    patchStrategy(activeStrategy, st => ({
      ...st,
      form: {
        ...st.form,
        rule1: {
          ...st.form.rule1,
          maConditions: [...st.form.rule1.maConditions, {
            id: newId(), period: 50, interval: '1h', mode: 'strict_above', fixedDipPct: '',
            aboveMaEnabled: false, aboveMaCandles: 10,
          }],
        },
      },
    }));
  }
  function removeMa(id) {
    patchStrategy(activeStrategy, st => ({
      ...st,
      form: {
        ...st.form,
        rule1: { ...st.form.rule1, maConditions: st.form.rule1.maConditions.filter(m => m.id !== id) },
      },
    }));
  }
  function updateMa(id, field, value) {
    patchStrategy(activeStrategy, st => ({
      ...st,
      form: {
        ...st.form,
        rule1: {
          ...st.form.rule1,
          maConditions: st.form.rule1.maConditions.map(m => m.id === id ? { ...m, [field]: value } : m),
        },
      },
    }));
    if (field === 'period' || field === 'interval' || field === 'mode') {
      setAdaptiveSuggest(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
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

  useEffect(() => { setVolumeWarnOpen(false); }, [symbol, exchange, form.volume?.minVolumeUsdt]);
  useEffect(() => { if (volCheck?.meetsMin) patch('volume.allowLowVolume', false); }, [volCheck?.meetsMin, patch]);

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  }

  function buildStrategyPayload(st, sid, { sym, enabled, allowLow }) {
    const volAllow = allowLow ?? st.form.volume?.allowLowVolume;
    const meta = {
      symbol: sym,
      exchange,
      capital: Number(st.capital),
      strategyId: sid,
      strategy_id: sid,
      enabled,
      label: STRATEGY_LABELS[sid],
    };
    if (isSwingStrategy(sid)) {
      const payload = swingFormToPayload(st.form, meta);
      payload.volume = { ...st.form.volume, allowLowVolume: volAllow };
      return payload;
    }
    if (isMaCrossStrategy(sid)) {
      const payload = maCrossFormToPayload(st.form, meta);
      payload.volume = { ...st.form.volume, allowLowVolume: volAllow };
      return payload;
    }
    const payload = formStateToPayload(st.form, {
      ...meta,
      label: `AMAP ${STRATEGY_LABELS[sid]}`,
    });
    payload.allowLowVolume = volAllow;
    payload.volume = { ...st.form.volume, allowLowVolume: volAllow };
    return payload;
  }

  function buildPayload(allowLow = form.volume?.allowLowVolume) {
    const sym = symbol.trim().toUpperCase();
    return buildStrategyPayload(
      { form, capital },
      activeStrategy,
      { sym, enabled: strategyEnabled, allowLow },
    );
  }

  function buildAllSaves(allowLow) {
    const sym = symbol.trim().toUpperCase();
    const saves = [];
    for (const sid of STRATEGY_IDS) {
      const st = dual.strategies[sid];
      if (st.enabled) {
        saves.push({
          id: st.id,
          payload: buildStrategyPayload(st, sid, { sym, enabled: true, allowLow }),
        });
      } else if (st.id) {
        saves.push({
          id: st.id,
          payload: buildStrategyPayload(st, sid, { sym, enabled: false, allowLow: st.form.volume?.allowLowVolume }),
        });
      }
    }
    return saves;
  }

  useEffect(() => {
    if (isSwing) return;
    setDiscountSuggest(null);
  }, [isSwing, symbol, exchange, form.rule1?.entryRsi, form.rule1?.exitRsi, form.rule1?.execution?.pendingTimeoutMs]);

  async function handleSuggestDiscount() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setDiscountSuggest({ loading: true });
    try {
      const r = await suggestMultitradeDiscount({
        symbol: sym,
        exchange,
        entryRsi: form.rule1.entryRsi,
        exitRsi: form.rule1.exitRsi,
        execution: form.rule1.execution,
      });
      setDiscountSuggest(r);
      if (r.entryDiscount != null) patch('rule1.execution.entryDiscount', r.entryDiscount);
    } catch (err) {
      setDiscountSuggest({ error: err.message });
    }
  }

  useEffect(() => {
    if (isSwing) return;
    setExitRsiSuggest(null);
  }, [isSwing, symbol, exchange, form.rule1?.entryRsi, form.rule1?.exitRsi, form.rule1?.maConditions, form.rule1?.extension, form.rule1?.stopLoss]);

  useEffect(() => { setExitRsi2Suggest(null); }, [symbol, exchange, form.rule2.entryMa, form.rule2.exitRsi, form.rule2.stopLoss]);

  useEffect(() => {
    if (isSwing) { setEntryRsiSuggest(null); return; }
    setEntryRsiSuggest(null);
  }, [isSwing, symbol, exchange, form.entryRsi, form.rule1?.entryRsi, form.rule1?.enabled, form.rule1?.maConditions, form.rule1?.extension, form.rule1?.stopLoss]);

  useEffect(() => { setEntryMaSuggest(null); }, [symbol, exchange, form.rule2.entryMa, form.rule2.exitRsi, form.rule2.stopLoss]);

  async function handleSuggestEntryRsi() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !rule1On) return;
    setEntryRsiSuggest({ loading: true });
    try {
      const r = await suggestMultitradeEntryRsi({
        symbol: sym,
        exchange,
        entryRsi: form.rule1.entryRsi,
        exitRsi: form.rule1.exitRsi,
        entryRsiPath: { enabled: form.rule1.enabled },
        entryMa: form.rule2.entryMa,
        maConditions: form.rule1.maConditions,
        extension: form.rule1.extension,
        stopLoss: form.rule1.stopLoss,
      });
      setEntryRsiSuggest(r);
      if (r.entryRsiValue != null) patch('rule1.entryRsi.value', r.entryRsiValue);
    } catch (err) {
      setEntryRsiSuggest({ error: err.message });
    }
  }

  async function handleSuggestEntryMa() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !rule2On) return;
    setEntryMaSuggest({ loading: true });
    try {
      const r = await suggestMultitradeEntryMa({
        symbol: sym,
        exchange,
        entryMa: form.rule2.entryMa,
        exitRsi: form.rule2.exitRsi,
        stopLoss: form.rule2.stopLoss,
      });
      setEntryMaSuggest(r);
      if (r.trigger) patch('rule2.entryMa.trigger', r.trigger);
      if (r.tolerancePct != null) patch('rule2.entryMa.tolerancePct', r.tolerancePct);
      if (r.maRsiValue != null) patch('rule2.entryMa.entryRsi.value', r.maRsiValue);
    } catch (err) {
      setEntryMaSuggest({ error: err.message });
    }
  }

  async function handleSuggestExitRsi() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setExitRsiSuggest({ loading: true });
    try {
      const r = await suggestMultitradeExitRsi({
        symbol: sym,
        exchange,
        entryRsi: form.rule1.entryRsi,
        exitRsi: form.rule1.exitRsi,
        entryRsiPath: { enabled: form.rule1.enabled },
        maConditions: form.rule1.maConditions,
        extension: form.rule1.extension,
        stopLoss: form.rule1.stopLoss,
      });
      setExitRsiSuggest(r);
      if (r.suggestedExitRsi != null) patch('rule1.exitRsi.value', r.suggestedExitRsi);
    } catch (err) {
      setExitRsiSuggest({ error: err.message });
    }
  }

  async function handleSuggestExitRsi2() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !rule2On) return;
    const cond1 = form.rule2.exitRsiConditions?.[0] ?? form.rule2.exitRsi;
    setExitRsi2Suggest({ loading: true });
    try {
      const em = form.rule2.entryMa;
      const r = await suggestMultitradeExitRsi({
        symbol: sym,
        exchange,
        entryRsi: { interval: em.interval, period: 14, operator: '<', value: 30 },
        exitRsi: cond1,
        entryRsiPath: { enabled: false },
        entryMa: { ...em, enabled: true },
        stopLoss: { enabled: false },
        entryPath: 'ma',
      });
      setExitRsi2Suggest(r);
      if (r.suggestedExitRsi != null && cond1?.id != null) {
        patchExitRsiCondition(cond1.id, 'value', r.suggestedExitRsi);
      }
    } catch (err) {
      setExitRsi2Suggest({ error: err.message });
    }
  }

  async function handleSuggestSwingEntryRsi() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !isSwing) return;
    setEntryRsiSuggest({ loading: true });
    try {
      const r = await suggestMultitradeEntryRsi({
        symbol: sym,
        exchange,
        strategyId: activeStrategy,
        entryRsi: form.entryRsi,
        exitRsi: form.exitRsi,
        entryMaFilter: form.entryMaFilter,
        kind: form.kind,
      });
      setEntryRsiSuggest(r);
      if (r.entryRsiValue != null) patch('entryRsi.value', r.entryRsiValue);
    } catch (err) {
      setEntryRsiSuggest({ error: err.message });
    }
  }

  async function handleSuggestSwingExitRsi() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !isSwing) return;
    setExitRsiSuggest({ loading: true });
    try {
      const r = await suggestMultitradeExitRsi({
        symbol: sym,
        exchange,
        strategyId: activeStrategy,
        entryRsi: form.entryRsi,
        exitRsi: form.exitRsi,
        entryMaFilter: form.entryMaFilter,
        entryMa: form.entryMa,
        kind: form.kind,
        entryPath: form.kind === 'ma' ? 'ma' : 'rsi',
      });
      setExitRsiSuggest(r);
      if (r.exitRsiValue != null) patch('exitRsi.value', r.exitRsiValue);
      else if (r.suggestedExitRsi != null) patch('exitRsi.value', r.suggestedExitRsi);
    } catch (err) {
      setExitRsiSuggest({ error: err.message });
    }
  }

  function renderExitRsiSuggest(suggest) {
    if (!suggest || suggest.loading) return null;
    return (
      <p className="text-[9px] font-mono mb-1 leading-relaxed" style={{ color: suggest.error ? '#f59e0b' : '#94a3b8' }}>
        {suggest.error
          ? suggest.error
          : suggest.usedDefault
            ? `Poucos trades (${suggest.tradeCount ?? 0}) — padrão ${suggest.suggestedExitRsi}`
            : `${suggest.tradeCount} trades · pico mediano ${suggest.medianPeakRsi} (média ${suggest.avgPeakRsi}) · atinge 70: ${suggest.hitRate70}% · 75: ${suggest.hitRate75}% · 80: ${suggest.hitRate80}% → sugerido ${suggest.suggestedExitRsi}${suggest.recommendation === 'chega_alto' ? ' (costuma subir alto)' : suggest.recommendation === 'garantir_cedo' ? ' (garantir mais cedo)' : ''}`}
      </p>
    );
  }

  async function handleSuggestAdaptive(maId) {
    const ma = form.rule1.maConditions.find(m => m.id === maId);
    const sym = symbol.trim().toUpperCase();
    if (!sym || !ma || ma.mode !== 'adaptive') return;
    setAdaptiveSuggest(prev => ({ ...prev, [maId]: { loading: true } }));
    try {
      const r = await suggestMultitradeAdaptive({
        symbol: sym,
        exchange,
        period: ma.period,
        interval: ma.interval,
        adaptiveOpts: form.rule1.adaptiveOpts,
      });
      setAdaptiveSuggest(prev => ({ ...prev, [maId]: r }));
      if (r.suggestedDipPct != null) updateMa(maId, 'fixedDipPct', r.suggestedDipPct);
    } catch (err) {
      setAdaptiveSuggest(prev => ({ ...prev, [maId]: { error: err.message } }));
    }
  }

  function handleConfirm() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const anyEnabled = STRATEGY_IDS.some(sid => dual.strategies[sid].enabled);
    if (!anyEnabled) {
      setEntryPathError('Ative pelo menos uma estratégia.');
      return;
    }
    for (const sid of STRATEGY_IDS) {
      const st = dual.strategies[sid];
      if (st.enabled && Number(st.capital) <= 0) {
        setEntryPathError(`Capital inválido na estratégia ${STRATEGY_LABELS[sid]}.`);
        setActiveStrategy(sid);
        return;
      }
      if (st.enabled && !isSwingStrategy(sid) && !isMaCrossStrategy(sid)) {
        const r1 = st.form.rule1?.enabled !== false;
        const r2 = st.form.rule2?.enabled === true;
        if (!r1 && !r2) {
          setEntryPathError(`Ative regra 1 ou 2 em ${STRATEGY_LABELS[sid]}.`);
          setActiveStrategy(sid);
          return;
        }
      }
    }
    setEntryPathError(null);
    if (volCheck && !volCheck.loading && volCheck.meetsMin === false && !volumeWarnOpen) {
      setVolumeWarnOpen(true);
      return;
    }
    setVolumeWarnOpen(false);
    onConfirm({ symbol: sym, exchange, saves: buildAllSaves() });
  }

  function handleConfirmDespiteVolume() {
    setVolumeWarnOpen(false);
    onConfirm({ symbol: symbol.trim().toUpperCase(), exchange, saves: buildAllSaves(true) });
  }

  const payload = buildPayload();
  const cmd      = isSwing
    ? `node backend/bot/swing/swing-bot.js --symbol ${symbol.trim().toUpperCase()}`
    : isMaCross
      ? `node backend/bot/ma-cross/ma-cross-bot.js --symbol ${symbol.trim().toUpperCase()}`
      : getBacktestCmd(payload);
  const adaptCmd = getAdaptiveTestCmd(payload);
  const showAdaptive = !isSwing && !isMaCross && form.rule1?.maFiltersEnabled !== false && hasAdaptiveMa(form.rule1?.maConditions);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-4"
      style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onCancel}>
      <div className="w-full max-w-[26rem] rounded-lg shadow-2xl border mx-4 my-auto"
        style={{ background: '#131722', borderColor: '#2a2d3a' }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2a2d3a' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-p5">AMAP Multi-Trade</span>
            {symbol && <span className="text-xs font-mono font-bold" style={{ color: MT_COLOR }}>{symbol.toUpperCase()}</span>}
          </div>
          <button onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none">×</button>
        </div>

        <div className="px-4 py-4 space-y-4 max-h-[80vh] overflow-y-auto">

          <div>
            <SectionHeader label="Configuração geral" />
            <div className="space-y-3">
              <div>
                <FieldLabel label="Símbolo" hint={MT_HELP.shared.symbol} className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5" />
                <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
                  className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono uppercase" style={sel} placeholder="BTCUSDT"
                  title={MT_HELP.shared.symbol} />
              </div>

              <div>
                <FieldLabel label="Corretora" hint={MT_HELP.shared.exchange} className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5" />
                <div className="flex gap-2">
                  {[{ id: 'gate', label: 'Gate.io', color: GATE_COLOR }, { id: 'binance', label: 'Binance', color: BINANCE_COLOR }].map(ex => (
                    <button key={ex.id} onClick={() => setExchange(ex.id)}
                      className="flex-1 py-1.5 text-xs rounded font-semibold"
                      style={{
                        background: exchange === ex.id ? ex.color : 'transparent',
                        color: exchange === ex.id ? (ex.id === 'binance' ? '#000' : '#fff') : ex.color,
                        border: `1px solid ${ex.color}`, opacity: exchange === ex.id ? 1 : 0.55,
                      }}>{ex.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionHeader label="Estratégias" color={MT_COLOR} hint="AMAP (15m/1h) e Swing (RSI 1h / MA50 8h). Cada aba tem capital e estado independentes no bot." />
            <div className="flex gap-1 p-1 rounded-lg mb-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
              {STRATEGY_IDS.map(sid => {
                const st = dual.strategies[sid];
                const color = STRATEGY_COLORS[sid];
                const stratHint = sid === 'amap-15m' ? MT_HELP.shared.strategy15m : MT_HELP.shared.strategy1h;
                return (
                  <button key={sid} type="button" onClick={() => {
                    setActiveStrategy(sid);
                    setDiscountSuggest(null);
                    setExitRsiSuggest(null);
                    setExitRsi2Suggest(null);
                    setEntryRsiSuggest(null);
                    setEntryMaSuggest(null);
                  }}
                    className="flex-1 py-1.5 text-[10px] font-bold rounded transition-colors relative"
                    title={stratHint}
                    style={{
                      background: activeStrategy === sid ? `${color}22` : 'transparent',
                      color: activeStrategy === sid ? color : '#94a3b8',
                      border: `1px solid ${activeStrategy === sid ? color + '55' : 'transparent'}`,
                      opacity: st.enabled ? 1 : 0.55,
                    }}>
                    {STRATEGY_LABELS[sid]}
                    {st.enabled && (
                      <span className="absolute top-0.5 right-1 text-[8px]" style={{ color }}>●</span>
                    )}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 cursor-pointer mb-2" title={MT_HELP.shared.strategyEnable}>
              <input type="checkbox" checked={strategyEnabled}
                onChange={e => setStrategyEnabled(activeStrategy, e.target.checked)}
                className="accent-violet-500" style={{ accentColor: STRATEGY_COLORS[activeStrategy] }} />
              <span className="text-xs text-p5">
                Ativar <span className="font-bold" style={{ color: STRATEGY_COLORS[activeStrategy] }}>{STRATEGY_LABELS[activeStrategy]}</span>
              </span>
            </label>
            <div className={strategyEnabled ? '' : 'opacity-40 pointer-events-none'}>
              <FieldLabel label="Capital desta estratégia (USDT)" hint={MT_HELP.shared.capital}
                className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1" />
              <input type="number" value={capital} onChange={e => setCapital(e.target.value)} min={1}
                className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono mb-1" style={sel}
                title={MT_HELP.shared.capital} />
              <FieldHint>{MT_HELP.shared.capital}</FieldHint>
            </div>
          </div>

          <div className={`flex gap-1 p-1 rounded-lg ${strategyEnabled ? '' : 'opacity-40 pointer-events-none'}`} style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
            {!isSwing && !isMaCross && [
              { id: 'rule1', label: 'Regra 1 — RSI', color: ENTRY_COLOR, hint: MT_HELP.rule1.group },
              { id: 'rule2', label: rule2TabLabel, color: MT_COLOR, hint: MT_HELP.rule2.group },
            ].map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                title={tab.hint}
                className="flex-1 py-1.5 text-[10px] font-bold rounded transition-colors"
                style={{
                  background: activeTab === tab.id ? `${tab.color}22` : 'transparent',
                  color: activeTab === tab.id ? tab.color : '#94a3b8',
                  border: `1px solid ${activeTab === tab.id ? tab.color + '55' : 'transparent'}`,
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {isSwing && strategyEnabled && (
            <SwingStrategyForm
              form={form}
              patch={patch}
              strategyId={activeStrategy}
              symbol={symbol}
              exchange={exchange}
              onSuggestEntryRsi={handleSuggestSwingEntryRsi}
              onSuggestExitRsi={handleSuggestSwingExitRsi}
              entryRsiSuggest={entryRsiSuggest}
              exitRsiSuggest={exitRsiSuggest}
            />
          )}

          {isMaCross && strategyEnabled && (
            <MaCrossStrategyForm form={form} patch={patch} />
          )}

          {!isSwing && !isMaCross && activeTab === 'rule1' && strategyEnabled && (
          <RuleGroup
            title="Regra 1 — Entrada RSI e saída"
            subtitle={MT_HELP.rule1.group}
            color={ENTRY_COLOR}>
            <div>
              <SectionHeader label="Ativar regra 1" color={ENTRY_COLOR} hint={MT_HELP.rule1.enabled} />
              <label className="flex items-center gap-2 cursor-pointer mb-2" title={MT_HELP.rule1.enabled}>
                <input type="checkbox" checked={rule1On}
                  onChange={e => { patch('rule1.enabled', e.target.checked); setEntryPathError(null); }}
                  className="accent-[#26a69a]" />
                <span className="text-xs text-p5">Entrada RSI — posição independente da regra 2</span>
              </label>
            </div>
            {rule1On && (
            <div>
              <SectionHeader label="Gatilho RSI" color={ENTRY_COLOR} hint={MT_HELP.rule1.entryRsi} />
                <RsiRuleFields
                  rsi={form.rule1.entryRsi}
                  sel={sel}
                  onPatch={(field, value) => patch(`rule1.entryRsi.${field}`, value)}
                />
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={handleSuggestEntryRsi}
                    disabled={!symbol.trim() || entryRsiSuggest?.loading}
                    className="text-[9px] px-2 py-0.5 rounded font-semibold shrink-0"
                    style={{ background: '#2a2d3a', color: '#26a69a', border: '1px solid #26a69a44' }}>
                    {entryRsiSuggest?.loading ? '…' : 'Sugerir RSI'}
                  </button>
                </div>
                {entryRsiSuggest && !entryRsiSuggest.loading && (
                  <p className="text-[9px] font-mono leading-relaxed" style={{ color: entryRsiSuggest.error ? '#f59e0b' : '#94a3b8' }}>
                    {entryRsiSuggest.error
                      ? entryRsiSuggest.error
                      : entryRsiSuggest.usedDefault
                        ? `Poucos trades (${entryRsiSuggest.bestStats?.tradeCount ?? 0}) — mantém ${entryRsiSuggest.anchorValue}`
                        : `${entryRsiSuggest.bestStats?.tradeCount ?? '—'} trades · PnL méd. ${entryRsiSuggest.bestStats?.avgPnl ?? '—'}% · win ${entryRsiSuggest.bestStats?.winRate ?? '—'}% → sugerido ${entryRsiSuggest.entryRsiValue}${entryRsiSuggest.vsAnchor?.pnlDelta != null ? ` (+${entryRsiSuggest.vsAnchor.pnlDelta}% vs âncora)` : ''}`}
                  </p>
                )}
            {entrySummary && (
              <p className="text-[9px] font-mono mt-2 px-1" style={{ color: '#26a69a99' }}>{entrySummary}</p>
            )}
            </div>
            )}
            {entryPathError && (
              <p className="text-[9px] text-red-400 mt-1">{entryPathError}</p>
            )}

            <div>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <label className="flex items-center gap-2 cursor-pointer shrink-0" title={MT_HELP.rule1.maFilters}>
                <input
                  id="multitrade-modal-ma-filters-enabled"
                  type="checkbox"
                  checked={form.rule1.maFiltersEnabled !== false}
                  onChange={e => patch('rule1.maFiltersEnabled', e.target.checked)}
                  className="accent-violet-500"
                />
                <FieldLabel label="Filtros MA" hint={MT_HELP.rule1.maFilters}
                  className="text-[10px] uppercase tracking-wider font-bold" style={{ color: ENTRY_COLOR }} />
              </label>
              <div className="flex-1 h-px bg-p2" />
              <button
                id="multitrade-modal-btn-add-ma"
                onClick={addMa}
                disabled={form.rule1.maFiltersEnabled === false}
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold disabled:opacity-40"
                style={{ background: '#2a2d3a', color: MT_COLOR, border: `1px solid ${MT_COLOR}44` }}
              >+ MA</button>
            </div>
            <div className={`space-y-1.5 ${form.rule1.maFiltersEnabled === false ? 'opacity-40 pointer-events-none' : ''}`}>
              {form.rule1.maFiltersEnabled !== false && (
                <FieldHint className="mb-1">{MT_HELP.rule1.maFilters}</FieldHint>
              )}
              {form.rule1.maConditions.map(ma => (
                <div key={ma.id} className="space-y-1">
                  <div className="flex gap-1 items-center">
                    <select value={ma.period} onChange={e => updateMa(ma.id, 'period', Number(e.target.value))}
                      title={MT_HELP.rule1.maPeriod}
                      className="w-14 rounded px-1 py-1 text-[10px] text-p5 outline-none font-mono" style={sel}>
                      {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                    </select>
                    <select value={ma.interval} onChange={e => updateMa(ma.id, 'interval', e.target.value)}
                      title={MT_HELP.rule1.maInterval}
                      className="w-12 rounded px-1 py-1 text-[10px] text-p5 outline-none" style={sel}>
                      {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                    <select value={ma.mode} onChange={e => updateMa(ma.id, 'mode', e.target.value)}
                      title={ma.mode === 'adaptive' ? MT_HELP.rule1.maModeAdaptive : MT_HELP.rule1.maModeStrict}
                      className="flex-1 text-[10px] py-1 rounded px-1" style={sel}>
                      {MA_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <button onClick={() => removeMa(ma.id)}
                      className="text-p5/30 hover:text-red-400 w-5 h-5 flex items-center justify-center rounded text-sm" style={{ background: '#2a2d3a' }}>×</button>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer flex-wrap pl-0.5" title={MT_HELP.rule1.maAboveCandles}>
                    <input
                      type="checkbox"
                      checked={ma.aboveMaEnabled === true}
                      onChange={e => updateMa(ma.id, 'aboveMaEnabled', e.target.checked)}
                      className="accent-violet-500"
                    />
                    <span className="text-[9px] text-p5/50">Exigir</span>
                    <NumInput
                      value={ma.aboveMaCandles ?? 10}
                      onChange={v => updateMa(ma.id, 'aboveMaCandles', v)}
                      min={1} max={50} className="w-12"
                      disabled={ma.aboveMaEnabled !== true}
                      title={MT_HELP.rule1.maAboveCandles}
                    />
                    <span className="text-[9px] text-p5/50">candles fechados acima da MA</span>
                  </label>
                  {ma.mode === 'adaptive' && (
                    <div className="pl-1 space-y-1">
                      <div className="flex gap-1 items-center flex-wrap" title={MT_HELP.rule1.maDipFixed}>
                        <span className="text-[9px] text-p5/35 shrink-0">Dip fixo % (opcional):</span>
                        <NumInput value={ma.fixedDipPct} onChange={v => updateMa(ma.id, 'fixedDipPct', v)} min={0} max={20} step={0.1} className="w-14" />
                        <button type="button" onClick={() => handleSuggestAdaptive(ma.id)}
                          disabled={!symbol.trim() || adaptiveSuggest[ma.id]?.loading}
                          className="rounded px-2 py-0.5 text-[9px] font-semibold text-violet-300 border border-violet-500/40 hover:bg-violet-500/10 disabled:opacity-40">
                          {adaptiveSuggest[ma.id]?.loading ? '…' : 'Sugerir'}
                        </button>
                      </div>
                      {adaptiveSuggest[ma.id] && !adaptiveSuggest[ma.id].loading && (
                        <p className="text-[9px] font-mono leading-relaxed" style={{ color: adaptiveSuggest[ma.id].error ? '#f59e0b' : '#94a3b8' }}>
                          {adaptiveSuggest[ma.id].error
                            ? adaptiveSuggest[ma.id].error
                            : adaptiveSuggest[ma.id].usedDefault
                              ? `Poucos episódios (${adaptiveSuggest[ma.id].episodeCount ?? 0}) — padrão ${adaptiveSuggest[ma.id].suggestedDipPct}%`
                              : `${adaptiveSuggest[ma.id].episodeCount} dips: média ${adaptiveSuggest[ma.id].avgRaw}% → sugerido ${adaptiveSuggest[ma.id].suggestedDipPct}% · entrada MA ${adaptiveSuggest[ma.id].entryOk ? 'OK' : 'bloqueada'} (dip agora ${adaptiveSuggest[ma.id].dipNowPct ?? '—'}%)`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!form.rule1.maConditions.length && form.rule1.maFiltersEnabled !== false && (
                <p className="text-[9px] text-p5/35">Nenhum filtro — entrada só pelo RSI (sem exigir tendência em MA).</p>
              )}
              {form.rule1.maFiltersEnabled === false && (
                <FieldHint>{MT_HELP.rule1.maFilters}</FieldHint>
              )}
            </div>
            </div>

            <div>
            <SectionHeader label="Bloqueio por extensão" color={ENTRY_COLOR} hint={MT_HELP.rule1.extension} />
            <label className="flex items-center gap-2 cursor-pointer mb-2" title={MT_HELP.rule1.extension}>
              <input type="checkbox" checked={form.rule1.extension.enabled} onChange={e => patch('rule1.extension.enabled', e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">Ativar bloqueio quando preço esticado acima da MA</span>
            </label>
            {form.rule1.extension.enabled && (
              <>
                <div className="flex gap-1.5 mb-2 items-center flex-wrap" title={MT_HELP.rule1.extensionRef}>
                  <span className="text-[10px] text-p5/40">MA de referência:</span>
                  <select value={form.rule1.extension.maPeriod} onChange={e => patch('rule1.extension.maPeriod', Number(e.target.value))}
                    className="w-14 rounded px-1 py-1 text-[10px] font-mono" style={sel}>
                    {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                  </select>
                  <select value={form.rule1.extension.maInterval} onChange={e => patch('rule1.extension.maInterval', e.target.value)}
                    className="w-12 rounded px-1 py-1 text-[10px]" style={sel}>
                    {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mb-1" title={MT_HELP.rule1.extension3}>
                  <input type="checkbox" checked={form.rule1.extension.threeCandles} onChange={e => patch('rule1.extension.threeCandles', e.target.checked)} className="accent-violet-500" />
                  <span className="text-xs text-p5 flex-1">3 candles de alta seguidos (exaustão)</span>
                  <select value={form.rule1.extension.threeInterval ?? form.rule1.extension.confirmInterval ?? '1h'}
                    onChange={e => patch('rule1.extension.threeInterval', e.target.value)}
                    className="w-12 rounded px-1 py-1 text-[10px]" style={sel}>
                    {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 cursor-pointer mb-1" title={MT_HELP.rule1.extension4}>
                  <input type="checkbox" checked={form.rule1.extension.fourCandles} onChange={e => patch('rule1.extension.fourCandles', e.target.checked)} className="mt-0.5 accent-violet-500" />
                  <span className="text-xs text-p5 flex-1">3 altas + 1 queda (topo com correção)</span>
                  <select value={form.rule1.extension.fourInterval ?? form.rule1.extension.confirmInterval ?? '1h'}
                    onChange={e => patch('rule1.extension.fourInterval', e.target.value)}
                    className="w-12 rounded px-1 py-1 text-[10px]" style={sel}>
                    {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </label>
                <select value={form.rule1.extension.confirmLogic} onChange={e => patch('rule1.extension.confirmLogic', e.target.value)}
                  title={MT_HELP.rule1.extensionLogic}
                  className="w-full rounded px-2 py-1 text-[10px] text-p5 outline-none mt-1" style={sel}>
                  <option value="any">Basta uma regra (3 OU 4 candles)</option>
                  <option value="all">Exige ambas (3 E 4 candles)</option>
                </select>
                <FieldHint className="mt-1">{MT_HELP.rule1.extensionLogic}</FieldHint>
              </>
            )}
            </div>

            <div>
            <SectionHeader label="Execução da compra" color={ENTRY_COLOR} hint="Define se a compra é a mercado ou ordem limite PENDING abaixo do gatilho RSI." />
            <label className="flex items-center gap-2 cursor-pointer mb-2" title={MT_HELP.rule1.execImmediate}>
              <input type="checkbox" checked={form.rule1.execution.immediateEntry} onChange={e => patch('rule1.execution.immediateEntry', e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">Compra imediata a mercado</span>
            </label>
            {!form.rule1.execution.immediateEntry && (
              <>
                <FieldLabel label="Desconto do alvo PENDING (% abaixo do gatilho)" hint={MT_HELP.rule1.execDiscount}
                  className="block text-[10px] text-p5/40 mb-1" />
                <div className="flex gap-1.5 mb-1">
                  <NumInput
                    value={parseFloat((form.rule1.execution.entryDiscount * 100).toFixed(3))}
                    onChange={v => patch('rule1.execution.entryDiscount', Math.min(10, Math.max(0.01, v)) / 100)}
                    min={0.01} max={10} step={0.05} className="flex-1"
                  />
                  <button type="button" onClick={handleSuggestDiscount} disabled={!symbol.trim() || discountSuggest?.loading}
                    className="shrink-0 rounded px-2 py-1 text-[10px] font-semibold text-violet-300 border border-violet-500/40 hover:bg-violet-500/10 disabled:opacity-40">
                    {discountSuggest?.loading ? '…' : 'Sugerir'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {ENTRY_DISCOUNT_OPTIONS.map(o => (
                    <button key={o.value} type="button" onClick={() => patch('rule1.execution.entryDiscount', o.value)}
                      className="rounded px-1.5 py-0.5 text-[10px] font-mono border border-p2 text-p5/60 hover:text-p5 hover:border-violet-500/50"
                      style={form.rule1.execution.entryDiscount === o.value ? { color: '#a78bfa', borderColor: '#8b5cf6' } : {}}>
                      {o.label}
                    </button>
                  ))}
                </div>
                {discountSuggest && !discountSuggest.loading && (
                  <p className="text-[10px] font-mono mb-2" style={{ color: discountSuggest.error ? '#f59e0b' : '#94a3b8' }}>
                    {discountSuggest.error
                      ? discountSuggest.error
                      : discountSuggest.usedDefault
                        ? `Poucos dados (${discountSuggest.episodeCount ?? 0} episódios) — padrão ${discountSuggest.suggestedPct ?? 0.1}%`
                        : `${discountSuggest.episodeCount} sinais RSI: mediana −${discountSuggest.medianDipPct}% → sugerido −${discountSuggest.suggestedPct}% (fill ~${discountSuggest.hitRateAtSuggested ?? '—'}%)`}
                  </p>
                )}
                <FieldLabel label="Timeout PENDING" hint={MT_HELP.rule1.execTimeout}
                  className="block text-[10px] text-p5/40 mb-1" />
                <select value={form.rule1.execution.pendingTimeoutMs} onChange={e => patch('rule1.execution.pendingTimeoutMs', Number(e.target.value))}
                  title={MT_HELP.rule1.execTimeout}
                  className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none cursor-pointer mb-2" style={sel}>
                  {PENDING_TIMEOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <FieldLabel label="Cancela se preço subir (% acima do gatilho)" hint={MT_HELP.rule1.execCancelPct}
                  className="block text-[10px] text-p5/40 mb-1" />
                <NumInput value={(form.rule1.execution.pendingCancelPct * 100).toFixed(2)} onChange={v => patch('rule1.execution.pendingCancelPct', v / 100)}
                  min={0.1} max={5} step={0.1} className="w-full mb-2" title={MT_HELP.rule1.execCancelPct} />
                <label className="flex items-center gap-2 cursor-pointer mb-1" title={MT_HELP.rule1.execCancelExitRsi}>
                  <input type="checkbox" checked={form.rule1.execution.pendingCancelOnExitRsi !== false}
                    onChange={e => patch('rule1.execution.pendingCancelOnExitRsi', e.target.checked)} className="accent-violet-500" />
                  <span className="text-xs text-p5">Cancela PENDING se RSI de saída for atingido</span>
                </label>
                <FieldHint className="mb-2">{MT_HELP.rule1.execCancelExitRsi}</FieldHint>
              </>
            )}
            </div>

            <div>
            <SectionHeader label="Saída por RSI (regra 1)" color={EXIT_COLOR} hint={MT_HELP.rule1.exitRsi} />
            <div className="grid grid-cols-3 gap-1.5 mb-1">
              <select value={form.rule1.exitRsi.interval} onChange={e => patch('rule1.exitRsi.interval', e.target.value)}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none cursor-pointer" style={sel}>
                {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
              <select value={form.rule1.exitRsi.period} onChange={e => patch('rule1.exitRsi.period', Number(e.target.value))}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none font-mono" style={sel}>
                {RSI_PERIODS.map(p => <option key={p} value={p}>p{p}</option>)}
              </select>
              <div className="flex gap-1">
                <NumInput value={form.rule1.exitRsi.value} onChange={v => patch('rule1.exitRsi.value', v)} min={1} max={99} className="flex-1" />
                <button type="button" onClick={handleSuggestExitRsi} disabled={!symbol.trim() || exitRsiSuggest?.loading}
                  className="shrink-0 rounded px-1.5 text-[9px] font-semibold text-red-300 border border-red-500/40 hover:bg-red-500/10 disabled:opacity-40">
                  {exitRsiSuggest?.loading ? '…' : 'Sugerir'}
                </button>
              </div>
            </div>
            {renderExitRsiSuggest(exitRsiSuggest)}
            <FieldHint>Vende quando RSI({form.rule1.exitRsi.interval}, {form.rule1.exitRsi.period}) {form.rule1.exitRsi.operator ?? '>'} {form.rule1.exitRsi.value}</FieldHint>
            </div>

            <div id="multitrade-modal-stop-loss">
            <SectionHeader label="Stop loss" color={EXIT_COLOR} hint={MT_HELP.rule1.stopOverview} />

            <label className="flex items-start gap-2 cursor-pointer mb-2" title={MT_HELP.rule1.stopFixed}>
              <input
                type="checkbox"
                id="multitrade-modal-stop-loss-fixed"
                checked={form.rule1.stopLoss.fixedEnabled !== false}
                onChange={e => patch('rule1.stopLoss.fixedEnabled', e.target.checked)}
                className="accent-violet-500 mt-0.5"
              />
              <span className="text-xs text-p5 leading-snug">
                <span className="font-semibold">MA fixa</span>
                <span className="block text-[9px] text-p5/45">{MT_HELP.rule1.stopFixed}</span>
              </span>
            </label>
            {form.rule1.stopLoss.fixedEnabled !== false && (
              <div id="multitrade-modal-stop-loss-fixed-fields" className="ml-6 mb-2 space-y-1.5">
                <div className="flex gap-1.5">
                <select
                  id="multitrade-modal-stop-loss-period"
                  value={form.rule1.stopLoss.period}
                  onChange={e => patch('rule1.stopLoss.period', Number(e.target.value))}
                  className="w-16 rounded px-1 py-1.5 text-xs font-mono"
                  style={sel}>
                  {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                </select>
                <select
                  id="multitrade-modal-stop-loss-interval"
                  value={form.rule1.stopLoss.interval}
                  onChange={e => patch('rule1.stopLoss.interval', e.target.value)}
                  className="flex-1 rounded px-2 py-1.5 text-xs"
                  style={sel}>
                  {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer flex-wrap" title={MT_HELP.rule1.stopFixedAbove}>
                  <input
                    id="multitrade-modal-stop-loss-fixed-above-ma"
                    type="checkbox"
                    checked={form.rule1.stopLoss.fixedAboveMaEnabled === true}
                    onChange={e => patch('rule1.stopLoss.fixedAboveMaEnabled', e.target.checked)}
                    className="accent-violet-500"
                  />
                  <span className="text-[10px] text-p5/70">Exigir</span>
                  <NumInput
                    value={form.rule1.stopLoss.fixedAboveMaCandles ?? 10}
                    onChange={v => patch('rule1.stopLoss.fixedAboveMaCandles', v)}
                    min={1} max={50} className="w-12"
                    disabled={form.rule1.stopLoss.fixedAboveMaEnabled !== true}
                  />
                  <span className="text-[10px] text-p5/70">candles fechados acima da MA antes do stop</span>
                </label>
              </div>
            )}

            <label className="flex items-start gap-2 cursor-pointer mb-1" title={MT_HELP.rule1.stopAdaptive}>
              <input
                type="checkbox"
                id="multitrade-modal-stop-loss-adaptive"
                checked={form.rule1.stopLoss.adaptiveEnabled !== false}
                onChange={e => patch('rule1.stopLoss.adaptiveEnabled', e.target.checked)}
                className="accent-violet-500 mt-0.5"
              />
              <span className="text-xs text-p5 leading-snug">
                <span className="font-semibold">Piso adaptativo</span>
                <span className="block text-[9px] text-p5/45">{MT_HELP.rule1.stopAdaptive}</span>
              </span>
            </label>
            {form.rule1.stopLoss.adaptiveEnabled !== false && (
              <div id="multitrade-modal-stop-loss-adaptive-fields" className="ml-6 mb-2 space-y-1.5">
                <div className="flex gap-1.5">
                <select
                  value={form.rule1.stopLoss.adaptivePeriod ?? 50}
                  onChange={e => patch('rule1.stopLoss.adaptivePeriod', Number(e.target.value))}
                  className="w-16 rounded px-1 py-1.5 text-xs font-mono"
                  style={sel}>
                  {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                </select>
                <select
                  value={form.rule1.stopLoss.adaptiveInterval ?? '1h'}
                  onChange={e => patch('rule1.stopLoss.adaptiveInterval', e.target.value)}
                  className="flex-1 rounded px-2 py-1.5 text-xs"
                  style={sel}>
                  {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer flex-wrap" title={MT_HELP.rule1.stopAdaptiveAbove}>
                  <input
                    id="multitrade-modal-stop-loss-adaptive-above-ma"
                    type="checkbox"
                    checked={form.rule1.stopLoss.adaptiveAboveMaEnabled === true}
                    onChange={e => patch('rule1.stopLoss.adaptiveAboveMaEnabled', e.target.checked)}
                    className="accent-violet-500"
                  />
                  <span className="text-[10px] text-p5/70">Exigir</span>
                  <NumInput
                    value={form.rule1.stopLoss.adaptiveAboveMaCandles ?? 10}
                    onChange={v => patch('rule1.stopLoss.adaptiveAboveMaCandles', v)}
                    min={1} max={50} className="w-12"
                    disabled={form.rule1.stopLoss.adaptiveAboveMaEnabled !== true}
                  />
                  <span className="text-[10px] text-p5/70">candles fechados acima da MA antes do piso</span>
                </label>
              </div>
            )}
            {form.rule1.stopLoss.fixedEnabled === false && form.rule1.stopLoss.adaptiveEnabled === false && (
              <div id="multitrade-modal-stop-loss-pct-cap" className="ml-6 mb-2">
                <label className="flex items-start gap-2 cursor-pointer" title={MT_HELP.rule1.stopPctCap}>
                  <input
                    type="checkbox"
                    id="multitrade-modal-stop-loss-pct-cap-enabled"
                    checked={form.rule1.stopLoss.pctCapEnabled !== false}
                    onChange={e => patch('rule1.stopLoss.pctCapEnabled', e.target.checked)}
                    className="accent-violet-500 mt-0.5"
                  />
                  <span className="text-xs text-p5 leading-snug">
                    <span className="font-semibold">Limite −{Math.min(Number(form.rule1.stopLoss.maxLossPct ?? 5), 5)}% da entrada</span>
                    <span className="block text-[9px] text-p5/45">{MT_HELP.rule1.stopPctCap}</span>
                  </span>
                </label>
                {form.rule1.stopLoss.pctCapEnabled === false && (
                  <p className="text-[9px] text-p5/35 mt-1">Stop desligado — saída apenas por RSI.</p>
                )}
              </div>
            )}
            </div>
          </RuleGroup>
          )}

          {!isSwing && !isMaCross && activeTab === 'rule2' && strategyEnabled && (
          <RuleGroup
            title="Regra 2 — Entrada MA"
            subtitle={MT_HELP.rule2.group}
            color={MT_COLOR}>
            <label className="flex items-center gap-2 cursor-pointer mb-2" title={MT_HELP.rule2.enabled}>
              <input type="checkbox" checked={rule2On}
                onChange={e => { patch('rule2.enabled', e.target.checked); setEntryPathError(null); }}
                className="accent-[#8b5cf6]" />
              <span className="text-xs text-p5">Ativar — posição independente (não reentra se PENDING/BOUGHT)</span>
            </label>
            {rule2On && (<>
            <SectionHeader label="Entrada — MA configurável" color={MT_COLOR} hint={MT_HELP.rule2.entryMa} />
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              <select value={form.rule2.entryMa.period} onChange={e => patch('rule2.entryMa.period', Number(e.target.value))}
                title={MT_HELP.rule1.maPeriod}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none font-mono" style={sel}>
                {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
              </select>
              <select value={form.rule2.entryMa.interval} onChange={e => patch('rule2.entryMa.interval', e.target.value)}
                title={MT_HELP.rule1.maInterval}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none" style={sel}>
                {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
              <select value={form.rule2.entryMa.trigger} onChange={e => patch('rule2.entryMa.trigger', e.target.value)}
                title={form.rule2.entryMa.trigger === 'touch' ? MT_HELP.rule2.triggerTouch : MT_HELP.rule2.triggerCross}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none" style={sel}>
                {ENTRY_MA_TRIGGERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3 mb-2" title={MT_HELP.rule2.aboveMa}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.rule2.entryMa.aboveMaEnabled !== false}
                  onChange={e => patch('rule2.entryMa.aboveMaEnabled', e.target.checked)} className="accent-[#8b5cf6]" />
                <span className="text-[10px] text-p5/60">Exigir candles acima da MA</span>
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-p5/40">Qtd.</span>
                <NumInput value={form.rule2.entryMa.aboveMaCandles ?? 10}
                  onChange={v => patch('rule2.entryMa.aboveMaCandles', v)}
                  min={1} max={50} step={1} className="w-14"
                  disabled={form.rule2.entryMa.aboveMaEnabled === false}
                  title={MT_HELP.rule2.aboveMa} />
                <span className="text-[9px] text-p5/35">candles anteriores com close &gt; MA</span>
              </div>
            </div>
            <FieldHint className="mb-2">{MT_HELP.rule2.aboveMa}</FieldHint>
            <div className="flex items-center gap-2 mb-3" title={MT_HELP.rule2.tolerance}>
              <FieldLabel label="Tolerância (toque)" hint={MT_HELP.rule2.tolerance} className="text-[9px] text-p5/40" />
              <NumInput value={form.rule2.entryMa.tolerancePct} onChange={v => patch('rule2.entryMa.tolerancePct', v)} min={0.1} max={5} step={0.1} className="w-16" title={MT_HELP.rule2.tolerance} />
              <span className="text-[9px] text-p5/35">%</span>
            </div>
            {rule2Summary && <p className="text-[9px] font-mono mb-2" style={{ color: `${MT_COLOR}99` }}>{rule2Summary}</p>}

            <SectionHeader label="Execução (sempre PENDING)" color={MT_COLOR} hint={MT_HELP.rule2.execPending} />
            <FieldLabel label="Desconto % abaixo do gatilho MA" hint={MT_HELP.rule2.execDiscount}
              className="block text-[10px] text-p5/40 mb-1" />
            <NumInput
              value={parseFloat((form.rule2.execution.entryDiscount * 100).toFixed(2))}
              onChange={v => patch('rule2.execution.entryDiscount', Math.min(10, Math.max(0.1, v)) / 100)}
              min={0.1} max={10} step={0.1} className="w-full mb-2" title={MT_HELP.rule2.execDiscount} />
            <select value={form.rule2.execution.pendingTimeoutMs} onChange={e => patch('rule2.execution.pendingTimeoutMs', Number(e.target.value))}
              title={MT_HELP.rule1.execTimeout}
              className="w-full rounded px-2 py-1 text-xs mb-2" style={sel}>
              {PENDING_TIMEOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} timeout</option>)}
            </select>
            <FieldLabel label="Cancela se preço subir (% acima do gatilho)" hint={MT_HELP.rule1.execCancelPct}
              className="block text-[10px] text-p5/40 mb-1" />
            <NumInput
              value={(form.rule2.execution.pendingCancelPct * 100).toFixed(2)}
              onChange={v => patch('rule2.execution.pendingCancelPct', v / 100)}
              min={0.1} max={5} step={0.1} className="w-full mb-2" title={MT_HELP.rule1.execCancelPct} />
            <label className="flex items-center gap-2 cursor-pointer mb-1" title={MT_HELP.rule1.execCancelExitRsi}>
              <input type="checkbox" checked={form.rule2.execution.pendingCancelOnExitRsi !== false}
                onChange={e => patch('rule2.execution.pendingCancelOnExitRsi', e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">Cancela PENDING se RSI de saída for atingido</span>
            </label>
            <FieldHint className="mb-3">
              {MT_HELP.rule1.execCancelExitRsi} Lógica de saída: {form.rule2.exitRsiLogic === 'all' ? 'todas as condições' : 'qualquer condição'}.
            </FieldHint>

            <SectionHeader label="Saída por RSI (regra 2)" color={EXIT_COLOR} hint={MT_HELP.rule2.exitRsiCond} />
            <div className="flex items-center gap-2 mb-2">
              <FieldLabel label="Vende quando" hint={MT_HELP.rule2.exitRsiLogic} className="text-[9px] text-p5/40" />
              <select value={form.rule2.exitRsiLogic ?? 'any'} onChange={e => patch('rule2.exitRsiLogic', e.target.value)}
                title={MT_HELP.rule2.exitRsiLogic}
                className="rounded px-2 py-1 text-[10px] text-p5 outline-none" style={sel}>
                <option value="any">qualquer condição (OU)</option>
                <option value="all">todas as condições (E)</option>
              </select>
            </div>
            {(form.rule2.exitRsiConditions ?? []).map((cond, idx) => (
              <div key={cond.id ?? idx} className="rounded-md p-2 mb-2" style={{ border: '1px solid #2a2d3a', background: '#141720' }}>
                <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                  <input type="checkbox" checked={cond.enabled !== false}
                    onChange={e => patchExitRsiCondition(cond.id, 'enabled', e.target.checked)} className="accent-violet-500" />
                  <span className="text-[10px] text-p5/50">
                    Condição {idx + 1}
                    {cond.enabled !== false && (
                      <span className="text-p5/35 font-mono ml-1">
                        RSI({cond.interval}) {cond.operator} {cond.value}
                      </span>
                    )}
                  </span>
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  <select value={cond.interval} onChange={e => patchExitRsiCondition(cond.id, 'interval', e.target.value)}
                    className="rounded px-1 py-1.5 text-xs text-p5 outline-none" style={sel}>
                    {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                  <select value={cond.period} onChange={e => patchExitRsiCondition(cond.id, 'period', Number(e.target.value))}
                    className="rounded px-1 py-1.5 text-xs text-p5 outline-none font-mono" style={sel}>
                    {RSI_PERIODS.map(p => <option key={p} value={p}>p{p}</option>)}
                  </select>
                  <select value={cond.operator} onChange={e => patchExitRsiCondition(cond.id, 'operator', e.target.value)}
                    className="rounded px-1 py-1.5 text-xs text-p5 outline-none text-center" style={sel}>
                    {RSI_OPERATORS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <NumInput value={cond.value} onChange={v => patchExitRsiCondition(cond.id, 'value', v)} min={1} max={99} />
                </div>
              </div>
            ))}
            <div className="flex gap-1 mb-2">
              <button type="button" onClick={handleSuggestExitRsi2} disabled={!symbol.trim() || exitRsi2Suggest?.loading}
                className="rounded px-2 py-1 text-[9px] font-semibold text-red-300 border border-red-500/40 hover:bg-red-500/10 disabled:opacity-40">
                {exitRsi2Suggest?.loading ? '…' : 'Sugerir RSI (cond. 1)'}
              </button>
            </div>
            {renderExitRsiSuggest(exitRsi2Suggest)}
            <FieldHint className="mb-2">{MT_HELP.rule2.exitRsiCond}</FieldHint>

            <SectionHeader label="Stop adaptativo (MA de entrada)" color={EXIT_COLOR} hint={MT_HELP.rule2.stopAdaptive} />
            <label className="flex items-center gap-2 cursor-pointer mb-2" title={MT_HELP.rule2.stopAdaptive}>
              <input type="checkbox" checked={form.rule2.stopLoss.adaptiveEnabled !== false}
                onChange={e => patch('rule2.stopLoss.adaptiveEnabled', e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">
                Piso = MA{form.rule2.entryMa.period} {form.rule2.entryMa.interval} × (1 − dip% histórico)
              </span>
            </label>
            {form.rule2.stopLoss.adaptiveEnabled !== false && (
              <label className="flex items-center gap-2 cursor-pointer flex-wrap mb-2 ml-1" title={MT_HELP.rule2.stopAboveMa}>
                <input
                  id="multitrade-modal-rule2-stop-above-ma"
                  type="checkbox"
                  checked={form.rule2.stopLoss.adaptiveAboveMaEnabled === true}
                  onChange={e => patch('rule2.stopLoss.adaptiveAboveMaEnabled', e.target.checked)}
                  className="accent-violet-500"
                />
                <span className="text-[10px] text-p5/70">Exigir</span>
                <NumInput
                  value={form.rule2.stopLoss.adaptiveAboveMaCandles ?? 10}
                  onChange={v => patch('rule2.stopLoss.adaptiveAboveMaCandles', v)}
                  min={1} max={50} className="w-12"
                  disabled={form.rule2.stopLoss.adaptiveAboveMaEnabled !== true}
                />
                <span className="text-[10px] text-p5/70">candles fechados acima da MA antes do stop</span>
              </label>
            )}
            <FieldHint>{MT_HELP.rule2.stopAdaptive}</FieldHint>
            </>)}
          </RuleGroup>
          )}

          <div>
            <SectionHeader label="Volume mínimo 24h (compartilhado)" hint={MT_HELP.shared.volume} />
            <select value={form.volume.minVolumeUsdt} onChange={e => patch('volume.minVolumeUsdt', Number(e.target.value))}
              title={MT_HELP.shared.volume}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none cursor-pointer font-mono mb-1" style={sel}>
              {VOLUME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} USDT mínimo 24h</option>)}
            </select>
            {symbol.trim() && (
              <p className="text-[10px] font-mono" style={{
                color: volCheck?.loading ? '#94a3b8' : volCheck?.meetsMin === false ? '#f59e0b' : volCheck?.meetsMin ? '#26a69a' : '#94a3b8',
              }}>
                {volCheck?.loading ? 'Verificando…' : volCheck?.meetsMin === false
                  ? `Atual: ${volCheck.volumeFmt} — abaixo do mínimo`
                  : volCheck?.volumeFmt ? `Atual: ${volCheck.volumeFmt}` : ''}
              </p>
            )}
          </div>

          {/* Avançado */}
          <div>
            <button onClick={() => setAdvancedOpen(v => !v)}
              className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-p5/50 py-1">
              <span>Parâmetros avançados</span>
              <span>{advancedOpen ? '▲' : '▼'}</span>
            </button>
            {advancedOpen && (
              <div className="space-y-3 pt-2 border-t border-p2">
                <div>
                  <FieldLabel label="Polling normal / rápido" hint={`${MT_HELP.shared.pollNormal} ${MT_HELP.shared.pollFast}`}
                    className="block text-[10px] text-p5/40 mb-1" />
                  <div className="flex gap-1.5">
                    <select value={form.polling.pollMs} onChange={e => patch('polling.pollMs', Number(e.target.value))}
                      className="flex-1 rounded px-1 py-1 text-[10px]" style={sel}>
                      {POLL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <select value={form.polling.fastPollMs} onChange={e => patch('polling.fastPollMs', Number(e.target.value))}
                      className="flex-1 rounded px-1 py-1 text-[10px]" style={sel}>
                      {POLL_OPTIONS.map(o => <option key={`f${o.value}`} value={o.value}>ráp. {o.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <FieldLabel label="RSI saída ≥ valor → polling rápido" hint={MT_HELP.shared.pollFastThreshold}
                    className="block text-[10px] text-p5/40 mb-1" />
                  <NumInput value={form.polling.fastRsiThreshold} onChange={v => patch('polling.fastRsiThreshold', v)} min={50} max={95} className="w-full" title={MT_HELP.shared.pollFastThreshold} />
                </div>
                <div>
                  <FieldLabel label="MA adaptativa — dip padrão / máx / mín / episódios" hint={MT_HELP.shared.adaptiveOpts}
                    className="block text-[10px] text-p5/40 mb-1" />
                  <div className="grid grid-cols-4 gap-1">
                    <NumInput value={form.rule1.adaptiveOpts.defaultPct} onChange={v => patch('rule1.adaptiveOpts.defaultPct', v)} min={0} max={20} step={0.5} className="w-full" />
                    <NumInput value={form.rule1.adaptiveOpts.maxPct} onChange={v => patch('rule1.adaptiveOpts.maxPct', Math.min(5, v))} min={0} max={5} step={0.5} className="w-full" />
                    <NumInput value={form.rule1.adaptiveOpts.minPct} onChange={v => patch('rule1.adaptiveOpts.minPct', v)} min={0} max={10} step={0.1} className="w-full" />
                    <NumInput value={form.rule1.adaptiveOpts.minEpisodes} onChange={v => patch('rule1.adaptiveOpts.minEpisodes', v)} min={1} max={20} className="w-full" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Backtest */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-p5/40">Backtest</span>
              <button onClick={() => copy(cmd, 'cmd')} className="text-[10px] px-2 py-0.5 rounded"
                style={{ background: copied === 'cmd' ? '#26a69a' : '#2a2d3a', color: copied === 'cmd' ? '#fff' : '#94a3b8' }}>
                {copied === 'cmd' ? '✓' : 'Copiar'}
              </button>
            </div>
            <pre className="text-[9px] font-mono text-p5/60 rounded px-2 py-2 overflow-x-auto whitespace-pre-wrap break-all"
              style={{ background: '#0d1117', border: '1px solid #2a2d3a' }}>{cmd}</pre>
          </div>

          {showAdaptive && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-p5/40">Teste adaptativo</span>
                <button onClick={() => copy(adaptCmd, 'adapt')} className="text-[10px] px-2 py-0.5 rounded"
                  style={{ background: copied === 'adapt' ? '#26a69a' : '#2a2d3a', color: copied === 'adapt' ? '#fff' : '#94a3b8' }}>
                  {copied === 'adapt' ? '✓' : 'Copiar'}
                </button>
              </div>
              <pre className="text-[9px] font-mono text-p5/60 rounded px-2 py-2 overflow-x-auto whitespace-pre-wrap break-all"
                style={{ background: '#0d1117', border: '1px solid #2a2d3a' }}>{adaptCmd}</pre>
            </div>
          )}
        </div>

        {volumeWarnOpen && volCheck && !volCheck.meetsMin && (
          <div className="mx-4 mb-2 rounded border px-3 py-2.5 space-y-2" style={{ background: '#f59e0b18', borderColor: '#f59e0b66' }}>
            <p className="text-xs text-p5 leading-relaxed">
              Volume abaixo do mínimo. Na saída o bot usará venda a mercado. Continuar?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setVolumeWarnOpen(false)} className="flex-1 py-1.5 text-xs rounded" style={{ border: '1px solid #2a2d3a', color: '#94a3b8' }}>Não</button>
              <button onClick={handleConfirmDespiteVolume} className="flex-1 py-1.5 text-xs rounded font-semibold" style={{ background: '#f59e0b', color: '#000' }}>Sim</button>
            </div>
          </div>
        )}

        <div className="flex gap-2 px-4 pb-4 pt-2 border-t" style={{ borderColor: '#2a2d3a' }}>
          {isEditing ? (
            <button onClick={onRemove} className="flex-1 py-1.5 text-xs rounded font-medium" style={{ border: '1px solid #ef5350', color: '#ef5350' }}>Remover</button>
          ) : (
            <button onClick={onCancel} className="flex-1 py-1.5 text-xs rounded text-p5/50" style={{ border: '1px solid #2a2d3a' }}>Cancelar</button>
          )}
          <button onClick={handleConfirm} disabled={!symbol.trim()}
            className="flex-1 py-1.5 text-xs rounded font-semibold disabled:opacity-40" style={{ background: MT_COLOR, color: '#fff' }}>
            {isEditing ? 'Salvar estratégias' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
