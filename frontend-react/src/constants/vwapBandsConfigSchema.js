/** Schema VWAP Bands — espelho de backend/bot/vwap-bands/tradeConfigSchema.js */

export const VWAP_BANDS_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const VWAP_BANDS_SESSIONS = ['daily', 'weekly'];
export const VWAP_BANDS_STOP_LOSS_MODES = ['ladder', 'percent'];

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
    pullback: { waitCandles: 10, tolerancePct: 1, pollInterval: '15m' },
  },
  exit: {
    tolerancePct: 0,
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
      pullback: {
        waitCandles: Number(pb.waitCandles ?? d.entry.pullback.waitCandles),
        tolerancePct: Number(pb.tolerancePct ?? d.entry.pullback.tolerancePct),
        pollInterval: VWAP_BANDS_ALL_INTERVALS.includes(pb.pollInterval) ? pb.pollInterval : d.entry.pullback.pollInterval,
      },
    },
    exit: {
      tolerancePct: Number(body.exit?.tolerancePct ?? d.exit.tolerancePct),
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
