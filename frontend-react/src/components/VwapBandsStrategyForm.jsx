import {
  VWAP_BANDS_ALL_INTERVALS, VWAP_BANDS_SESSIONS, VWAP_BANDS_STOP_LOSS_MODES,
  EMA_FILTER_PERIODS, EMA_FILTER_TOLERANCES, EMA_FILTER_SLOPE_LOOKBACKS,
  VWAP_SLOPE_FILTER_LOOKBACKS,
} from '../constants/vwapBandsConfigSchema';

const ENTRY_COLOR = '#26a69a';
const EXIT_COLOR  = '#ef5350';

function NumInput({ value, onChange, min, max, step = 1, className = 'w-16' }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className={`rounded px-2 py-1 text-xs text-p5 outline-none font-mono ${className}`}
      style={{ background: '#1e2130', border: '1px solid #2a2d3a' }} />
  );
}

function Select({ value, onChange, options, labelFor }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="rounded px-1.5 py-1 text-xs" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}>
      {options.map(o => <option key={o} value={o}>{labelFor ? labelFor(o) : o}</option>)}
    </select>
  );
}

export default function VwapBandsStrategyForm({ form, patch, symbol }) {
  const patchEntry     = (field, val) => patch(`entry.${field}`, val);
  const patchPullback  = (field, val) => patch(`entry.pullback.${field}`, val);
  const patchEmaFilter = (field, val) => patch(`entry.emaFilter.${field}`, val);
  const patchVwapSlopeFilter = (field, val) => patch(`entry.vwapSlopeFilter.${field}`, val);
  const patchExit      = (field, val) => patch(`exit.${field}`, val);
  const patchFastCheck = (field, val) => patch(`exit.fastCheck.${field}`, val);
  const patchStopLoss  = (field, val) => patch(`stopLoss.${field}`, val);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ENTRY_COLOR }}>
          Entrada — escada VWAP + bandas
        </span>
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <span className="text-p5/50">Candle</span>
          <Select value={form.entry.interval} onChange={v => patchEntry('interval', v)} options={VWAP_BANDS_ALL_INTERVALS} />
          <span className="text-p5/50">VWAP</span>
          <Select value={form.entry.vwapInterval} onChange={v => patchEntry('vwapInterval', v)} options={VWAP_BANDS_ALL_INTERVALS} />
          <Select value={form.entry.session} onChange={v => patchEntry('session', v)} options={VWAP_BANDS_SESSIONS}
            labelFor={s => (s === 'weekly' ? 'Semanal' : 'Diária')} />
        </div>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50">Distância mín. entre bandas</span>
          <NumInput value={form.entry.minBandDistancePct} onChange={v => patchEntry('minBandDistancePct', v)} min={0} max={20} step={0.5} />
          <span className="text-p5/40">%</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50">Lookback de reconquista</span>
          <NumInput value={form.entry.reclaimLookbackCandles} onChange={v => patchEntry('reclaimLookbackCandles', v)} min={1} max={200} />
          <span className="text-p5/40">candles</span>
        </div>
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider text-p5/70">Pullback (retorno à banda)</span>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50">Espera até</span>
          <NumInput value={form.entry.pullback.waitCandles} onChange={v => patchPullback('waitCandles', v)} min={1} max={100} />
          <span className="text-p5/40">candles</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50">Tolerância</span>
          <NumInput value={form.entry.pullback.tolerancePct} onChange={v => patchPullback('tolerancePct', v)} min={0} max={10} step={0.1} />
          <span className="text-p5/40">%</span>
          <span className="text-p5/50 ml-2">Checagem rápida</span>
          <Select value={form.entry.pullback.pollInterval} onChange={v => patchPullback('pollInterval', v)} options={VWAP_BANDS_ALL_INTERVALS} />
        </div>
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${ENTRY_COLOR}33` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ENTRY_COLOR }}>
            Filtro EMA (banda inferior + inclinação)
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={form.entry.emaFilter?.enabled !== false}
              onChange={e => patchEmaFilter('enabled', e.target.checked)} style={{ accentColor: ENTRY_COLOR }} />
            Ativo
          </label>
        </div>
        {form.entry.emaFilter?.enabled !== false && (
          <>
            <p className="text-[10px] text-p5/60 leading-relaxed">
              No instante do SINAL (candle de alta que fecha acima da linha — lw1/vw/
              up1/up2), só arma o sinal se o close também estiver acima da banda
              inferior da EMA — floor = EMA × (1 − tolerância%) — e a própria EMA não
              estiver em queda (variação % entre o valor no candle e o de N candles atrás
              ≥ inclinação mín.). Se alguma condição não bater, aquele candle não conta como
              sinal.
            </p>
            <div className="flex flex-wrap gap-3 items-center text-xs">
              <div className="flex items-center gap-1">
                <span className="text-p5/50">EMA</span>
                <Select value={form.entry.emaFilter?.period ?? 200}
                  onChange={v => patchEmaFilter('period', Number(v))} options={EMA_FILTER_PERIODS} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Intervalo</span>
                <Select value={form.entry.emaFilter?.interval ?? '15m'}
                  onChange={v => patchEmaFilter('interval', v)} options={VWAP_BANDS_ALL_INTERVALS} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Banda</span>
                <Select value={form.entry.emaFilter?.tolerancePct ?? 2}
                  onChange={v => patchEmaFilter('tolerancePct', Number(v))} options={EMA_FILTER_TOLERANCES}
                  labelFor={t => `-${t}%`} />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-center text-xs">
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Lookback inclinação</span>
                <Select value={form.entry.emaFilter?.slopeLookback ?? 20}
                  onChange={v => patchEmaFilter('slopeLookback', Number(v))} options={EMA_FILTER_SLOPE_LOOKBACKS}
                  labelFor={n => (n === 0 ? 'off' : `${n} candles`)} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Inclinação mín.</span>
                <NumInput value={form.entry.emaFilter?.minSlopePct ?? 0}
                  onChange={v => patchEmaFilter('minSlopePct', v)} min={-10} max={5} step={0.1} />
                <span className="text-p5/40">%</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: `1px solid ${ENTRY_COLOR}33` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ENTRY_COLOR }}>
            Filtro de inclinação da VWAP
          </span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={form.entry.vwapSlopeFilter?.enabled === true}
              onChange={e => patchVwapSlopeFilter('enabled', e.target.checked)} style={{ accentColor: ENTRY_COLOR }} />
            Ativo
          </label>
        </div>
        {form.entry.vwapSlopeFilter?.enabled === true && (
          <>
            <p className="text-[10px] text-p5/60 leading-relaxed">
              Mesma ideia do filtro EMA acima, mas medindo a inclinação da própria linha da
              VWAP (não a EMA de preço) — pega moedas onde a VWAP e as bandas em si estão em
              queda acentuada. No candle do SINAL, compara o valor da VWAP com o de N candles
              atrás (na unidade do intervalo VWAP, ex.: 4h); bloqueia o sinal se a queda passar
              da inclinação mín.
            </p>
            <div className="flex flex-wrap gap-3 items-center text-xs">
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Lookback</span>
                <Select value={form.entry.vwapSlopeFilter?.lookback ?? 6}
                  onChange={v => patchVwapSlopeFilter('lookback', Number(v))} options={VWAP_SLOPE_FILTER_LOOKBACKS}
                  labelFor={n => `${n} candles`} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-p5/50">Inclinação mín.</span>
                <NumInput value={form.entry.vwapSlopeFilter?.minSlopePct ?? -2}
                  onChange={v => patchVwapSlopeFilter('minSlopePct', v)} min={-20} max={5} step={0.5} />
                <span className="text-p5/40">%</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EXIT_COLOR }}>
          Saída — alvo VWAP
        </span>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50">Tolerância do alvo</span>
          <NumInput value={form.exit.tolerancePct} onChange={v => patchExit('tolerancePct', v)} min={0} max={5} step={0.1} />
          <span className="text-p5/40">%</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50" title="Degrau vwap→up1→up2: vende num alvo fixo (compra + X%) em vez da up2 ao vivo. 0 desliga.">
            Alvo fixo degrau up2
          </span>
          <NumInput value={form.exit.upper2FixedPct ?? 0} onChange={v => patchExit('upper2FixedPct', v)} min={0} max={20} step={0.5} />
          <span className="text-p5/40">%</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-p5">
          <input type="checkbox" checked={form.exit.fastCheck.enabled}
            onChange={e => patchFastCheck('enabled', e.target.checked)} className="accent-pink-500" />
          Checagem rápida perto do alvo/stop
        </label>
        {form.exit.fastCheck.enabled && (
          <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
            <span className="text-p5/50">Proximidade</span>
            <NumInput value={form.exit.fastCheck.proximityPct} onChange={v => patchFastCheck('proximityPct', v)} min={0} max={10} step={0.1} />
            <span className="text-p5/40">%</span>
          </div>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-p5/70">Stop-loss</span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={form.stopLoss.enabled !== false}
              onChange={e => patchStopLoss('enabled', e.target.checked)} />
            Ativo
          </label>
        </div>
        {form.stopLoss.enabled === false ? (
          <p className="text-[10px] text-p5/50 leading-relaxed">
            Desligado — a posição só sai pelo alvo VWAP (escada), nunca por stop-loss.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <Select value={form.stopLoss.mode} onChange={v => patchStopLoss('mode', v)} options={VWAP_BANDS_STOP_LOSS_MODES}
                labelFor={m => (m === 'ladder' ? 'Estrutural (banda abaixo)' : 'Percentual/trailing')} />
            </div>
            {form.stopLoss.mode === 'ladder' ? (
              <p className="text-[10px] text-p5/50 leading-relaxed">
                Sem % fixo — o stop é a própria banda abaixo da que foi tocada pra armar a compra,
                recalculada ao vivo pela VWAP: comprou no retorno à lw1 → stop na lw2; comprou na
                vw → stop na lw1. Vende se a mínima do candle romper essa banda. Como bandas largas
                podem ficar bem mais longe que o normal, o limite abaixo trava um teto: a banda
                nunca serve de stop além dele — se a banda estiver mais longe, o OCO usa o limite
                no lugar dela (ex.: banda 14% abaixo, limite 10% → OCO com stop a -10%).
              </p>
            ) : (
              <p className="text-[10px] text-p5/50 leading-relaxed">
                Vende se o preço cair {form.stopLoss.maxLossPct ?? 5}% abaixo do preço de compra
                {form.stopLoss.trailing ? ' — ou do pico atingido depois da compra, já que o trailing está ligado' : ''}.
              </p>
            )}
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">{form.stopLoss.mode === 'ladder' ? 'Limite (teto)' : 'Perda máx.'}</span>
              <NumInput value={form.stopLoss.maxLossPct} onChange={v => patchStopLoss('maxLossPct', v)} min={1} max={30} step={0.5} />
              <span className="text-p5/40">%</span>
              {form.stopLoss.mode === 'percent' && (
                <label className="flex items-center gap-1 ml-2">
                  <input type="checkbox" checked={form.stopLoss.trailing}
                    onChange={e => patchStopLoss('trailing', e.target.checked)} />
                  Trailing
                </label>
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-[9px] text-p5/35">
        Bot: <code className="text-p5/50">node backend/bot/vwap-bands/vwap-bands-bot.js</code>
        {symbol && <> — {symbol} [vwap-bands]</>}
      </p>
    </div>
  );
}
