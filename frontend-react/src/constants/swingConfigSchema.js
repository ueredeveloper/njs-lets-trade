/** Schema Swing — espelho de backend/bot/swing/tradeConfigSchema.js */

export const SWING_DEFAULTS = {
  kind: 'rsi',
  entryRsi:  { interval: '1h', period: 14, operator: '<', value: 30 },
  exitRsi:   { interval: '1h', period: 14, operator: '>', value: 75 },
  entryMaFilter: { enabled: true, period: 50, interval: '8h', mode: 'strict_above' },
  entryMa: {
    period: 50, interval: '8h', trigger: 'cross_up',
    tolerancePct: 0.5, aboveMaEnabled: true, aboveMaCandles: 3,
  },
  stopLoss:  { enabled: true, maxLossPct: 5 },
  execution: { immediateEntry: true, entryDiscount: 0.01, pendingTimeoutMs: 60 * 60_000 },
  polling:   { pollMs: 5 * 60_000, fastPollMs: 60_000, fastRsiThreshold: 72 },
  volume:    { minVolumeUsdt: 1_000_000, allowLowVolume: false },
};

export function normalizeSwingForm(body = {}) {
  const d = SWING_DEFAULTS;
  const kind = body.kind === 'ma' ? 'ma' : 'rsi';
  return {
    label: body.label ?? (kind === 'ma' ? 'Swing MA50 8h' : 'Swing RSI 1h'),
    kind,
    entryRsi: {
      interval: body.entryRsi?.interval ?? d.entryRsi.interval,
      period:   Number(body.entryRsi?.period ?? d.entryRsi.period),
      operator: body.entryRsi?.operator ?? d.entryRsi.operator,
      value:    Number(body.entryRsi?.value ?? d.entryRsi.value),
    },
    exitRsi: {
      interval: body.exitRsi?.interval ?? d.exitRsi.interval,
      period:   Number(body.exitRsi?.period ?? d.exitRsi.period),
      operator: body.exitRsi?.operator ?? d.exitRsi.operator,
      value:    Number(body.exitRsi?.value ?? d.exitRsi.value),
    },
    entryMaFilter: {
      enabled:  body.entryMaFilter?.enabled !== false,
      period:   Number(body.entryMaFilter?.period ?? d.entryMaFilter.period),
      interval: body.entryMaFilter?.interval ?? d.entryMaFilter.interval,
      mode:     body.entryMaFilter?.mode ?? d.entryMaFilter.mode,
    },
    entryMa: {
      period:         Number(body.entryMa?.period ?? d.entryMa.period),
      interval:       body.entryMa?.interval ?? d.entryMa.interval,
      trigger:        body.entryMa?.trigger ?? d.entryMa.trigger,
      tolerancePct:   Number(body.entryMa?.tolerancePct ?? d.entryMa.tolerancePct),
      aboveMaEnabled: body.entryMa?.aboveMaEnabled !== false,
      aboveMaCandles: Number(body.entryMa?.aboveMaCandles ?? d.entryMa.aboveMaCandles),
    },
    stopLoss: {
      enabled:    body.stopLoss?.enabled !== false,
      maxLossPct: Number(body.stopLoss?.maxLossPct ?? d.stopLoss.maxLossPct),
    },
    execution: { ...d.execution, ...body.execution },
    polling:   { ...d.polling, ...body.polling },
    volume:    { ...d.volume, ...body.volume },
  };
}

export function swingFormFromEntry(entry) {
  if (entry?.tradeConfig?.kind) return normalizeSwingForm(entry.tradeConfig);
  if (entry?.kind) return normalizeSwingForm(entry);
  return normalizeSwingForm(entry);
}

export function swingFormToPayload(form, meta = {}) {
  const c = normalizeSwingForm(form);
  return {
    ...meta,
    kind:          c.kind,
    label:         c.label,
    entryRsi:      c.entryRsi,
    exitRsi:       c.exitRsi,
    entryMaFilter: c.entryMaFilter,
    entryMa:       c.entryMa,
    stopLoss:      c.stopLoss,
    execution:     c.execution,
    polling:       c.polling,
    volume:        c.volume,
  };
}
