import { useState, useCallback, useEffect } from 'react';
import { checkMultitradeVolume } from '../services/api';

const MT_COLOR      = '#8b5cf6';
const GATE_COLOR    = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

const RSI_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const MA_INTERVALS  = ['15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const MA_PERIODS    = [50, 200];
const RSI_ENTRY     = [25, 30, 35, 40, 45];
const RSI_EXIT      = [65, 70, 75, 80, 85];
const STOP_INTERVALS = ['1h', '4h'];
const ENTRY_DISCOUNT_OPTIONS = [
  { label: '0,1% abaixo', value: 0.001 },
  { label: '0,5% abaixo', value: 0.005 },
  { label: '1% abaixo',   value: 0.01  },
  { label: '2% abaixo',   value: 0.02  },
];
const VOLUME_OPTIONS = [
  { label: '1M',  value: 1_000_000 },
  { label: '3M',  value: 3_000_000 },
  { label: '5M',  value: 5_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '50M', value: 50_000_000 },
];

function defaultMaConditions() {
  return [
    { id: 1, period: 50, interval: '4h', direction: 'above', adaptive: false },
    { id: 2, period: 50, interval: '1h', direction: 'above', adaptive: true  },
  ];
}

function getBacktestCmd({ symbol, exchange, capital }) {
  return `node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest ${symbol} saved ${exchange} ${capital}`;
}

function getAdaptiveTestCmd({ symbol, exchange, maConditions }) {
  const intervals = [...new Set(
    (maConditions ?? []).filter(m => m.adaptive).map(m => m.interval),
  )];
  const ivs = intervals.length ? intervals.join(' ') : '1h 4h';
  return `node backend/bot/rsi-ma50/trading-rsi-multi.js --adaptive-test ${symbol} ${exchange} ${ivs}`;
}

function hasAdaptiveMa(maConditions) {
  return (maConditions ?? []).some(m => m.adaptive);
}

export { getBacktestCmd, getAdaptiveTestCmd, hasAdaptiveMa };

export default function MultitradeModal({ symbol: initialSymbol, defaultExchange, currentEntry, onConfirm, onRemove, onCancel }) {
  const isEditing = !!currentEntry;
  const newId = useCallback(() => Date.now() + Math.random(), []);

  const [symbol, setSymbol]         = useState(currentEntry?.symbol ?? initialSymbol ?? '');
  const [exchange, setExchange]     = useState(currentEntry?.exchange ?? defaultExchange ?? 'binance');
  const [capital, setCapital]       = useState(currentEntry?.capital ?? 40);
  const [rule3candles, setRule3]    = useState(currentEntry?.rule3candles ?? true);
  const [rule4candles, setRule4]    = useState(currentEntry?.rule4candles ?? true);
  const [extensionPct, setExtensionPct] = useState(currentEntry?.extension?.abovePct ?? 5);
  const [extensionIv, setExtensionIv]   = useState(currentEntry?.extension?.confirmInterval ?? '1h');
  const [stopLossIv, setStopLossIv]     = useState(currentEntry?.stopLoss?.interval ?? '1h');
  const [immediateEntry, setImmediate]  = useState(currentEntry?.immediateEntry ?? false);
  const [entryDiscount, setEntryDiscount] = useState(
    currentEntry?.tradeConfig?.entryDiscount ?? currentEntry?.entryDiscount ?? 0.001,
  );
  const [minVolumeUsdt, setMinVolumeUsdt] = useState(
    currentEntry?.minVolumeUsdt ?? currentEntry?.tradeConfig?.minVolumeUsdt ?? 1_000_000,
  );
  const [allowLowVolume, setAllowLowVolume] = useState(
    currentEntry?.allowLowVolume ?? currentEntry?.tradeConfig?.allowLowVolume ?? false,
  );
  const [volCheck, setVolCheck]         = useState(null);
  const [volumeWarnOpen, setVolumeWarnOpen] = useState(false);
  const [copied, setCopied]         = useState(null);

  const [entryInterval, setEntryInterval] = useState(currentEntry?.entryRsi?.interval ?? '15m');
  const [entryValue, setEntryValue]       = useState(currentEntry?.entryRsi?.value      ?? 30);

  const [exitInterval, setExitInterval] = useState(currentEntry?.exitRsi?.interval ?? '15m');
  const [exitValue, setExitValue]       = useState(currentEntry?.exitRsi?.value      ?? 70);

  const [maConditions, setMaConditions] = useState(
    currentEntry?.maConditions ?? defaultMaConditions(),
  );

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) { setVolCheck(null); return undefined; }

    let cancelled = false;
    setVolCheck({ loading: true });

    const timer = setTimeout(() => {
      checkMultitradeVolume(sym, exchange, minVolumeUsdt)
        .then(data => { if (!cancelled) setVolCheck({ ...data, loading: false }); })
        .catch(err => { if (!cancelled) setVolCheck({ loading: false, error: err.message }); });
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, exchange, minVolumeUsdt]);

  useEffect(() => { setVolumeWarnOpen(false); }, [symbol, exchange, minVolumeUsdt]);

  useEffect(() => {
    if (volCheck?.meetsMin) setAllowLowVolume(false);
  }, [volCheck?.meetsMin]);

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

  function buildPayload() {
    const sym = symbol.trim().toUpperCase();
    return {
      symbol: sym,
      exchange,
      strategyId: 'flex',
      capital: Number(capital),
      minVolumeUsdt: Number(minVolumeUsdt),
      allowLowVolume: !!allowLowVolume,
      rule3candles,
      rule4candles,
      immediateEntry,
      entryDiscount: Number(entryDiscount),
      entryRsi: { interval: entryInterval, operator: '<', value: Number(entryValue) },
      exitRsi:  { interval: exitInterval,  operator: '>', value: Number(exitValue)  },
      maConditions,
      stopLoss: { period: 50, interval: stopLossIv },
      extension: { abovePct: Number(extensionPct), confirmInterval: extensionIv },
    };
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
    setAllowLowVolume(true);
    setVolumeWarnOpen(false);
    onConfirm({ ...buildPayload(), allowLowVolume: true });
  }

  const payload = { symbol: symbol.trim().toUpperCase(), exchange, capital: Number(capital), maConditions };
  const cmd       = getBacktestCmd({ ...payload, capital: Number(capital) });
  const adaptCmd  = getAdaptiveTestCmd(payload);
  const showAdaptive = hasAdaptiveMa(maConditions);
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
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2a2d3a' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-p5">AMAP Multi-Trade</span>
            {symbol && <span className="text-xs font-mono font-bold" style={{ color: MT_COLOR }}>{symbol.toUpperCase()}</span>}
          </div>
          <button onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none transition-colors">×</button>
        </div>

        <div className="px-4 py-4 space-y-4 max-h-[80vh] overflow-y-auto">

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5">Símbolo</label>
            <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none font-mono uppercase" style={sel} placeholder="ex: BTCUSDT" />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1.5">Corretora</label>
            <div className="flex gap-2">
              {[{ id: 'gate', label: 'Gate.io', color: GATE_COLOR }, { id: 'binance', label: 'Binance', color: BINANCE_COLOR }].map(ex => (
                <button key={ex.id} onClick={() => setExchange(ex.id)}
                  className="flex-1 py-1.5 text-xs rounded font-semibold transition-all"
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

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-p5/50 mb-1">Volume mínimo 24h</label>
            <select value={minVolumeUsdt} onChange={e => setMinVolumeUsdt(Number(e.target.value))}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer font-mono" style={sel}>
              {VOLUME_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label} USDT</option>
              ))}
            </select>
            {symbol.trim() && (
              <p className="text-[10px] mt-1.5 font-mono" style={{
                color: volCheck?.loading ? '#94a3b8'
                  : volCheck?.error ? '#ef5350'
                  : volCheck?.meetsMin === false ? '#f59e0b'
                  : volCheck?.meetsMin ? '#26a69a' : '#94a3b8',
              }}>
                {volCheck?.loading && 'Verificando volume 24h…'}
                {volCheck?.error && `Erro: ${volCheck.error}`}
                {!volCheck?.loading && !volCheck?.error && volCheck && (
                  volCheck.meetsMin
                    ? `Volume atual: ${volCheck.volumeFmt} — atende mínimo ${volCheck.minVolumeFmt}`
                    : `Volume atual: ${volCheck.volumeFmt} — abaixo do mínimo ${volCheck.minVolumeFmt}`
                )}
              </p>
            )}
          </div>

          {/* Entrada */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#26a69a' }}>Entrada</span>
              <div className="flex-1 h-px bg-p2" />
            </div>
            <label className="block text-[10px] text-p5/40 mb-1">RSI &lt; limiar</label>
            <div className="flex gap-1.5">
              <select value={entryInterval} onChange={e => setEntryInterval(e.target.value)}
                className="flex-1 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer" style={sel}>
                {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
              <select value={entryValue} onChange={e => setEntryValue(Number(e.target.value))}
                className="w-16 rounded px-2 py-1.5 text-xs text-p5 outline-none font-mono" style={sel}>
                {RSI_ENTRY.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* Filtros MA */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] text-p5/40">Filtros MA50</label>
              <button onClick={addMa} className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: '#2a2d3a', color: MT_COLOR, border: `1px solid ${MT_COLOR}44` }}>+ MA</button>
            </div>
            <p className="text-[9px] text-p5/35 mb-2 leading-relaxed">
              <strong className="text-p5/50">fixo</strong> — preço deve estar acima da MA.
              <strong className="text-p5/50"> adapt.</strong> — permite até X% <em>abaixo</em> da MA (X = média dos dips
              históricos que voltaram acima; ex.: caiu 3% abaixo da MA50 1h e retomou). Não é regra de % acima.
            </p>
            <div className="space-y-1.5">
              {maConditions.map(ma => (
                <div key={ma.id} className="flex gap-1 items-center">
                  <select value={ma.period} onChange={e => updateMa(ma.id, 'period', Number(e.target.value))}
                    className="w-14 rounded px-1 py-1 text-[10px] text-p5 outline-none font-mono" style={sel}>
                    {MA_PERIODS.map(p => <option key={p} value={p}>MA{p}</option>)}
                  </select>
                  <select value={ma.interval} onChange={e => updateMa(ma.id, 'interval', e.target.value)}
                    className="w-12 rounded px-1 py-1 text-[10px] text-p5 outline-none" style={sel}>
                    {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                  <button onClick={() => updateMa(ma.id, 'adaptive', !ma.adaptive)}
                    className="flex-1 text-[10px] py-1 rounded whitespace-nowrap"
                    style={{
                      background: ma.adaptive ? '#8b5cf622' : '#2a2d3a',
                      color: ma.adaptive ? MT_COLOR : '#64748b',
                      border: `1px solid ${ma.adaptive ? MT_COLOR : '#3a3d4a'}`,
                    }}>{ma.adaptive ? 'adapt.' : 'fixo'}</button>
                  <button onClick={() => removeMa(ma.id)}
                    className="text-p5/30 hover:text-red-400 w-5 h-5 flex items-center justify-center rounded text-sm" style={{ background: '#2a2d3a' }}>×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Extensão — preço muito ACIMA da MA (diferente do adaptativo) */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold text-p5/40">Extensão acima da MA</span>
              <div className="flex-1 h-px bg-p2" />
            </div>
            <p className="text-[9px] text-p5/35 mb-2 leading-relaxed">
              O % acima é medido na MA adaptativa principal (ex. MA50 1h). Só quando o preço está{' '}
              <strong>muito esticado acima</strong> dessa MA (não abaixo). Se passar do limiar,
              exige confirmação de candles antes de entrar — evita comprar no topo de um impulso.
            </p>
            <div className="flex gap-1.5 mb-2 items-center flex-wrap">
              <span className="text-[10px] text-p5/40 shrink-0">Se preço &gt;</span>
              <input type="number" value={extensionPct} onChange={e => setExtensionPct(e.target.value)} min={1} max={20} step={0.5}
                className="w-14 rounded px-2 py-1 text-xs text-p5 outline-none font-mono" style={sel} />
              <span className="text-[10px] text-p5/40">% acima da MA → exige candles em</span>
              <select value={extensionIv} onChange={e => setExtensionIv(e.target.value)}
                className="w-12 rounded px-1 py-1 text-[10px] text-p5 outline-none" style={sel}>
                {MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={rule3candles} onChange={e => setRule3(e.target.checked)} className="mt-0.5 accent-violet-500" />
                <span className="text-xs text-p5">Regra 3 — 3 candles de alta seguidos</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={rule4candles} onChange={e => setRule4(e.target.checked)} className="mt-0.5 accent-violet-500" />
                <span className="text-xs text-p5">Regra 4 — 3 altas + 1 queda</span>
              </label>
            </div>
          </div>

          {/* Saída */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#ef5350' }}>Saída</span>
              <div className="flex-1 h-px bg-p2" />
            </div>
            <label className="block text-[10px] text-p5/40 mb-1">RSI &gt; limiar</label>
            <div className="flex gap-1.5">
              <select value={exitInterval} onChange={e => setExitInterval(e.target.value)}
                className="flex-1 rounded px-2 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer" style={sel}>
                {RSI_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
              <select value={exitValue} onChange={e => setExitValue(Number(e.target.value))}
                className="w-16 rounded px-2 py-1.5 text-xs text-p5 outline-none font-mono" style={sel}>
                {RSI_EXIT.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* Stop loss */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold text-p5/40">Stop Loss</span>
              <div className="flex-1 h-px bg-p2" />
            </div>
            <label className="block text-[10px] text-p5/40 mb-1">Vende se preço fechar abaixo de MA50</label>
            <select value={stopLossIv} onChange={e => setStopLossIv(e.target.value)}
              className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer" style={sel}>
              {STOP_INTERVALS.map(iv => <option key={iv} value={iv}>MA50 ({iv})</option>)}
            </select>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold text-p5/40">Execução da compra</span>
              <div className="flex-1 h-px bg-p2" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={immediateEntry} onChange={e => setImmediate(e.target.checked)} className="accent-violet-500" />
              <span className="text-xs text-p5">Compra imediata ao sinal (preço de mercado)</span>
            </label>
            {!immediateEntry && (
              <div>
                <label className="block text-[10px] text-p5/40 mb-1">Alvo de entrada (PENDING)</label>
                <select value={entryDiscount} onChange={e => setEntryDiscount(Number(e.target.value))}
                  className="w-full rounded px-2.5 py-1.5 text-xs text-p5 outline-none appearance-none cursor-pointer" style={sel}>
                  {ENTRY_DISCOUNT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label} do preço de gatilho</option>
                  ))}
                </select>
                <p className="text-[9px] text-p5/35 mt-1">RSI atende → aguarda o preço cair até o alvo antes de comprar.</p>
              </div>
            )}
          </div>

          {/* Backtest */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-p5/40">Comando Backtest</span>
              <button onClick={() => copy(cmd, 'cmd')} className="text-[10px] px-2 py-0.5 rounded"
                style={{ background: copied === 'cmd' ? '#26a69a' : '#2a2d3a', color: copied === 'cmd' ? '#fff' : '#94a3b8' }}>
                {copied === 'cmd' ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="text-[9px] font-mono text-p5/60 rounded px-2 py-2 overflow-x-auto whitespace-pre-wrap break-all"
              style={{ background: '#0d1117', border: '1px solid #2a2d3a' }}>{cmd}</pre>
          </div>

          {showAdaptive && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-p5/40">Teste de Adaptação</span>
                <button onClick={() => copy(adaptCmd, 'adapt')} className="text-[10px] px-2 py-0.5 rounded"
                  style={{ background: copied === 'adapt' ? '#26a69a' : '#2a2d3a', color: copied === 'adapt' ? '#fff' : '#94a3b8' }}>
                  {copied === 'adapt' ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="text-[10px] text-p5/45 mb-2">
                Calcula quanto a moeda costuma cair <em>abaixo</em> de cada MA adaptativa e voltar (não tem relação com os % acima da MA na seção Extensão).
              </p>
              <pre className="text-[9px] font-mono text-p5/60 rounded px-2 py-2 overflow-x-auto whitespace-pre-wrap break-all"
                style={{ background: '#0d1117', border: '1px solid #2a2d3a' }}>{adaptCmd}</pre>
            </div>
          )}
        </div>

        {volumeWarnOpen && volCheck && !volCheck.meetsMin && (
          <div className="mx-4 mb-2 rounded border px-3 py-2.5 space-y-2"
            style={{ background: '#f59e0b18', borderColor: '#f59e0b66' }}>
            <p className="text-xs text-p5 leading-relaxed">
              <strong className="text-amber-400">Volume insuficiente.</strong>{' '}
              {symbol.toUpperCase()} tem {volCheck.volumeFmt} em 24h, abaixo do mínimo {volCheck.minVolumeFmt}.
              O bot operará normalmente; na saída usará <strong>venda a mercado</strong> para garantir liquidação.
              Deseja salvar mesmo assim?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setVolumeWarnOpen(false)}
                className="flex-1 py-1.5 text-xs rounded font-medium"
                style={{ border: '1px solid #2a2d3a', color: '#94a3b8' }}>Não</button>
              <button onClick={handleConfirmDespiteVolume}
                className="flex-1 py-1.5 text-xs rounded font-semibold"
                style={{ background: '#f59e0b', color: '#000' }}>Sim, continuar</button>
            </div>
          </div>
        )}

        <div className="flex gap-2 px-4 pb-4 pt-2 border-t" style={{ borderColor: '#2a2d3a' }}>
          {isEditing ? (
            <button onClick={onRemove} className="flex-1 py-1.5 text-xs rounded font-medium"
              style={{ border: '1px solid #ef5350', color: '#ef5350' }}>Remover</button>
          ) : (
            <button onClick={onCancel} className="flex-1 py-1.5 text-xs rounded font-medium text-p5/50"
              style={{ border: '1px solid #2a2d3a' }}>Cancelar</button>
          )}
          <button onClick={handleConfirm} disabled={!symbol.trim() || Number(capital) <= 0}
            className="flex-1 py-1.5 text-xs rounded font-semibold disabled:opacity-40"
            style={{ background: MT_COLOR, color: '#fff' }}>
            {isEditing ? 'Atualizar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
