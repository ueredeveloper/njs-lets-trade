/** Schema Bollinger Bands — espelho de backend/bot/bollinger-bands/tradeConfigSchema.js */

export const BOLLINGER_BANDS_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const BOLLINGER_BANDS_PERIODS = [10, 20, 30];
export const BOLLINGER_BANDS_STD_DEVS = [1, 2, 3];
export const BOLLINGER_BANDS_EMA_PERIODS = [9, 21, 50, 200];
export const BOLLINGER_BANDS_STOP_LOSS_MODES = ['fixed', 'ema', 'band'];

export const BOLLINGER_BANDS_DEFAULTS = {
  label: 'Bollinger Bands',
  kind: 'bollinger_bands',
  entry: {
    enabled: true,
    interval: '4h',
    period: 20,
    stdDev: 2,
    pullback: { enabled: false, belowPct: 2 },
    /** Ordem limite GTC fica no book até N candles aguardando reteste. */
    limitWaitCandles: 5,
    /** Após STOP_LOSS, espera N candles fechados do intervalo da BB antes de reavaliar compra.
     *  Saída no alvo não espera. 0 = sem espera. */
    reentryCooldownCandles: 3,
    /** Ligado por padrão; interval nasce igual ao entry.interval (mesmo intervalo da banda
     *  de Bollinger) quando não informado — ver normalizeBollingerBandsForm.
     *  slopeLookback/minSlopePct: a linha da EMA precisa estar subindo (≥ minSlopePct %
     *  vs. N candles atrás) além do preço estar acima dela. */
    emaFilter: {
      enabled: true, period: 50, interval: '4h', maxDipPct: 2,
      slopeLookback: 5, minSlopePct: 0,
    },
    /** Filtro de tendência da linha mediana (média) da própria Bollinger: média das
     *  variações candle-a-candle dos últimos `lookback` valores fechados da linha média
     *  precisa ser ≥ 0 pra liberar a compra — checado no sinal e de novo a cada tick
     *  enquanto a ordem limite de entrada aguarda fill. */
    medianTrendFilter: { enabled: true, lookback: 10 },
  },
  exit: {
    restingBracket: { enabled: true, driftPct: 3 },
  },
  stopLoss: {
    enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5,
    mode: 'fixed',
    /** interval nasce igual ao entry.interval quando não informado — ver normalizeBollingerBandsForm. */
    ema: { period: 50, interval: '4h', belowPct: 2 },
    /** mode 'band': stop = banda inferior BB(entry.period,entry.stdDev) ao vivo × (1 − belowPct/100). */
    band: { belowPct: 10 },
  },
  polling: { pollMs: 60_000, fastPollMs: 30_000 },
  entryCooldownHours: 0,
  volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false },
};

export function normalizeBollingerBandsForm(body = {}) {
  const d = BOLLINGER_BANDS_DEFAULTS;
  const pb = body.entry?.pullback ?? {};
  const ef = body.entry?.emaFilter ?? {};
  const mt = body.entry?.medianTrendFilter ?? {};
  const rb = body.exit?.restingBracket ?? {};
  const interval = BOLLINGER_BANDS_ALL_INTERVALS.includes(body.entry?.interval) ? body.entry.interval : d.entry.interval;
  return {
    label: body.label ?? d.label,
    kind: 'bollinger_bands',
    entry: {
      enabled: body.entry?.enabled !== false,
      interval,
      period: BOLLINGER_BANDS_PERIODS.includes(Number(body.entry?.period)) ? Number(body.entry.period) : d.entry.period,
      stdDev: BOLLINGER_BANDS_STD_DEVS.includes(Number(body.entry?.stdDev)) ? Number(body.entry.stdDev) : d.entry.stdDev,
      pullback: {
        enabled: pb.enabled === true,
        belowPct: Number(pb.belowPct ?? d.entry.pullback.belowPct),
      },
      limitWaitCandles: Number(body.entry?.limitWaitCandles ?? d.entry.limitWaitCandles),
      reentryCooldownCandles: Number(body.entry?.reentryCooldownCandles ?? d.entry.reentryCooldownCandles),
      // interval nasce igual ao da banda de Bollinger (interval acima) quando não informado.
      emaFilter: {
        enabled: ef.enabled !== false,
        period: BOLLINGER_BANDS_EMA_PERIODS.includes(Number(ef.period)) ? Number(ef.period) : d.entry.emaFilter.period,
        interval: BOLLINGER_BANDS_ALL_INTERVALS.includes(ef.interval) ? ef.interval : interval,
        maxDipPct: Number(ef.maxDipPct ?? d.entry.emaFilter.maxDipPct),
        slopeLookback: Number(ef.slopeLookback ?? d.entry.emaFilter.slopeLookback),
        minSlopePct: Number(ef.minSlopePct ?? d.entry.emaFilter.minSlopePct),
      },
      medianTrendFilter: {
        enabled: mt.enabled !== false,
        lookback: Number(mt.lookback ?? d.entry.medianTrendFilter.lookback),
      },
    },
    exit: {
      restingBracket: {
        enabled: rb.enabled !== false,
        driftPct: Number(rb.driftPct ?? d.exit.restingBracket.driftPct),
      },
    },
    stopLoss: {
      enabled: body.stopLoss?.enabled !== false,
      maxLossPct: Number(body.stopLoss?.maxLossPct ?? d.stopLoss.maxLossPct),
      trailing: body.stopLoss?.trailing !== false,
      trailStepPct: Number(body.stopLoss?.trailStepPct ?? d.stopLoss.trailStepPct),
      mode: BOLLINGER_BANDS_STOP_LOSS_MODES.includes(body.stopLoss?.mode) ? body.stopLoss.mode : d.stopLoss.mode,
      // interval nasce igual ao da banda de Bollinger (interval acima) quando não informado.
      ema: {
        period: BOLLINGER_BANDS_EMA_PERIODS.includes(Number(body.stopLoss?.ema?.period))
          ? Number(body.stopLoss.ema.period) : d.stopLoss.ema.period,
        interval: BOLLINGER_BANDS_ALL_INTERVALS.includes(body.stopLoss?.ema?.interval)
          ? body.stopLoss.ema.interval : interval,
        belowPct: Number(body.stopLoss?.ema?.belowPct ?? d.stopLoss.ema.belowPct),
      },
      band: {
        belowPct: Number(body.stopLoss?.band?.belowPct ?? d.stopLoss.band.belowPct),
      },
    },
    polling: { ...d.polling, ...body.polling },
    entryCooldownHours: Number(body.entryCooldownHours ?? d.entryCooldownHours),
    volume: { ...d.volume, ...body.volume },
  };
}

export function bollingerBandsFormFromEntry(entry) {
  if (entry?.tradeConfig?.kind) return normalizeBollingerBandsForm(entry.tradeConfig);
  if (entry?.kind) return normalizeBollingerBandsForm(entry);
  return normalizeBollingerBandsForm(entry);
}

export function bollingerBandsFormToPayload(form, meta = {}) {
  const c = normalizeBollingerBandsForm(form);
  return {
    ...meta,
    kind: c.kind,
    label: c.label,
    entry: c.entry,
    exit: c.exit,
    stopLoss: c.stopLoss,
    polling: c.polling,
    volume: c.volume,
  };
}
