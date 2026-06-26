'use strict';

/**
 * Schema Swing — RSI 1h + MA50 8h e MA50 8h + RSI 4h.
 * Parâmetros explícitos: MA 50/200, RSI 30/70/75/80, intervalos.
 */

const RSI_INTERVALS = ['15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const MA_INTERVALS  = ['1h', '2h', '4h', '8h', '1d'];
const MA_PERIODS    = [20, 50, 100, 200];
const RSI_PERIODS   = [7, 14, 21];

const SWING_DEFAULTS = {
  kind: 'rsi', // 'rsi' | 'ma'

  entryRsi:  { interval: '1h', period: 14, operator: '<', value: 30 },
  exitRsi:   { interval: '1h', period: 14, operator: '>', value: 75 },

  /** Filtro de entrada (estratégia RSI): preço acima desta MA */
  entryMaFilter: {
    enabled:  true,
    period:   50,
    interval: '8h',
    mode:     'strict_above', // strict_above | touch
  },

  /** Entrada por MA (estratégia MA) */
  entryMa: {
    period:         50,
    interval:       '8h',
    trigger:        'cross_up', // cross_up | touch | above
    tolerancePct:   0.5,
    aboveMaEnabled: true,
    aboveMaCandles: 3,
  },

  stopLoss: {
    enabled:    true,
    maxLossPct: 5,
  },

  execution: {
    immediateEntry:       true,
    entryDiscount:        0.01,
    pendingTimeoutMs:     60 * 60_000,
    pendingCancelPct:     0.002,
    pendingCancelOnExitRsi: true,
  },

  polling: {
    pollMs:           5 * 60_000,
    fastPollMs:       60_000,
    fastRsiThreshold: 72,
  },

  volume: {
    minVolumeUsdt:  1_000_000,
    allowLowVolume: false,
  },
};

function normalizeRsi(rsi, fallback) {
  const fb = fallback ?? SWING_DEFAULTS.entryRsi;
  return {
    interval: rsi?.interval ?? fb.interval,
    period:   Number(rsi?.period ?? fb.period),
    operator: rsi?.operator ?? fb.operator,
    value:    Number(rsi?.value ?? fb.value),
  };
}

function normalizeMaFilter(m, fallback) {
  const fb = fallback ?? SWING_DEFAULTS.entryMaFilter;
  return {
    enabled:  m?.enabled !== false,
    period:   Number(m?.period ?? fb.period),
    interval: m?.interval ?? fb.interval,
    mode:     m?.mode ?? fb.mode,
  };
}

function normalizeEntryMa(m, fallback) {
  const fb = fallback ?? SWING_DEFAULTS.entryMa;
  return {
    period:         Number(m?.period ?? fb.period),
    interval:       m?.interval ?? fb.interval,
    trigger:        m?.trigger ?? fb.trigger,
    tolerancePct:   Number(m?.tolerancePct ?? fb.tolerancePct),
    aboveMaEnabled: m?.aboveMaEnabled !== false,
    aboveMaCandles: Number(m?.aboveMaCandles ?? fb.aboveMaCandles),
  };
}

function normalizeSwingConfig(body = {}) {
  const d = SWING_DEFAULTS;
  const kind = body.kind === 'ma' ? 'ma' : 'rsi';
  return {
    label: body.label ?? (kind === 'ma' ? 'Swing MA50 8h' : 'Swing RSI 1h'),
    kind,
    entryRsi:      normalizeRsi(body.entryRsi, d.entryRsi),
    exitRsi:       normalizeRsi(body.exitRsi, d.exitRsi),
    entryMaFilter: normalizeMaFilter(body.entryMaFilter, d.entryMaFilter),
    entryMa:       normalizeEntryMa(body.entryMa, d.entryMa),
    stopLoss: {
      enabled:    body.stopLoss?.enabled !== false,
      maxLossPct: Number(body.stopLoss?.maxLossPct ?? d.stopLoss.maxLossPct),
    },
    execution: {
      immediateEntry:         body.execution?.immediateEntry !== false,
      entryDiscount:          Number(body.execution?.entryDiscount ?? d.execution.entryDiscount),
      pendingTimeoutMs:       Number(body.execution?.pendingTimeoutMs ?? d.execution.pendingTimeoutMs),
      pendingCancelPct:       Number(body.execution?.pendingCancelPct ?? d.execution.pendingCancelPct),
      pendingCancelOnExitRsi: body.execution?.pendingCancelOnExitRsi !== false,
    },
    polling: {
      pollMs:           Number(body.polling?.pollMs ?? d.polling.pollMs),
      fastPollMs:       Number(body.polling?.fastPollMs ?? d.polling.fastPollMs),
      fastRsiThreshold: Number(body.polling?.fastRsiThreshold ?? d.polling.fastRsiThreshold),
    },
    volume: {
      minVolumeUsdt:  Number(body.volume?.minVolumeUsdt ?? d.volume.minVolumeUsdt),
      allowLowVolume: body.volume?.allowLowVolume === true,
    },
  };
}

function toEngineConfig(normalized) {
  const c = normalized ?? normalizeSwingConfig();
  return {
    ...c,
    minVolumeUsdt:    c.volume.minVolumeUsdt,
    allowLowVolume:   c.volume.allowLowVolume,
    pollMs:           c.polling.pollMs,
    fastPollMs:       c.polling.fastPollMs,
    fastRsiThreshold: c.polling.fastRsiThreshold,
    entryDiscount:    c.execution.entryDiscount,
    immediateEntry:   c.execution.immediateEntry,
    pendingTimeoutMs: c.execution.pendingTimeoutMs,
    pendingCancelPct: c.execution.pendingCancelPct,
    pendingCancelOnExitRsi: c.execution.pendingCancelOnExitRsi,
  };
}

function configFromRow(row) {
  if (!row) return null;
  let tc = row.trade_config;
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc); } catch { tc = null; }
  }
  if (tc?.kind) return toEngineConfig(normalizeSwingConfig(tc));
  return null;
}

function resolveStrategy(row) {
  const config = configFromRow(row);
  if (!config) return null;
  return {
    config,
    label: config.label,
    pollMs:              config.pollMs,
    fastPollMs:          config.fastPollMs,
    fastRsiThreshold:    config.fastRsiThreshold,
    entryDiscount:       config.entryDiscount,
    immediateEntry:      config.immediateEntry,
    pendingTimeoutMs:    config.pendingTimeoutMs,
    pendingCancelPct:    config.pendingCancelPct,
    pendingCancelOnExitRsi: config.pendingCancelOnExitRsi,
  };
}

/** Converte config Swing → formato AMAP para suggestEntryRsi / suggestExitRsi */
function toAmapSuggestConfig(config) {
  const c = config ?? normalizeSwingConfig();
  return {
    entryRsi:      c.entryRsi,
    exitRsi:       c.exitRsi,
    entryRsiPath:  { enabled: c.kind === 'rsi' },
    entryMa:       { enabled: false },
    maConditions:  c.kind === 'rsi' && c.entryMaFilter.enabled
      ? [{ mode: c.entryMaFilter.mode, period: c.entryMaFilter.period, interval: c.entryMaFilter.interval }]
      : [],
    extension:     { enabled: false },
    stopLoss:      { enabled: c.stopLoss.enabled, maxLossPct: c.stopLoss.maxLossPct, pctCapEnabled: true },
    execution:     c.execution,
    rule1: {
      enabled: true,
      entryRsi: c.entryRsi,
      exitRsi:  c.exitRsi,
      maFiltersEnabled: c.kind === 'rsi' && c.entryMaFilter.enabled,
      maFilters: c.kind === 'rsi' && c.entryMaFilter.enabled
        ? [{ mode: c.entryMaFilter.mode, period: c.entryMaFilter.period, interval: c.entryMaFilter.interval }]
        : [],
      extension: { enabled: false },
      stopLoss:  c.stopLoss,
      execution: c.execution,
    },
    rule2: { enabled: false },
  };
}

function toFormState(body) {
  const c = normalizeSwingConfig(body);
  return {
    label:         c.label,
    kind:          c.kind,
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

function formStateToPayload(form) {
  return normalizeSwingConfig(form);
}

module.exports = {
  SWING_DEFAULTS,
  RSI_INTERVALS,
  MA_INTERVALS,
  MA_PERIODS,
  RSI_PERIODS,
  normalizeSwingConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toAmapSuggestConfig,
  toFormState,
  formStateToPayload,
};
