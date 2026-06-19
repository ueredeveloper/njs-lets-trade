import { useState, useCallback, useEffect } from 'react';
import { checkMultitradeVolume } from '../services/api';
import {
  RSI_INTERVALS, MA_INTERVALS, MA_PERIODS, RSI_PERIODS, MA_MODES,
  ENTRY_DISCOUNT_OPTIONS, VOLUME_OPTIONS, PENDING_TIMEOUT_OPTIONS, POLL_OPTIONS,
  formStateFromEntry, formStateToPayload,
} from '../constants/tradeConfigSchema';

const MT_COLOR      = '#8b5cf6';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

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

function SectionHeader({ label, color = '#94a3b8' }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color }}>{label}</span>
      <div className="flex-1 h-px bg-p2" />
    </div>
  );
}

function NumInput({ value, onChange, min, max, step = 1, className = 'w-16', ...rest }) {
  return (
    <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className={`rounded px-2 py-1 text-xs text-p5 outline-none font-mono ${className}`}
      style={{ background: '#1e2130', border: '1px solid #2a2d3a' }} {...rest} />
  );
}

export default function MultitradeModal({ symbol: initialSymbol, defaultExchange, currentEntry, onConfirm, onRemove, onCancel }) {
  const isEditing = !!currentEntry;
  const newId = useCallback(() => Date.now() + Math.random(), []);
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a' };

  const [symbol, setSymbol]     = useState(currentEntry?.symbol ?? initialSymbol ?? '');
  const [exchange, setExchange] = useState(currentEntry?.exchange ?? defaultExchange ?? 'binance');
  const [capital, setCapital]   = useState(currentEntry?.capital ?? 40);
  const [form, setForm]         = useState(() => formStateFromEntry(currentEntry));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [volCheck, setVolCheck] = useState(null);
  const [volumeWarnOpen, setVolumeWarnOpen] = useState(false);
  const [copied, setCopied]     = useState(null);

  const patch = useCallback((path, value) => {
    setForm(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }, []);

  function addMa() {
    setForm(prev => ({
      ...prev,
      maConditions: [...prev.maConditions, { id: newId(), period: 50, interval: '1h', mode: 'strict_above', fixedDipPct: '' }],
    }));
  }
  function removeMa(id) {
    setForm(prev => ({ ...prev, maConditions: prev.maConditions.filter(m => m.id !== id) }));
  }
  function updateMa(id, field, value) {
    setForm(prev => ({
      ...prev,
      maConditions: prev.maConditions.map(m => m.id === id ? { ...m, [field]: value } : m),
    }));
  }

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) { setVolCheck(null); return undefined; }
    let cancelled = false;
    setVolCheck({ loading: true });
    const timer = setTimeout(() => {
      checkMultitradeVolume(sym, exchange, form.volume.minVolumeUsdt)
        .then(data => { if (!cancelled) setVolCheck({ ...data, loading: false }); })
        .catch(err => { if (!cancelled) setVolCheck({ loading: false, error: err.message }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, exchange, form.volume.minVolumeUsdt]);

  useEffect(() => { setVolumeWarnOpen(false); }, [symbol, exchange, form.volume.minVolumeUsdt]);
  useEffect(() => { if (volCheck?.meetsMin) patch('volume.allowLowVolume', false); }, [volCheck?.meetsMin, patch]);

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  }

  function buildPayload(allowLow = form.volume.allowLowVolume) {
    const sym = symbol.trim().toUpperCase();
    const payload = formStateToPayload(form, { symbol: sym, exchange, capital: Number(capital) });
    payload.allowLowVolume = allowLow;
    payload.volume = { ...form.volume, allowLowVolume: allowLow };
    return payload;
  }

  function handleConfirm() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || Number(capital) <= 0) return;
    if (volCheck && !volCheck.loading && volCheck.meetsMin === false && !volumeWarnOpen) {
      setVolumeWarnOpen(true);
      return;
    }
    setVolumeWarnOpen(false);
    onConfirm(buildPayload());
  }

  function handleConfirmDespiteVolume() {
    setVolumeWarnOpen(false);
    onConfirm(buildPayload(true));
  }

  const payload = buildPayload();
  const cmd      = getBacktestCmd(payload);
  const adaptCmd = getAdaptiveTestCmd(payload);
  const showAdaptive = hasAdaptiveMa(form.maConditions);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-4"
      style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onCancel}>
      <div className="w-[22rem] rounded-lg shadow-2xl border mx-4 my-auto"
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
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5">Símbolo</label>
            <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono uppercase" style={sel} placeholder="BTCUSDT" />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5">Corretora</label>
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

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1">Capital (USDT)</label>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)} min={1}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono" style={sel} />
          </div>

          {/* Entrada RSI */}
          <div>
            <SectionHeader label="Entrada RSI" color="#26a69a" />
            <div className="grid grid-cols-3 gap-1.5">
              <select value={form.entryRsi.interval} onChange={e => patch('entryRsi.interval', e.target.value)}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none cursor-pointer" style={sel}>
                {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
              <select value={form.entryRsi.period} onChange={e => patch('entryRsi.period', Number(e.target.value))}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none font-mono" style={sel}>
                {RSI_PERIODS.map(p => <option key={p} value={p}>p{p}</option>)}
              </select>
              <NumInput value={form.entryRsi.value} onChange={v => patch('entryRsi.value', v)} min={1} max={99} className="w-full" />
            </div>
            <p className="text-[9px] text-p5/35 mt-1">Compra quando RSI({form.entryRsi.interval}, {form.entryRsi.period}) &lt; {form.entryRsi.value}</p>
          </div>

          {/* Filtros MA */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] text-p5/40">Filtros MA</label>
              <button onClick={addMa} className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: '#2a2d3a', color: MT_COLOR, border: `1px solid ${MT_COLOR}44` }}>+ MA</button>
            </div>
            <div className="space-y-1.5">
              {form.maConditions.map(ma => (
                <div key={ma.id} className="space-y-1">
                  <div className="flex gap-1 items-center">
                    <select value={ma.period} onChange={e => updateMa(ma.id, 'period', Number(e.target.value))}
                      className="w-14 rounded px-1 py-1 text-[10px] text-p5 outline-none font-mono" style={sel}>
                      {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                    </select>
                    <select value={ma.interval} onChange={e => updateMa(ma.id, 'interval', e.target.value)}
                      className="w-12 rounded px-1 py-1 text-[10px] text-p5 outline-none" style={sel}>
                      {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                    <select value={ma.mode} onChange={e => updateMa(ma.id, 'mode', e.target.value)}
                      className="flex-1 text-[10px] py-1 rounded px-1" style={sel}>
                      {MA_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <button onClick={() => removeMa(ma.id)}
                      className="text-p5/30 hover:text-red-400 w-5 h-5 flex items-center justify-center rounded text-sm" style={{ background: '#2a2d3a' }}>×</button>
                  </div>
                  {ma.mode === 'adaptive' && (
                    <div className="flex gap-1 items-center pl-1">
                      <span className="text-[9px] text-p5/35 shrink-0">Dip fixo % (opcional):</span>
                      <NumInput value={ma.fixedDipPct} onChange={v => updateMa(ma.id, 'fixedDipPct', v)} min={0} max={20} step={0.1} className="w-14" />
                    </div>
                  )}
                </div>
              ))}
              {!form.maConditions.length && <p className="text-[9px] text-p5/35">Nenhum filtro — entrada só por RSI.</p>}
            </div>
          </div>

          {/* Extensão */}
          <div>
            <SectionHeader label="Extensão acima da MA" />
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={form.extension.enabled} onChange={e => patch('extension.enabled', e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">Ativar regra de extensão</span>
            </label>
            {form.extension.enabled && (
              <>
                <div className="flex gap-1.5 mb-2 items-center flex-wrap">
                  <span className="text-[10px] text-p5/40">Referência:</span>
                  <select value={form.extension.maPeriod} onChange={e => patch('extension.maPeriod', Number(e.target.value))}
                    className="w-14 rounded px-1 py-1 text-[10px] font-mono" style={sel}>
                    {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                  </select>
                  <select value={form.extension.maInterval} onChange={e => patch('extension.maInterval', e.target.value)}
                    className="w-12 rounded px-1 py-1 text-[10px]" style={sel}>
                    {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </div>
                <div className="flex gap-1.5 mb-2 items-center flex-wrap">
                  <span className="text-[10px] text-p5/40">Se preço &gt;</span>
                  <NumInput value={form.extension.abovePct} onChange={v => patch('extension.abovePct', v)} min={0} max={30} step={0.5} />
                  <span className="text-[10px] text-p5/40">% acima da MA ref.</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mb-1">
                  <input type="checkbox" checked={form.extension.threeCandles} onChange={e => patch('extension.threeCandles', e.target.checked)} className="accent-violet-500" />
                  <span className="text-xs text-p5 flex-1">3 candles de alta seguidos</span>
                  <select value={form.extension.threeInterval ?? form.extension.confirmInterval ?? '1h'}
                    onChange={e => patch('extension.threeInterval', e.target.value)}
                    className="w-12 rounded px-1 py-1 text-[10px]" style={sel}>
                    {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 cursor-pointer mb-1">
                  <input type="checkbox" checked={form.extension.fourCandles} onChange={e => patch('extension.fourCandles', e.target.checked)} className="mt-0.5 accent-violet-500" />
                  <span className="text-xs text-p5 flex-1">3 altas + 1 queda</span>
                  <select value={form.extension.fourInterval ?? form.extension.confirmInterval ?? '1h'}
                    onChange={e => patch('extension.fourInterval', e.target.value)}
                    className="w-12 rounded px-1 py-1 text-[10px]" style={sel}>
                    {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </label>
                <select value={form.extension.confirmLogic} onChange={e => patch('extension.confirmLogic', e.target.value)}
                  className="w-full rounded px-2 py-1 text-[10px] text-p5 outline-none mt-1" style={sel}>
                  <option value="any">Basta uma regra (3 OU 4 candles)</option>
                  <option value="all">Exige ambas (3 E 4 candles)</option>
                </select>
              </>
            )}
          </div>

          {/* Saída RSI */}
          <div>
            <SectionHeader label="Saída RSI" color="#ef5350" />
            <div className="grid grid-cols-3 gap-1.5">
              <select value={form.exitRsi.interval} onChange={e => patch('exitRsi.interval', e.target.value)}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none cursor-pointer" style={sel}>
                {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
              <select value={form.exitRsi.period} onChange={e => patch('exitRsi.period', Number(e.target.value))}
                className="rounded px-1 py-1.5 text-xs text-p5 outline-none font-mono" style={sel}>
                {RSI_PERIODS.map(p => <option key={p} value={p}>p{p}</option>)}
              </select>
              <NumInput value={form.exitRsi.value} onChange={v => patch('exitRsi.value', v)} min={1} max={99} className="w-full" />
            </div>
            <p className="text-[9px] text-p5/35 mt-1">Vende quando RSI({form.exitRsi.interval}, {form.exitRsi.period}) &gt; {form.exitRsi.value}</p>
          </div>

          {/* Stop loss */}
          <div>
            <SectionHeader label="Stop Loss" />
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={form.stopLoss.enabled} onChange={e => patch('stopLoss.enabled', e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">Ativar stop por MA</span>
            </label>
            {form.stopLoss.enabled && (
              <div className="flex gap-1.5">
                <select value={form.stopLoss.period} onChange={e => patch('stopLoss.period', Number(e.target.value))}
                  className="w-16 rounded px-1 py-1.5 text-xs font-mono" style={sel}>
                  {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                </select>
                <select value={form.stopLoss.interval} onChange={e => patch('stopLoss.interval', e.target.value)}
                  className="flex-1 rounded px-2 py-1.5 text-xs" style={sel}>
                  {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Execução */}
          <div>
            <SectionHeader label="Execução da compra" />
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={form.execution.immediateEntry} onChange={e => patch('execution.immediateEntry', e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">Compra imediata (mercado)</span>
            </label>
            {!form.execution.immediateEntry && (
              <>
                <label className="block text-[10px] text-p5/40 mb-1">Desconto do alvo PENDING</label>
                <select value={form.execution.entryDiscount} onChange={e => patch('execution.entryDiscount', Number(e.target.value))}
                  className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none cursor-pointer mb-2" style={sel}>
                  {ENTRY_DISCOUNT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label} abaixo do gatilho</option>
                  ))}
                </select>
                <label className="block text-[10px] text-p5/40 mb-1">Timeout PENDING</label>
                <select value={form.execution.pendingTimeoutMs} onChange={e => patch('execution.pendingTimeoutMs', Number(e.target.value))}
                  className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none cursor-pointer mb-2" style={sel}>
                  {PENDING_TIMEOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <label className="block text-[10px] text-p5/40 mb-1">Cancela se preço subir (% acima do gatilho)</label>
                <NumInput value={(form.execution.pendingCancelPct * 100).toFixed(2)} onChange={v => patch('execution.pendingCancelPct', v / 100)}
                  min={0.1} max={5} step={0.1} className="w-full" />
              </>
            )}
          </div>

          {/* Volume */}
          <div>
            <SectionHeader label="Volume" />
            <select value={form.volume.minVolumeUsdt} onChange={e => patch('volume.minVolumeUsdt', Number(e.target.value))}
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
                  <label className="block text-[10px] text-p5/40 mb-1">Polling normal / rápido</label>
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
                  <label className="block text-[10px] text-p5/40 mb-1">RSI saída ≥ valor → polling rápido</label>
                  <NumInput value={form.polling.fastRsiThreshold} onChange={v => patch('polling.fastRsiThreshold', v)} min={50} max={95} className="w-full" />
                </div>
                <div>
                  <label className="block text-[10px] text-p5/40 mb-1">MA adaptativa — dip padrão / máx / mín / episódios</label>
                  <div className="grid grid-cols-4 gap-1">
                    <NumInput value={form.adaptiveOpts.defaultPct} onChange={v => patch('adaptiveOpts.defaultPct', v)} min={0} max={20} step={0.5} className="w-full" />
                    <NumInput value={form.adaptiveOpts.maxPct} onChange={v => patch('adaptiveOpts.maxPct', v)} min={0} max={30} step={0.5} className="w-full" />
                    <NumInput value={form.adaptiveOpts.minPct} onChange={v => patch('adaptiveOpts.minPct', v)} min={0} max={10} step={0.1} className="w-full" />
                    <NumInput value={form.adaptiveOpts.minEpisodes} onChange={v => patch('adaptiveOpts.minEpisodes', v)} min={1} max={20} className="w-full" />
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
          <button onClick={handleConfirm} disabled={!symbol.trim() || Number(capital) <= 0}
            className="flex-1 py-1.5 text-xs rounded font-semibold disabled:opacity-40" style={{ background: MT_COLOR, color: '#fff' }}>
            {isEditing ? 'Atualizar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
