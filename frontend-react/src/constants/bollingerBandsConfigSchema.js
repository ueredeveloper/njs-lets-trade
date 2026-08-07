/** Schema Bollinger Bands — espelho de backend/bot/bollinger-bands/tradeConfigSchema.js */

export const BOLLINGER_BANDS_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const BOLLINGER_BANDS_PERIODS = [10, 20, 30];
export const BOLLINGER_BANDS_STD_DEVS = [1, 2, 3];

export const BOLLINGER_BANDS_DEFAULTS = {
  label: 'Bollinger Bands',
  kind: 'bollinger_bands',
  entry: {
    enabled: true,
    interval: '4h',
    period: 20,
    stdDev: 2,
    pullback: { enabled: false, belowPct: 2 },
  },
  exit: {
    restingBracket: { enabled: true, driftPct: 3 },
  },
  stopLoss: {
    enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5,
  },
  polling: { pollMs: 60_000, fastPollMs: 30_000 },
  volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false },
};

export function normalizeBollingerBandsForm(body = {}) {
  const d = BOLLINGER_BANDS_DEFAULTS;
  const pb = body.entry?.pullback ?? {};
  const rb = body.exit?.restingBracket ?? {};
  return {
    label: body.label ?? d.label,
    kind: 'bollinger_bands',
    entry: {
      enabled: body.entry?.enabled !== false,
      interval: BOLLINGER_BANDS_ALL_INTERVALS.includes(body.entry?.interval) ? body.entry.interval : d.entry.interval,
      period: BOLLINGER_BANDS_PERIODS.includes(Number(body.entry?.period)) ? Number(body.entry.period) : d.entry.period,
      stdDev: BOLLINGER_BANDS_STD_DEVS.includes(Number(body.entry?.stdDev)) ? Number(body.entry.stdDev) : d.entry.stdDev,
      pullback: {
        enabled: pb.enabled === true,
        belowPct: Number(pb.belowPct ?? d.entry.pullback.belowPct),
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
    },
    polling: { ...d.polling, ...body.polling },
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
