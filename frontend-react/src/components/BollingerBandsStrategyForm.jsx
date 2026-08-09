import {
  BOLLINGER_BANDS_ALL_INTERVALS, BOLLINGER_BANDS_PERIODS, BOLLINGER_BANDS_STD_DEVS, BOLLINGER_BANDS_EMA_PERIODS,
} from '../constants/bollingerBandsConfigSchema';

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

/**
 * Formulário Bollinger Bands — a estratégia mais simples do painel: compra quando o preço
 * toca a banda inferior, vende quando toca a banda superior, no intervalo escolhido. Sem
 * escada, sem filtros extra (ver backend/bot/bollinger-bands/strategyEngine.js).
 */
export default function BollingerBandsStrategyForm({ form, patch, symbol, lockInterval }) {
  const patchEntry     = (field, val) => patch(`entry.${field}`, val);
  const patchPullback  = (field, val) => patch(`entry.pullback.${field}`, val);
  const patchEmaFilter = (field, val) => patch(`entry.emaFilter.${field}`, val);
  const patchBracket   = (field, val) => patch(`exit.restingBracket.${field}`, val);
  const patchStopLoss  = (field, val) => patch(`stopLoss.${field}`, val);
  const patchStopLossEma = (field, val) => patch(`stopLoss.ema.${field}`, val);
  const patchStopLossBand = (field, val) => patch(`stopLoss.band.${field}`, val);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ENTRY_COLOR }}>
          Entrada — banda inferior
        </span>
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <span className="text-p5/50">Intervalo</span>
          {lockInterval ? (
            <span className="rounded px-2 py-1 text-xs font-mono font-bold" style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: ENTRY_COLOR }}>
              {form.entry.interval}
            </span>
          ) : (
            <Select value={form.entry.interval} onChange={v => patchEntry('interval', v)} options={BOLLINGER_BANDS_ALL_INTERVALS} />
          )}
          <span className="text-p5/50 ml-2">Período</span>
          <Select value={form.entry.period} onChange={v => patchEntry('period', Number(v))} options={BOLLINGER_BANDS_PERIODS}
            labelFor={p => `BB${p}`} />
          <span className="text-p5/50 ml-2">Desvio padrão</span>
          <Select value={form.entry.stdDev} onChange={v => patchEntry('stdDev', Number(v))} options={BOLLINGER_BANDS_STD_DEVS}
            labelFor={s => `${s}σ`} />
        </div>
        <p className="text-[10px] text-p5/50 leading-relaxed">
          Compra assim que a mínima de um candle {form.entry.interval} tocar a banda inferior
          da Bollinger({form.entry.period},{form.entry.stdDev}) — ordem limite no preço exato da banda.
        </p>
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-p5/70">Pullback (opcional)</span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={form.entry.pullback?.enabled === true}
              onChange={e => patchPullback('enabled', e.target.checked)} style={{ accentColor: ENTRY_COLOR }} />
            Ativo
          </label>
        </div>
        {form.entry.pullback?.enabled === true ? (
          <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
            <span className="text-p5/50">Compra</span>
            <NumInput value={form.entry.pullback?.belowPct} onChange={v => patchPullback('belowPct', v)} min={0.1} max={20} step={0.5} />
            <span className="text-p5/40">% abaixo da banda inferior</span>
          </div>
        ) : (
          <p className="text-[10px] text-p5/50 leading-relaxed">
            Desligado (padrão) — compra assim que a banda inferior é tocada, sem exigir um
            repique mais fundo.
          </p>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-p5/70">Filtro de tendência (EMA, opcional)</span>
          <label className="flex items-center gap-1 text-[9px] text-p5/50 cursor-pointer">
            <input type="checkbox" checked={form.entry.emaFilter?.enabled === true}
              onChange={e => patchEmaFilter('enabled', e.target.checked)} style={{ accentColor: ENTRY_COLOR }} />
            Ativo
          </label>
        </div>
        {form.entry.emaFilter?.enabled === true ? (
          <>
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="text-p5/50">EMA</span>
              <Select value={form.entry.emaFilter?.period} onChange={v => patchEmaFilter('period', Number(v))} options={BOLLINGER_BANDS_EMA_PERIODS} />
              <span className="text-p5/50 ml-2">Intervalo</span>
              <Select value={form.entry.emaFilter?.interval} onChange={v => patchEmaFilter('interval', v)} options={BOLLINGER_BANDS_ALL_INTERVALS} />
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">Adaptação inferior</span>
              <NumInput value={form.entry.emaFilter?.maxDipPct} onChange={v => patchEmaFilter('maxDipPct', v)} min={0} max={20} step={0.5} />
              <span className="text-p5/40">% abaixo da EMA ainda conta como "acima"</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">Lookback inclinação</span>
              <NumInput value={form.entry.emaFilter?.slopeLookback ?? 5} onChange={v => patchEmaFilter('slopeLookback', v)} min={0} max={48} step={1} className="w-14" />
              <span className="text-p5/40">candles</span>
              <span className="text-p5/50 ml-2">Inclinação mín.</span>
              <NumInput value={form.entry.emaFilter?.minSlopePct ?? 0} onChange={v => patchEmaFilter('minSlopePct', v)} min={-10} max={5} step={0.1} className="w-14" />
              <span className="text-p5/40">%</span>
            </div>
            <p className="text-[10px] text-p5/50 leading-relaxed">
              Só compra se o preço estiver acima da EMA{form.entry.emaFilter?.period}({form.entry.emaFilter?.interval})
              (folga de até {form.entry.emaFilter?.maxDipPct ?? 2}% abaixo) e a própria linha da EMA estiver
              subindo: variação ≥ {form.entry.emaFilter?.minSlopePct ?? 0}% vs. os
              {' '}{form.entry.emaFilter?.slopeLookback ?? 5} candles anteriores. Se a EMA estiver em baixa,
              não entra (lookback 0 = desliga a checagem de inclinação).
            </p>
          </>
        ) : (
          <p className="text-[10px] text-p5/50 leading-relaxed">
            Desligado — a banda inferior tocada já basta pra comprar, sem checar tendência.
          </p>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider text-p5/70">Reentrada após saída</span>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50">Esperar</span>
          <NumInput value={form.entry.reentryCooldownCandles ?? 5} onChange={v => patchEntry('reentryCooldownCandles', v)} min={0} max={100} step={1} className="w-14" />
          <span className="text-p5/40">candles {form.entry.interval} fechados</span>
        </div>
        <p className="text-[10px] text-p5/50 leading-relaxed">
          Depois de vender, não compra de novo até passarem {form.entry.reentryCooldownCandles ?? 5} candles
          {' '}{form.entry.interval} fechados — aí refaz a análise completa (banda + filtros).
          0 = sem espera.
        </p>
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider text-p5/70">Ordem limite no toque da BB</span>
        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          <span className="text-p5/50">Manter no book até</span>
          <NumInput value={form.entry.limitWaitCandles ?? 5} onChange={v => patchEntry('limitWaitCandles', v)} min={1} max={100} step={1} className="w-14" />
          <span className="text-p5/40">candles {form.entry.interval}</span>
        </div>
        <p className="text-[10px] text-p5/50 leading-relaxed">
          No toque da banda inferior arma limite GTC no preço da banda e deixa resting —
          se o pavio subiu (como 05:34) e o preço retestar (05:35), preenche. Sem fill em
          {' '}{form.entry.limitWaitCandles ?? 5} candles, cancela e espera o próximo sinal.
        </p>
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: EXIT_COLOR }}>
          Saída — banda superior
        </span>
        <label className="flex items-center gap-2 cursor-pointer text-xs text-p5">
          <input type="checkbox" checked={form.exit.restingBracket?.enabled !== false}
            onChange={e => patchBracket('enabled', e.target.checked)} className="accent-pink-500" />
          Ordem OCO (TP/SL) resting na corretora
        </label>
        <p className="text-[10px] text-p5/50 leading-relaxed">
          {form.exit.restingBracket?.enabled !== false
            ? 'Logo após a compra, coloca alvo (banda superior) e stop (piso do stop-loss abaixo) já na corretora — igual ao VWAP Bands. Recriada quando a banda se mover o suficiente.'
            : 'Desligado — venda a mercado só quando o bot detectar o toque na banda superior ou o stop-loss no próprio tick (menos preciso que a ordem resting).'}
        </p>
        {form.exit.restingBracket?.enabled !== false && (
          <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
            <span className="text-p5/50">Recria a bracket se desviar</span>
            <NumInput value={form.exit.restingBracket?.driftPct} onChange={v => patchBracket('driftPct', v)} min={0.5} max={20} step={0.5} />
            <span className="text-p5/40">%</span>
          </div>
        )}
      </div>

      <div className="rounded-md p-2 space-y-2" style={{ background: '#1a1d28', border: '1px solid #2a2d3a' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider text-p5/70">Stop-loss</span>

        <div className="flex gap-2">
          {[{ id: 'fixed', label: 'Valor limite (%)' }, { id: 'ema', label: 'Linha da EMA' }, { id: 'band', label: 'Abaixo da banda inferior' }].map(m => (
            <button key={m.id} type="button" onClick={() => patchStopLoss('mode', m.id)}
              className="flex-1 py-1 text-[10px] rounded font-semibold"
              style={{
                background: (form.stopLoss.mode ?? 'fixed') === m.id ? EXIT_COLOR : 'transparent',
                color: (form.stopLoss.mode ?? 'fixed') === m.id ? '#fff' : EXIT_COLOR,
                border: `1px solid ${EXIT_COLOR}`, opacity: (form.stopLoss.mode ?? 'fixed') === m.id ? 1 : 0.55,
              }}>{m.label}</button>
          ))}
        </div>

        {(form.stopLoss.mode ?? 'fixed') === 'ema' ? (
          <>
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="text-p5/50">EMA</span>
              <Select value={form.stopLoss.ema?.period} onChange={v => patchStopLossEma('period', Number(v))} options={BOLLINGER_BANDS_EMA_PERIODS} />
              <span className="text-p5/50 ml-2">Intervalo</span>
              <Select value={form.stopLoss.ema?.interval} onChange={v => patchStopLossEma('interval', v)} options={BOLLINGER_BANDS_ALL_INTERVALS} />
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">Variação</span>
              <NumInput value={form.stopLoss.ema?.belowPct} onChange={v => patchStopLossEma('belowPct', v)} min={0} max={20} step={0.5} />
              <span className="text-p5/40">% abaixo da EMA</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">Piso % (fallback)</span>
              <NumInput value={form.stopLoss.maxLossPct} onChange={v => patchStopLoss('maxLossPct', v)} min={0.5} max={30} step={0.5} />
              <span className="text-p5/40">% — usado se a EMA já estiver acima do preço de compra</span>
            </div>
            <p className="text-[10px] text-p5/50 leading-relaxed">
              Vende se o preço cair até {form.stopLoss.ema?.belowPct ?? 2}% abaixo da
              EMA{form.stopLoss.ema?.period}({form.stopLoss.ema?.interval}). Se essa linha
              estiver no/acima do preço de entrada, a compra é bloqueada (lugar errado).
              Se a posição já estiver aberta nesse cenário, o piso de
              {' '}{form.stopLoss.maxLossPct ?? 5}% entra como fallback.
            </p>
          </>
        ) : (form.stopLoss.mode ?? 'fixed') === 'band' ? (
          <>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">Stop</span>
              <NumInput value={form.stopLoss.band?.belowPct ?? 10} onChange={v => patchStopLossBand('belowPct', v)} min={0} max={50} step={0.5} />
              <span className="text-p5/40">% abaixo da banda inferior BB({form.entry.period},{form.entry.stdDev})</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">Piso % (fallback)</span>
              <NumInput value={form.stopLoss.maxLossPct} onChange={v => patchStopLoss('maxLossPct', v)} min={0.5} max={30} step={0.5} />
              <span className="text-p5/40">% — usado se a banda já estiver acima do preço de compra</span>
            </div>
            <p className="text-[10px] text-p5/50 leading-relaxed">
              Vende se o preço cair até {form.stopLoss.band?.belowPct ?? 10}% abaixo da banda
              inferior BB({form.entry.period},{form.entry.stdDev}) {form.entry.interval} ao vivo —
              o piso acompanha a banda a cada candle novo. Se a banda estiver no/acima do preço
              de entrada, a compra é bloqueada (lugar errado). Se a posição já estiver aberta
              nesse cenário, o piso de {form.stopLoss.maxLossPct ?? 5}% entra como fallback.
            </p>
          </>
        ) : (
          <>
            <p className="text-[10px] text-p5/50 leading-relaxed">
              Vende se o preço cair {form.stopLoss.maxLossPct ?? 5}% abaixo do preço de compra
              {form.stopLoss.trailing ? ' — ou do pico atingido depois da compra, já que o trailing está ligado' : ''}.
            </p>
            <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
              <span className="text-p5/50">Perda máx. (limite 0,5–30%)</span>
              <NumInput value={form.stopLoss.maxLossPct} onChange={v => patchStopLoss('maxLossPct', v)} min={0.5} max={30} step={0.5} />
              <span className="text-p5/40">%</span>
              <label className="flex items-center gap-1 ml-2">
                <input type="checkbox" checked={form.stopLoss.trailing}
                  onChange={e => patchStopLoss('trailing', e.target.checked)} />
                Trailing
              </label>
            </div>
          </>
        )}
      </div>

      <p className="text-[9px] text-p5/35">
        Bot: <code className="text-p5/50">node backend/bot/bollinger-bands/bollinger-bands-bot.js</code>
        {symbol && <> — {symbol} [bollinger-bands]</>}
      </p>
    </div>
  );
}
