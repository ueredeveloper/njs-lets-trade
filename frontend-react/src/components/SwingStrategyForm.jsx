import {
  RSI_INTERVALS, MA_INTERVALS, MA_PERIODS, RSI_PERIODS, RSI_OPERATORS, ENTRY_MA_TRIGGERS,
} from '../constants/tradeConfigSchema';

const ENTRY_COLOR = '#26a69a';
const EXIT_COLOR  = '#ef5350';
const MA_COLOR    = '#ec4899';

function NumInput({ value, onChange, min, max, step = 1, className = 'w-16' }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className={`rounded px-2 py-1 text-xs text-p5 outline-none font-mono ${className}`}
      style={{ background: '#1e2130', border: '1px solid #2a2d3a' }} />
  );
}

function RsiFields({ rsi, onPatch, label, color }) {
  return (
    <div className="space-y-2">
      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <span className="text-p5/50">RSI</span>
        <select value={rsi.interval} onChange={e => onPatch('interval', e.target.value)}
          className="rounded px-1.5 py-1 text-xs" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
          {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
        </select>
        <select value={rsi.period} onChange={e => onPatch('period', Number(e.target.value))}
          className="rounded px-1.5 py-1 text-xs" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
          {RSI_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={rsi.operator} onChange={e => onPatch('operator', e.target.value)}
          className="rounded px-1.5 py-1 text-xs" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
          {RSI_OPERATORS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <NumInput value={rsi.value} onChange={v => onPatch('value', v)} min={5} max={95} />
      </div>
    </div>
  );
}

export default function SwingStrategyForm({
  form, patch, strategyId, symbol, exchange,
  onSuggestEntryRsi, onSuggestExitRsi, entryRsiSuggest, exitRsiSuggest,
}) {
  const isRsi = form.kind === 'rsi' || strategyId === 'swing-rsi-1h';
  const patchRsi = (key, field, val) => patch(`${key}.${field}`, val);
  const patchMaFilter = (field, val) => patch(`entryMaFilter.${field}`, val);
  const patchEntryMa = (field, val) => patch(`entryMa.${field}`, val);

  return (
    <div className="space-y-4">
      {isRsi ? (
        <>
          <RsiFields
            rsi={form.entryRsi}
            onPatch={(f, v) => patchRsi('entryRsi', f, v)}
            label="Entrada — RSI"
            color={ENTRY_COLOR}
          />
          <button type="button" onClick={onSuggestEntryRsi}
            className="text-[10px] px-2 py-1 rounded font-semibold"
            style={{ background: `${ENTRY_COLOR}22`, color: ENTRY_COLOR, border: `1px solid ${ENTRY_COLOR}55` }}>
            Sugerir entrada (histórico)
          </button>
          {entryRsiSuggest?.entryRsiValue != null && (
            <p className="text-[10px] text-p5/60">
              Sugestão: RSI &lt; {entryRsiSuggest.entryRsiValue}
              {entryRsiSuggest.recommendation === 'manter' ? ' (manter)' : ''}
            </p>
          )}
          {entryRsiSuggest?.error && <p className="text-[10px] text-red-400">{entryRsiSuggest.error}</p>}

          <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
            <label className="flex items-center gap-2 text-xs text-p5">
              <input type="checkbox" checked={form.entryMaFilter.enabled}
                onChange={e => patchMaFilter('enabled', e.target.checked)} className="accent-pink-500" />
              Só entra se preço acima da MA
            </label>
            {form.entryMaFilter.enabled && (
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <span className="text-p5/50">MA</span>
                <select value={form.entryMaFilter.period} onChange={e => patchMaFilter('period', Number(e.target.value))}
                  className="rounded px-1.5 py-1" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
                  {MA_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={form.entryMaFilter.interval} onChange={e => patchMaFilter('interval', e.target.value)}
                  className="rounded px-1.5 py-1" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
                  {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MA_COLOR }}>Entrada — MA</span>
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <span className="text-p5/50">MA</span>
            <select value={form.entryMa.period} onChange={e => patchEntryMa('period', Number(e.target.value))}
              className="rounded px-1.5 py-1" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
              {MA_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={form.entryMa.interval} onChange={e => patchEntryMa('interval', e.target.value)}
              className="rounded px-1.5 py-1" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
              {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
            </select>
            <select value={form.entryMa.trigger} onChange={e => patchEntryMa('trigger', e.target.value)}
              className="rounded px-1.5 py-1" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
              {ENTRY_MA_TRIGGERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 text-xs text-p5">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={form.entryMa.aboveMaEnabled}
                onChange={e => patchEntryMa('aboveMaEnabled', e.target.checked)} />
              {form.entryMa.aboveMaCandles} candles acima antes
            </label>
            <NumInput value={form.entryMa.aboveMaCandles} onChange={v => patchEntryMa('aboveMaCandles', v)} min={0} max={20} className="w-12" />
          </div>
        </div>
      )}

      <RsiFields
        rsi={form.exitRsi}
        onPatch={(f, v) => patchRsi('exitRsi', f, v)}
        label="Saída — RSI"
        color={EXIT_COLOR}
      />
      <button type="button" onClick={onSuggestExitRsi}
        className="text-[10px] px-2 py-1 rounded font-semibold"
        style={{ background: `${EXIT_COLOR}22`, color: EXIT_COLOR, border: `1px solid ${EXIT_COLOR}55` }}>
        Sugerir saída (histórico)
      </button>
      {exitRsiSuggest?.exitRsiValue != null && (
        <p className="text-[10px] text-p5/60">Sugestão: RSI &gt; {exitRsiSuggest.exitRsiValue}</p>
      )}
      {exitRsiSuggest?.error && <p className="text-[10px] text-red-400">{exitRsiSuggest.error}</p>}

      <div className="flex items-center gap-2 text-xs text-p5">
        <span className="text-p5/50">Stop-loss</span>
        <NumInput value={form.stopLoss.maxLossPct} onChange={v => patch('stopLoss.maxLossPct', v)} min={1} max={20} step={0.5} />
        <span className="text-p5/40">%</span>
      </div>

      <p className="text-[9px] text-p5/35">
        Bot: <code className="text-p5/50">node backend/bot/swing/swing-bot.js</code>
        {symbol && <> — {symbol} [{strategyId}]</>}
      </p>
    </div>
  );
}
