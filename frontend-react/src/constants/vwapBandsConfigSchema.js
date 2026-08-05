/** Schema VWAP Bands — espelho de backend/bot/vwap-bands/tradeConfigSchema.js */

export const VWAP_BANDS_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const VWAP_BANDS_SESSIONS = ['daily', 'weekly'];
export const VWAP_BANDS_STOP_LOSS_MODES = ['ladder', 'percent'];
export const EMA_FILTER_PERIODS = [9, 21, 50, 200];
export const EMA_FILTER_TOLERANCES = [1, 2, 3];
export const EMA_FILTER_SLOPE_LOOKBACKS = [0, 8, 20, 48];
export const VWAP_SLOPE_FILTER_LOOKBACKS = [3, 6, 12, 24];

export const VWAP_BANDS_DEFAULTS = {
  label: 'VWAP Bands',
  kind: 'vwap_bands',
  entry: {
    enabled: true,
    interval: '1h',
    vwapInterval: '4h',
    session: 'weekly',
    minBandDistancePct: 3,
    reclaimLookbackCandles: 24,
    minReclaimMarginPct: 0.2,
    pullback: { waitCandles: 5, tolerancePct: 1, pollInterval: '15m' },
    // Filtro extra: no instante do SINAL (candle de alta que fecha acima da linha), exige
    // close > EMA(period,interval) * (1 - tolerancePct%) e a própria EMA estável/subindo
    // (slope >= minSlopePct nos últimos slopeLookback candles).
    emaFilter: { enabled: true, period: 200, interval: '15m', tolerancePct: 2, slopeLookback: 20, minSlopePct: -1 },
    // Filtro extra: inclinação da própria linha da VWAP (não da EMA de preço) — pega
    // símbolos onde a VWAP e as bandas em si estão em queda acentuada. Ligado por padrão
    // (validado em backtest — analyze-vwap-slope-filter.js).
    vwapSlopeFilter: { enabled: true, lookback: 6, minSlopePct: -3 },
  },
  exit: {
    tolerancePct: 0,
    // Degrau vwap->upper1->upper2: por padrao vende na +2sigma ao vivo (igual aos outros
    // degraus). > 0 troca por um alvo fixo (preco de compra + upper2FixedPct%).
    upper2FixedPct: 0,
    fastCheck: { enabled: true, proximityPct: 1 },
  },
  stopLoss: {
    enabled: true, mode: 'ladder', tolerancePct: 0,
    maxLossPct: 5, trailing: true, trailStepPct: 5,
  },
  execution: { entryDiscount: 0.001 },
  polling: { pollMs: 60_000, fastPollMs: 30_000 },
  volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false },
};

export function normalizeVwapBandsForm(body = {}) {
  const d = VWAP_BANDS_DEFAULTS;
  const pb = body.entry?.pullback ?? {};
  const fc = body.exit?.fastCheck ?? {};
  return {
    label: body.label ?? d.label,
    kind: 'vwap_bands',
    entry: {
      enabled: body.entry?.enabled !== false,
      interval: VWAP_BANDS_ALL_INTERVALS.includes(body.entry?.interval) ? body.entry.interval : d.entry.interval,
      vwapInterval: VWAP_BANDS_ALL_INTERVALS.includes(body.entry?.vwapInterval) ? body.entry.vwapInterval : d.entry.vwapInterval,
      session: VWAP_BANDS_SESSIONS.includes(body.entry?.session) ? body.entry.session : d.entry.session,
      minBandDistancePct: Number(body.entry?.minBandDistancePct ?? d.entry.minBandDistancePct),
      reclaimLookbackCandles: Number(body.entry?.reclaimLookbackCandles ?? d.entry.reclaimLookbackCandles),
      minReclaimMarginPct: Number(body.entry?.minReclaimMarginPct ?? d.entry.minReclaimMarginPct),
      pullback: {
        waitCandles: Number(pb.waitCandles ?? d.entry.pullback.waitCandles),
        tolerancePct: Number(pb.tolerancePct ?? d.entry.pullback.tolerancePct),
        pollInterval: VWAP_BANDS_ALL_INTERVALS.includes(pb.pollInterval) ? pb.pollInterval : d.entry.pullback.pollInterval,
      },
      emaFilter: {
        enabled: body.entry?.emaFilter?.enabled !== false,
        period: Number(body.entry?.emaFilter?.period ?? d.entry.emaFilter.period),
        interval: VWAP_BANDS_ALL_INTERVALS.includes(body.entry?.emaFilter?.interval)
          ? body.entry.emaFilter.interval : d.entry.emaFilter.interval,
        tolerancePct: Number(body.entry?.emaFilter?.tolerancePct ?? d.entry.emaFilter.tolerancePct),
        slopeLookback: Number(body.entry?.emaFilter?.slopeLookback ?? d.entry.emaFilter.slopeLookback),
        minSlopePct: Number(body.entry?.emaFilter?.minSlopePct ?? d.entry.emaFilter.minSlopePct),
      },
      vwapSlopeFilter: {
        enabled: body.entry?.vwapSlopeFilter?.enabled !== false,
        lookback: Number(body.entry?.vwapSlopeFilter?.lookback ?? d.entry.vwapSlopeFilter.lookback),
        minSlopePct: Number(body.entry?.vwapSlopeFilter?.minSlopePct ?? d.entry.vwapSlopeFilter.minSlopePct),
      },
    },
    exit: {
      tolerancePct: Number(body.exit?.tolerancePct ?? d.exit.tolerancePct),
      upper2FixedPct: Number(body.exit?.upper2FixedPct ?? d.exit.upper2FixedPct),
      fastCheck: {
        enabled: fc.enabled !== false,
        proximityPct: Number(fc.proximityPct ?? d.exit.fastCheck.proximityPct),
      },
    },
    stopLoss: {
      enabled: body.stopLoss?.enabled !== false,
      mode: VWAP_BANDS_STOP_LOSS_MODES.includes(body.stopLoss?.mode) ? body.stopLoss.mode : d.stopLoss.mode,
      tolerancePct: Number(body.stopLoss?.tolerancePct ?? d.stopLoss.tolerancePct),
      maxLossPct: Number(body.stopLoss?.maxLossPct ?? d.stopLoss.maxLossPct),
      trailing: body.stopLoss?.trailing !== false,
      trailStepPct: Number(body.stopLoss?.trailStepPct ?? d.stopLoss.trailStepPct),
    },
    execution: { ...d.execution, ...body.execution },
    polling: { ...d.polling, ...body.polling },
    volume: { ...d.volume, ...body.volume },
  };
}

export function vwapBandsFormFromEntry(entry) {
  if (entry?.tradeConfig?.kind) return normalizeVwapBandsForm(entry.tradeConfig);
  if (entry?.kind) return normalizeVwapBandsForm(entry);
  return normalizeVwapBandsForm(entry);
}

export function vwapBandsFormToPayload(form, meta = {}) {
  const c = normalizeVwapBandsForm(form);
  return {
    ...meta,
    kind: c.kind,
    label: c.label,
    entry: c.entry,
    exit: c.exit,
    stopLoss: c.stopLoss,
    execution: c.execution,
    polling: c.polling,
    volume: c.volume,
  };
}
