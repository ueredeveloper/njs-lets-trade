import { useState, useCallback } from 'react';

const MT_COLOR      = '#8b5cf6';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

const RSI_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const MA_INTERVALS  = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const MA_PERIODS    = [50, 200];
const RSI_VALUES    = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];

const STRATEGY_MAP = {
  rsi15m_4h:       { label: 'RSI 15m + MA50 4h/1h (rsi15m_4h)',    bot: 'trading-rsi-15m-ma4h.js', hasRules: false, ma1hOn: false },
  rsi1m30_1m70_ma: { label: 'RSI 1m + MA50 1h (rsi1m30_1m70_ma)',  bot: 'trading-rsi-multi.js',    hasRules: true,  ma1hOn: true  },
  rsi1m30_1m70:    { label: 'RSI 1m puro (rsi1m30_1m70)',           bot: 'trading-rsi-multi.js',    hasRules: true,  ma1hOn: false },
};

function detectStrategy(entryInterval, maConditions) {
  const has4h = maConditions.some(m => m.interval === '4h');
  if (entryInterval === '15m' && has4h) return 'rsi15m_4h';
  const has1h = maConditions.some(m => m.interval === '1h');
  if (entryInterval === '1m' && has1h) return 'rsi1m30_1m70_ma';
  return 'rsi1m30_1m70';
}

function getSql({ symbol, exchange, strategyId, capital }) {
  return `INSERT INTO rsi_multi_bot_state (symbol, exchange, strategy_id, initial_capital, capital)\nVALUES ('${symbol}', '${exchange}', '${strategyId}', ${capital}, ${capital})\nON CONFLICT (symbol, strategy_id) DO NOTHING;`;
}

function getBacktestCmd({ symbol, exchange, strategyId, capital, rule3candles, rule4candles }) {
  const strat = STRATEGY_MAP[strategyId];
  if (!strat) return '';
  let cmd = `node backend/bot/rsi-ma50/${strat.bot} --backtest ${symbol} ${strategyId} ${exchange} ${capital}`;
  if (strat.hasRules) {
    cmd += ` ${strat.ma1hOn ? 'true' : 'false'} ${rule3candles ? 'true' : 'false'} ${rule4candles ? 'true' : 'false'}`;
  }
  return cmd;
}

function defaultMaConditions() {
  return [
    { id: 1, period: 50, interval: '4h', direction: 'above', adaptive: false },
    { id: 2, period: 50, interval: '1h', direction: 'above', adaptive: true  },
  ];
}

export { STRATEGY_MAP, getSql, getBacktestCmd };

export default function MultitradeModal({ symbol: initialSymbol, defaultExchange, currentEntry, onConfirm, onRemove, onCancel }) {
  const isEditing = !!currentEntry;
  const newId = useCallback(() => Date.now() + Math.random(), []);

  const [symbol, setSymbol]         = useState(currentEntry?.symbol ?? initialSymbol ?? '');
  const [exchange, setExchange]     = useState(currentEntry?.exchange ?? defaultExchange ?? 'binance');
  const [capital, setCapital]       = useState(currentEntry?.capital ?? 40);
  const [rule3candles, setRule3]    = useState(currentEntry?.rule3candles ?? false);
  const [rule4candles, setRule4]    = useState(currentEntry?.rule4candles ?? false);
  const [copied, setCopied]         = useState(null);

  const [entryInterval, setEntryInterval] = useState(currentEntry?.entryRsi?.interval ?? '15m');
  const [entryOp, setEntryOp]             = useState(currentEntry?.entryRsi?.operator  ?? '<');
  const [entryValue, setEntryValue]       = useState(currentEntry?.entryRsi?.value      ?? 30);

  const [exitInterval, setExitInterval] = useState(currentEntry?.exitRsi?.interval ?? '15m');
  const [exitOp, setExitOp]             = useState(currentEntry?.exitRsi?.operator  ?? '>');
  const [exitValue, setExitValue]       = useState(currentEntry?.exitRsi?.value      ?? 70);

  const [maConditions, setMaConditions] = useState(
    currentEntry?.maConditions ?? defaultMaConditions()
  );
  const [strategyOverride, setStrategyOverride] = useState(currentEntry?.strategyId ?? null);

  const autoStrategy = detectStrategy(entryInterval, maConditions);
  const strategyId   = strategyOverride ?? autoStrategy;
  const strat        = STRATEGY_MAP[strategyId];

  function addMa() {
    setMaConditions(prev => [...prev, { id: newId(), period: 50, interval: '1h', direction: 'above', adaptive: false }]);
  }
  function removeMa(id) { setMaConditions(prev => prev.filter(m => m.id !== id)); }
  function updateMa(id, field, value) {
    setMaConditions(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  }

  function handleConfirm() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || Number(capital) <= 0) return;
    onConfirm({
      symbol: sym,
      exchange,
      strategyId,
      capital: Number(capital),
      rule3candles,
      rule4candles,
      entryRsi: { interval: entryInterval, operator: entryOp, value: Number(entryValue) },
      exitRsi:  { interval: exitInterval,  operator: exitOp,  value: Number(exitValue)  },
      maConditions,
    });
  }

  const entry = { symbol: symbol.trim().toUpperCase(), exchange, strategyId, capital: Number(capital), rule3candles, rule4candles };
  const sql = getSql(entry);
  const cmd = getBacktestCmd(entry);
  const sel = { background: '#1e2130', border: '1px solid #2a2d3a' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={onCancel}
    >
      <div
        className="w-80 rounded-lg shadow-2xl border mx-4 my-auto"
        style={{ background: '#131722', borderColor: '#2a2d3a' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2a2d3a' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-p5">Multi-Trade</span>
            {symbol && <span className="text-xs font-mono font-bold" style={{ color: MT_COLOR }}>{symbol.toUpperCase()}</span>}
          </div>
          <button onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none transition-colors">×</button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4 max-h-[80vh] overflow-y-auto">

          {/* Symbol */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5">Símbolo</label>
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono uppercase"
              style={sel}
              placeholder="ex: NILUSDT"
            />
          </div>

          {/* Exchange */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5">Corretora</label>
            <div className="flex gap-2">
              {[{ id: 'gate', label: 'Gate.io', color: GATE_COLOR }, { id: 'binance', label: 'Binance', color: BINANCE_COLOR }].map(ex => {
                const active = exchange === ex.id;
                return (
                  <button key={ex.id} onClick={() => setExchange(ex.id)}
                    className="flex-1 py-1.5 text-xs rounded font-semibold transition-all"
                    style={{
                      background: active ? ex.color : 'transparent',
                      color: active ? (ex.id === 'binance' ? '#000' : '#fff') : ex.color,
                      border: `1px solid ${ex.color}`,
                      opacity: active ? 1 : 0.55,
                    }}>
                    {ex.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Capital */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1">Capital (USDT)</label>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)} min={1}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono" style={sel} />
          </div>

          {/* ── Entrada ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#26a69a' }}>Entrada</span>
              <div className="flex-1 h-px bg-p2" />
            </div>

            {/* RSI entrada */}
            <div className="mb-3">
              <label className="block text-[10px] text-p5/40 mb-1">RSI — gatilho de compra</label>
              <div className="flex gap-1.5">
                <select value={entryInterval}
                  onChange={e => { setEntryInterval(e.target.value); setStrategyOverride(null); }}
                  className="flex-1 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer" style={sel}>
                  {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
                <select value={entryOp} onChange={e => setEntryOp(e.target.value)}
                  className="w-12 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer font-mono" style={sel}>
                  <option value="<">&lt;</option>
                  <option value=">">&gt;</option>
                </select>
                <select value={entryValue} onChange={e => setEntryValue(Number(e.target.value))}
                  className="w-16 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer font-mono" style={sel}>
                  {RSI_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>

            {/* MA conditions */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-p5/40">Filtros MA</label>
                <button onClick={addMa}
                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: '#2a2d3a', color: MT_COLOR, border: `1px solid ${MT_COLOR}44` }}>
                  + MA
                </button>
              </div>
              <div className="space-y-1.5">
                {maConditions.length === 0 && (
                  <p className="text-[10px] text-p5/30 italic">Nenhum filtro de média móvel</p>
                )}
                {maConditions.map(ma => (
                  <div key={ma.id} className="flex gap-1 items-center">
                    <select value={ma.period}
                      onChange={e => { updateMa(ma.id, 'period', Number(e.target.value)); setStrategyOverride(null); }}
                      className="w-16 rounded px-1.5 py-1 text-[10px] text-p5 outline-none appearance-none cursor-pointer font-mono" style={sel}>
                      {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                    </select>
                    <select value={ma.interval}
                      onChange={e => { updateMa(ma.id, 'interval', e.target.value); setStrategyOverride(null); }}
                      className="w-14 rounded px-1.5 py-1 text-[10px] text-p5 outline-none appearance-none cursor-pointer" style={sel}>
                      {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                    <select value={ma.direction} onChange={e => updateMa(ma.id, 'direction', e.target.value)}
                      className="w-16 rounded px-1.5 py-1 text-[10px] text-p5 outline-none appearance-none cursor-pointer" style={sel}>
                      <option value="above">acima</option>
                      <option value="below">abaixo</option>
                    </select>
                    <button
                      onClick={() => updateMa(ma.id, 'adaptive', !ma.adaptive)}
                      className="flex-1 text-[10px] py-1 rounded transition-colors whitespace-nowrap"
                      style={{
                        background: ma.adaptive ? '#8b5cf622' : '#2a2d3a',
                        color: ma.adaptive ? MT_COLOR : '#64748b',
                        border: `1px solid ${ma.adaptive ? MT_COLOR : '#3a3d4a'}`,
                      }}>
                      {ma.adaptive ? 'adapt.' : 'fixo'}
                    </button>
                    <button onClick={() => { removeMa(ma.id); setStrategyOverride(null); }}
                      className="text-p5/30 hover:text-red-400 w-5 h-5 flex items-center justify-center rounded text-sm"
                      style={{ background: '#2a2d3a' }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Saída ──────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#ef5350' }}>Saída</span>
              <div className="flex-1 h-px bg-p2" />
            </div>
            <div>
              <label className="block text-[10px] text-p5/40 mb-1">RSI — gatilho de venda</label>
              <div className="flex gap-1.5">
                <select value={exitInterval} onChange={e => setExitInterval(e.target.value)}
                  className="flex-1 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer" style={sel}>
                  {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                </select>
                <select value={exitOp} onChange={e => setExitOp(e.target.value)}
                  className="w-12 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer font-mono" style={sel}>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                </select>
                <select value={exitValue} onChange={e => setExitValue(Number(e.target.value))}
                  className="w-16 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer font-mono" style={sel}>
                  {RSI_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Regras ────────────────────────────────────────── */}
          {strat?.hasRules && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-p5/40">Regras Opcionais</span>
                <div className="flex-1 h-px bg-p2" />
              </div>
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={rule3candles} onChange={e => setRule3(e.target.checked)} className="mt-0.5 accent-violet-500" />
                  <div>
                    <span className="text-xs text-p5 font-medium">Regra 3 — 3 candles de alta (1h)</span>
                    <p className="text-[10px] text-p5/40 mt-0.5">Os 3 candles anteriores em 1h devem ser bullish</p>
                  </div>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={rule4candles} onChange={e => setRule4(e.target.checked)} className="mt-0.5 accent-violet-500" />
                  <div>
                    <span className="text-xs text-p5 font-medium">Regra 4 — padrão baixa+alta×2 (1h)</span>
                    <p className="text-[10px] text-p5/40 mt-0.5">1 candle bearish seguido de 2 candles bullish</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* ── Estratégia (Bot) ──────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold text-p5/40">Estratégia (Bot)</span>
              <div className="flex-1 h-px bg-p2" />
            </div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] text-p5/40">Auto:</span>
              <span className="text-[10px] font-mono font-semibold" style={{ color: MT_COLOR }}>{autoStrategy}</span>
            </div>
            <select value={strategyId} onChange={e => setStrategyOverride(e.target.value)}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer" style={sel}>
              {Object.entries(STRATEGY_MAP).map(([id, s]) => (
                <option key={id} value={id}>{s.label}</option>
              ))}
            </select>
            {strategyOverride && strategyOverride !== autoStrategy && (
              <button onClick={() => setStrategyOverride(null)} className="text-[10px] mt-1 text-p5/40 hover:text-p5 underline">
                Usar auto ({autoStrategy})
              </button>
            )}
          </div>

          {/* ── SQL ─────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-p5/40">SQL — Supabase</span>
              <button onClick={() => copy(sql, 'sql')}
                className="text-[10px] px-2 py-0.5 rounded transition-colors"
                style={{ background: copied === 'sql' ? '#26a69a' : '#2a2d3a', color: copied === 'sql' ? '#fff' : '#94a3b8' }}>
                {copied === 'sql' ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="text-[9px] font-mono text-p5/60 rounded px-2 py-2 overflow-x-auto whitespace-pre-wrap break-all"
              style={{ background: '#0d1117', border: '1px solid #2a2d3a' }}>
              {sql}
            </pre>
          </div>

          {/* ── Backtest ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-p5/40">Comando Backtest</span>
              <button onClick={() => copy(cmd, 'cmd')}
                className="text-[10px] px-2 py-0.5 rounded transition-colors"
                style={{ background: copied === 'cmd' ? '#26a69a' : '#2a2d3a', color: copied === 'cmd' ? '#fff' : '#94a3b8' }}>
                {copied === 'cmd' ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="text-[9px] font-mono text-p5/60 rounded px-2 py-2 overflow-x-auto whitespace-pre-wrap break-all"
              style={{ background: '#0d1117', border: '1px solid #2a2d3a' }}>
              {cmd}
            </pre>
          </div>

        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 pb-4 pt-2 border-t" style={{ borderColor: '#2a2d3a' }}>
          {isEditing ? (
            <button onClick={onRemove} className="flex-1 py-1.5 text-xs rounded font-medium"
              style={{ border: '1px solid #ef5350', color: '#ef5350' }}>
              Remover
            </button>
          ) : (
            <button onClick={onCancel} className="flex-1 py-1.5 text-xs rounded font-medium text-p5/50 hover:text-p5"
              style={{ border: '1px solid #2a2d3a' }}>
              Cancelar
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!symbol.trim() || Number(capital) <= 0}
            className="flex-1 py-1.5 text-xs rounded font-semibold disabled:opacity-40"
            style={{ background: MT_COLOR, color: '#fff' }}>
            {isEditing ? 'Atualizar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
