'use strict';

/**
 * Schema MA Cross — parâmetros livres (períodos custom, múltiplos filtros, saída MA ou RSI).
 */

const MA_CROSS_PERIOD_MIN = 2;
const MA_CROSS_PERIOD_MAX = 500;

const ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const CROSS_DIRS    = ['cross_up', 'cross_down'];
const FILTER_MODES  = ['strict_above', 'adaptive', 'below', 'off'];
const RSI_PERIODS   = [7, 14, 21];
const RSI_OPS       = ['<', '<=', '>', '>='];

const MA_CROSS_DEFAULTS = {
  kind: 'ma_cross',
  label: 'MA Cross',

  entry: {
    enabled:      true,
    ma1:          { period: 9,  interval: '15m' },
    ma2:          { period: 21, interval: '15m' },
    direction:    'cross_up',
    tolerancePct: 0.1,
  },

  maFiltersEnabled: true,
  maFilters: [{
    id: 1, enabled: true, period: 50, interval: '1h',
    mode: 'adaptive', maxDipPct: 4, fixedDipPct: null, tolerancePct: 0,
  }],

  exit: {
    logic: 'any',
    maCross: {
      enabled:      true,
      ma1:          { period: 9,  interval: '15m' },
      ma2:          { period: 21, interval: '15m' },
      direction:    'cross_down',
      tolerancePct: 0.1,
    },
    rsi: {
      enabled:    false,
      logic:      'any',
      conditions: [
        { enabled: true, interval: '15m', period: 14, operator: '>', value: 70 },
      ],
    },
  },

  stopLoss: { enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5 },

  execution: {
    immediateEntry:       true,
    entryDiscount:        0.001,
    pendingTimeoutMs:     30 * 60_000,
    pendingCancelPct:     0.002,
    pendingCancelOnExitRsi: true,
  },

  polling: { pollMs: 60_000, fastPollMs: 30_000 },

  adaptiveOpts: {
    defaultPct:  3,
    maxPct:      8,
    minPct:      0.5,
    minEpisodes: 3,
  },

  volume: {
    minVolumeUsdt:  1_000_000,
    allowLowVolume: false,
  },
};

function isValidMaCrossPeriod(p) {
  const n = parseInt(p, 10);
  return Number.isFinite(n) && n >= MA_CROSS_PERIOD_MIN && n <= MA_CROSS_PERIOD_MAX;
}

function clampPeriod(p, fb = 50) {
  const n = Number(p);
  if (!Number.isFinite(n) || n < MA_CROSS_PERIOD_MIN) return fb;
  return Math.min(MA_CROSS_PERIOD_MAX, Math.round(n));
}

function normalizeInterval(iv, fb) {
  return ALL_INTERVALS.includes(iv) ? iv : fb;
}

function normalizeMaLeg(m, fallback) {
  const fb = fallback ?? { period: 50, interval: '1h' };
  return {
    period:   clampPeriod(m?.period, fb.period),
    interval: normalizeInterval(m?.interval, fb.interval),
  };
}

function normalizeCrossBlock(block, fallback) {
  const fb = fallback ?? MA_CROSS_DEFAULTS.entry;
  return {
    enabled:      block?.enabled !== false,
    ma1:          normalizeMaLeg(block?.ma1 ?? block?.param1, fb.ma1),
    ma2:          normalizeMaLeg(block?.ma2 ?? block?.param2, fb.ma2),
    direction:    CROSS_DIRS.includes(block?.direction) ? block.direction : fb.direction,
    tolerancePct: Math.max(0, Number(block?.tolerancePct ?? fb.tolerancePct ?? 0)),
  };
}

function normalizeMaFilter(m, i = 0) {
  const mode = FILTER_MODES.includes(m?.mode) ? m.mode : 'strict_above';
  return {
    id:       m?.id ?? i + 1,
    enabled:  m?.enabled !== false && mode !== 'off',
    period:   clampPeriod(m?.period, 50),
    interval: normalizeInterval(m?.interval, '1h'),
    mode,
    maxDipPct:   Math.max(0, Number(m?.maxDipPct ?? 4)),
    fixedDipPct: m?.fixedDipPct != null && m?.fixedDipPct !== '' ? Number(m?.fixedDipPct) : null,
    tolerancePct: Math.max(0, Number(m?.tolerancePct ?? 0)),
  };
}

function normalizeRsiCondition(c, i = 0) {
  const fb = MA_CROSS_DEFAULTS.exit.rsi.conditions[0];
  return {
    id:       c?.id ?? i + 1,
    enabled:  c?.enabled !== false,
    interval: normalizeInterval(c?.interval, fb.interval),
    period:   Number(c?.period ?? fb.period),
    operator: RSI_OPS.includes(c?.operator) ? c.operator : fb.operator,
    value:    Number(c?.value ?? fb.value),
  };
}

function migrateMaFilters(body) {
  if (Array.isArray(body.maFilters) && body.maFilters.length) {
    return body.maFilters.map(normalizeMaFilter);
  }
  const pf = body.priceFilter ?? body.param3;
  if (!pf) return MA_CROSS_DEFAULTS.maFilters.map(f => ({ ...f }));
  return [normalizeMaFilter({
    ...pf,
    mode: pf.mode ?? 'strict_above',
    enabled: pf.enabled !== false,
  })];
}

function normalizeMaCrossConfig(body = {}) {
  const d = MA_CROSS_DEFAULTS;
  const exitBody = body.exit ?? {};

  const maCrossExit = normalizeCrossBlock(
    exitBody.maCross ?? (exitBody.ma1 ? exitBody : null) ?? d.exit.maCross,
    d.exit.maCross,
  );

  const rsiRaw = exitBody.rsi ?? {};
  const rsiConditions = Array.isArray(rsiRaw.conditions) && rsiRaw.conditions.length
    ? rsiRaw.conditions.map(normalizeRsiCondition)
    : rsiRaw.interval
      ? [normalizeRsiCondition(rsiRaw)]
      : d.exit.rsi.conditions.map(normalizeRsiCondition);

  return {
    label: body.label ?? d.label,
    kind:  'ma_cross',
    entry: normalizeCrossBlock(body.entry, d.entry),
    maFiltersEnabled: body.maFiltersEnabled !== false,
    maFilters: migrateMaFilters(body),
    exit: {
      logic: ['any', 'all'].includes(exitBody.logic) ? exitBody.logic : d.exit.logic,
      maCross: {
        ...maCrossExit,
        enabled: exitBody.maCross?.enabled ?? (exitBody.ma1 ? true : d.exit.maCross.enabled),
      },
      rsi: {
        enabled:    rsiRaw.enabled === true,
        logic:      ['any', 'all'].includes(rsiRaw.logic) ? rsiRaw.logic : d.exit.rsi.logic,
        conditions: rsiConditions,
      },
    },
    stopLoss: {
      enabled:      body.stopLoss?.enabled !== false,
      maxLossPct:   Math.max(0.5, Number(body.stopLoss?.maxLossPct ?? d.stopLoss.maxLossPct)),
      trailing:     body.stopLoss?.trailing !== false,
      trailStepPct: Math.max(0.5, Number(body.stopLoss?.trailStepPct ?? body.stopLoss?.maxLossPct ?? d.stopLoss.trailStepPct)),
    },
    execution: {
      immediateEntry:         body.execution?.immediateEntry !== false,
      entryDiscount:          Number(body.execution?.entryDiscount ?? d.execution.entryDiscount),
      pendingTimeoutMs:       Number(body.execution?.pendingTimeoutMs ?? d.execution.pendingTimeoutMs),
      pendingCancelPct:       Number(body.execution?.pendingCancelPct ?? d.execution.pendingCancelPct),
      pendingCancelOnExitRsi: body.execution?.pendingCancelOnExitRsi ?? d.execution.pendingCancelOnExitRsi,
    },
    polling: {
      pollMs:     Number(body.polling?.pollMs ?? d.polling.pollMs),
      fastPollMs: Number(body.polling?.fastPollMs ?? d.polling.fastPollMs),
    },
    adaptiveOpts: {
      ...d.adaptiveOpts,
      ...(body.adaptiveOpts ?? {}),
      maxPct: Math.max(0.5, Number(body.adaptiveOpts?.maxPct ?? d.adaptiveOpts.maxPct)),
    },
    volume: {
      minVolumeUsdt:  Number(body.volume?.minVolumeUsdt ?? d.volume.minVolumeUsdt),
      allowLowVolume: body.volume?.allowLowVolume === true,
    },
  };
}

function toEngineConfig(normalized) {
  const c = normalized ?? normalizeMaCrossConfig();
  return {
    ...c,
    minVolumeUsdt:    c.volume.minVolumeUsdt,
    allowLowVolume:   c.volume.allowLowVolume,
    pollMs:           c.polling.pollMs,
    fastPollMs:       c.polling.fastPollMs,
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
  if (tc?.kind === 'ma_cross') return toEngineConfig(normalizeMaCrossConfig(tc));
  return null;
}

function resolveStrategy(row) {
  const config = configFromRow(row);
  if (!config) return null;
  return {
    config,
    label: config.label,
    pollMs:           config.pollMs,
    fastPollMs:       config.fastPollMs,
    entryDiscount:    config.entryDiscount,
    immediateEntry:   config.immediateEntry,
    pendingTimeoutMs: config.pendingTimeoutMs,
    pendingCancelPct: config.pendingCancelPct,
    pendingCancelOnExitRsi: config.pendingCancelOnExitRsi,
  };
}

function toFormState(body) {
  return normalizeMaCrossConfig(body);
}

function formStateToPayload(form) {
  return normalizeMaCrossConfig(form);
}

module.exports = {
  MA_CROSS_PERIOD_MIN,
  MA_CROSS_PERIOD_MAX,
  isValidMaCrossPeriod,
  MA_CROSS_DEFAULTS,
  ALL_INTERVALS,
  CROSS_DIRS,
  FILTER_MODES,
  RSI_PERIODS,
  normalizeMaCrossConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toFormState,
  formStateToPayload,
};
