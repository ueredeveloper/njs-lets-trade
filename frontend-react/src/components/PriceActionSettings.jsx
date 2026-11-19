import { useEffect, useState } from 'react';
import { getPriceActionConfig, savePriceActionConfig } from '../services/api';

// Configurações → Price action: config do bot "Explosão de Alta automática"
// (backend/bot/breakout-auto/priceActionConfig.js). O bot relê a cada varredura (15 min), então a
// mudança salva vale sem reiniciar. Padrão = a configuração validada na caixa Price action do gráfico.

const REGIME_FIELDS = [
  { key: 'btcEma50_4h', label: 'BTC 4h acima da EMA50', hint: 'o mercado em alta no 4h' },
  { key: 'coinEma20_1d', label: 'Moeda acima da EMA20 1d', hint: 'fechamento diário da moeda acima da média de 20 dias' },
  { key: 'coinMacd4h', label: 'MACD 4h da moeda > 0', hint: 'histograma MACD(12,26,9) 4h positivo' },
  { key: 'btcEma20_1dRising', label: 'Período de baixa: EMA20 1d do BTC subindo', hint: 'só entra com a EMA20 diária do BTC acima da de 5 dias antes' },
];

function NumField({ label, value, onChange, min, max, step = 1, suffix, inp }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-p5/50">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number" min={min} max={max} step={step}
          className={`${inp} w-full`}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="text-[10px] text-p5/50">{suffix}</span>}
      </div>
    </label>
  );
}

export default function PriceActionSettings({ open, inp }) {
  const [cfg, setCfg] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState(null); // null | 'saving' | 'saved' | erro (string)

  useEffect(() => {
    if (!open || cfg) return;
    getPriceActionConfig().then(setCfg).catch((err) => setLoadError(err.message));
  }, [open, cfg]);

  const patch = (p) => setCfg((prev) => ({ ...prev, ...p }));
  const patchRegime = (p) => setCfg((prev) => ({ ...prev, regime: { ...prev.regime, ...p } }));

  async function save() {
    setSaveState('saving');
    try {
      setCfg(await savePriceActionConfig(cfg));
      setSaveState('saved');
      setTimeout(() => setSaveState((s) => (s === 'saved' ? null : s)), 2000);
    } catch (err) {
      setSaveState(err.message || 'erro ao salvar');
    }
  }

  if (loadError) return <p className="text-[10px] text-red-400">Erro ao carregar: {loadError}</p>;
  if (!cfg) return <p className="text-[10px] text-p5/40">Carregando…</p>;

  const rg = cfg.regime;
  return (
    <div className="flex flex-col gap-3">
      {cfg.tableMissing && (
        <p className="text-[10px] text-amber-300 leading-relaxed">
          Tabela ainda não criada — rode <code>supabase/add-price-action-bot-config.sql</code> no Supabase pra salvar.
          Enquanto isso o bot usa estes valores padrão.
        </p>
      )}
      {!cfg.tableMissing && !cfg.saved && (
        <p className="text-[10px] text-p5/40">Nunca salva — o bot está usando estes valores padrão.</p>
      )}

      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="mt-0.5 shrink-0 accent-p4" />
        <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
          Bot ligado
          <span className="block text-[10px] text-p5/40 mt-0.5 font-normal">desligado: para de criar ordens novas (as abertas continuam com a OCO)</span>
        </span>
      </label>

      <div className="rounded-md p-2.5" style={{ background: '#0f1a14', border: '1px solid #2a4a3a' }}>
        <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">Entrada (candle 4h)</p>
        <div className="grid grid-cols-2 gap-2">
          <NumField inp={inp} label="Corpo mínimo" suffix="%" min={0.5} max={50} step={0.5} value={cfg.minBodyPct} onChange={(v) => patch({ minBodyPct: v })} />
          <NumField inp={inp} label="Volume 24h mínimo" suffix="USDT" min={0} step={100000} value={cfg.minVolume24h} onChange={(v) => patch({ minVolume24h: v })} />
          <NumField inp={inp} label="Valor por ordem" suffix="USDT" min={6} step={1} value={cfg.usdt} onChange={(v) => patch({ usdt: v })} />
          <NumField inp={inp} label="Máx. ordens ao mesmo tempo" min={1} max={50} value={cfg.maxActive} onChange={(v) => patch({ maxActive: v })} />
        </div>
        <label className="flex items-center gap-2 mt-2 cursor-pointer">
          <input type="checkbox" checked={cfg.firstOfMove} onChange={(e) => patch({ firstOfMove: e.target.checked })} className="accent-p4" />
          <span className="text-[11px] text-p5">Só a 1ª explosão do movimento</span>
        </label>
        <p className="text-[10px] text-p5/40 mt-1 leading-relaxed">Compra a mercado no fechamento do candle: corpo ≥ mínimo ou padrão de alta, nunca padrão de baixa.</p>
      </div>

      <div className="rounded-md p-2.5" style={{ background: '#141018', border: '1px solid #3a2a4a' }}>
        <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">Saída (OCO)</p>
        <div className="grid grid-cols-2 gap-2">
          <NumField inp={inp} label="Alvo" suffix="%" min={1} max={200} step={0.5} value={cfg.targetPct} onChange={(v) => patch({ targetPct: v })} />
          <NumField inp={inp} label="Stop (mín. 10%)" suffix="%" min={10} max={90} step={0.5} value={cfg.stopPct} onChange={(v) => patch({ stopPct: v })} />
        </div>
      </div>

      <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
        <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">Filtros de mercado</p>
        <div className="flex flex-col gap-2">
          {REGIME_FIELDS.map((f) => (
            <label key={f.key} className="flex items-start gap-2 cursor-pointer group">
              <input type="checkbox" checked={!!rg[f.key]} onChange={(e) => patchRegime({ [f.key]: e.target.checked })} className="mt-0.5 shrink-0 accent-p4" />
              <span className="text-[11px] text-p5 leading-snug group-hover:text-white">
                {f.label}
                <span className="block text-[10px] text-p5/40">{f.hint}</span>
              </span>
            </label>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <NumField inp={inp} label="Entre as N maiores altas 24h (0 = off)" min={0} max={500} value={rg.topGainers} onChange={(v) => patchRegime({ topGainers: v })} />
            <NumField inp={inp} label="Volume 24h p/ o ranking" suffix="USDT" min={0} step={100000} value={rg.minVolume24h} onChange={(v) => patchRegime({ minVolume24h: v })} />
          </div>
        </div>
        <p className="text-[10px] text-p5/40 mt-2 leading-relaxed">
          Conferidos na varredura e de novo no fechamento do candle, só com candles 4h/1d já fechados. Falha ao buscar dados = não compra.
          Estudo (caixa Price action, 1000 candles 4h, +15%/−30%): 77 moedas +5,6%/trade; 20 maiores altas +6,9%; 40 +5,0% (com taxa).
        </p>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={save}
          disabled={saveState === 'saving'}
          className="px-3 py-1.5 rounded text-xs text-white bg-p3 hover:bg-p4 transition-colors disabled:opacity-50"
        >
          {saveState === 'saving' ? 'Salvando…' : 'Salvar'}
        </button>
        {saveState === 'saved' && <span className="text-[10px] text-emerald-400">Salvo — vale na próxima varredura (até 15 min)</span>}
        {saveState && !['saving', 'saved'].includes(saveState) && <span className="text-[10px] text-red-400">{saveState}</span>}
      </div>
    </div>
  );
}
