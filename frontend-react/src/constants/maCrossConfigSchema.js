/** Schema MA Cross livre — espelho de backend/bot/ma-cross/tradeConfigSchema.js */

import {
  RSI_INTERVALS, RSI_PERIODS, RSI_OPERATORS,
  VOLUME_OPTIONS, PENDING_TIMEOUT_OPTIONS, POLL_OPTIONS,
} from './tradeConfigSchema';

export const MA_CROSS_PERIOD_MIN = 2;
export const MA_CROSS_PERIOD_MAX = 500;
export const MA_CROSS_INTERVALS = RSI_INTERVALS;
export const MA_PERIOD_PRESETS  = [9, 12, 20, 21, 50, 100, 200];

export const CROSS_DIRECTIONS = [
  { id: 'cross_up',   label: 'Cruzamento ↑ (param1 acima de param2)' },
  { id: 'cross_down', label: 'Cruzamento ↓ (param1 abaixo de param2)' },
];

export const PRICE_FILTER_MODES = [
  { id: 'strict_above', label: 'Preço acima da EMA' },
  { id: 'adaptive',     label: 'Pullback adaptativo (% abaixo da EMA)' },
  { id: 'below',        label: 'Preço abaixo da EMA' },
  { id: 'off',          label: 'Desligado' },
];

export const EXIT_LOGIC_OPTIONS = [
  { id: 'any', label: 'Qualquer sinal de saída (OU)' },
  { id: 'all', label: 'Todos os sinais ativos (E)' },
];

export { RSI_INTERVALS, RSI_PERIODS, RSI_OPERATORS, VOLUME_OPTIONS, PENDING_TIMEOUT_OPTIONS, POLL_OPTIONS };

export const MA_CROSS_DEFAULTS = {
  label: 'MA Cross',
  kind: 'ma_cross',
  entry: {
    enabled: true,
    ma1: { period: 9, interval: '15m' },
    ma2: { period: 21, interval: '15m' },
    direction: 'cross_up',
    tolerancePct: 0.1,
    maxAboveMaPct: 3,
  },
  maFiltersEnabled: true,
  maFilters: [{
    id: 1, enabled: true, period: 50, interval: '1h',
    mode: 'adaptive', maxDipPct: 4, fixedDipPct: '', maxAbovePct: 4, fixedAbovePct: '',
  }],
  exit: {
    logic: 'any',
    maCross: {
      enabled: true,
      ma1: { period: 9, interval: '15m' },
      ma2: { period: 21, interval: '15m' },
      direction: 'cross_down',
      tolerancePct: 0.1,
    },
    rsi: {
      enabled: false,
      logic: 'any',
      conditions: [
        { id: 1, enabled: true, interval: '15m', period: 14, operator: '>', value: 70 },
      ],
    },
  },
  stopLoss: { enabled: true, maxLossPct: 5 },
  execution: {
    immediateEntry: false,
    entryDiscount: 0.001,
    pendingTimeoutMs: 90 * 60_000,
    pendingCancelPct: 0.002,
    pendingCancelOnExitRsi: true,
    pullbackEntry: { enabled: true, waitCandles: 2, requirePullback: true },
  },
  polling: { pollMs: 60_000, fastPollMs: 30_000 },
  adaptiveOpts: { defaultPct: 3, maxPct: 8, minPct: 0.5, minEpisodes: 3, defaultAbovePct: 4, maxAbovePct: 8, minAbovePct: 0.5 },
  volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false },
  entryCooldownHours: 4,
};

function clampPeriod(p, fb = 50) {
  const n = Number(p);
  if (!Number.isFinite(n) || n < 2) return fb;
  return Math.min(500, Math.round(n));
}

function normalizeMaLeg(m, fb) {
  return {
    period: clampPeriod(m?.period, fb.period),
    interval: m?.interval ?? fb.interval,
  };
}

function normalizeCrossBlock(block, fb) {
  return {
    enabled: block?.enabled !== false,
    ma1: normalizeMaLeg(block?.ma1 ?? block?.param1, fb.ma1),
    ma2: normalizeMaLeg(block?.ma2 ?? block?.param2, fb.ma2),
    direction: block?.direction ?? fb.direction,
    tolerancePct: Number(block?.tolerancePct ?? fb.tolerancePct ?? 0),
    maxAboveMaPct: Math.max(0, Number(block?.maxAboveMaPct ?? fb.maxAboveMaPct ?? 0)),
  };
}

function mapMaFilters(list, legacyPf) {
  if (Array.isArray(list) && list.length) {
    return list.map((m, i) => ({
      id: m.id ?? i + 1,
      enabled: m.enabled !== false && m.mode !== 'off',
      period: clampPeriod(m.period, 50),
      interval: m.interval ?? '1h',
      mode: m.mode ?? 'strict_above',
      maxDipPct: Number(m.maxDipPct ?? 4),
      fixedDipPct: m.fixedDipPct ?? '',
      maxAbovePct: Number(m.maxAbovePct ?? 4),
      fixedAbovePct: m.fixedAbovePct ?? '',
      tolerancePct: Number(m.tolerancePct ?? 0),
    }));
  }
  if (legacyPf) {
    return [{
      id: 1,
      enabled: legacyPf.enabled !== false,
      period: clampPeriod(legacyPf.period, 50),
      interval: legacyPf.interval ?? '1h',
      mode: legacyPf.mode ?? 'adaptive',
      maxDipPct: Number(legacyPf.maxDipPct ?? 4),
      fixedDipPct: legacyPf.fixedDipPct ?? '',
      tolerancePct: Number(legacyPf.tolerancePct ?? 0),
    }];
  }
  return MA_CROSS_DEFAULTS.maFilters.map(f => ({ ...f }));
}

function mapRsiConditions(list) {
  const d = MA_CROSS_DEFAULTS.exit.rsi.conditions;
  const src = list?.length ? list : d;
  return src.map((c, i) => ({
    id: c.id ?? i + 1,
    enabled: c.enabled !== false,
    interval: c.interval ?? d[0].interval,
    period: Number(c.period ?? d[0].period),
    operator: c.operator ?? d[0].operator,
    value: Number(c.value ?? d[0].value),
  }));
}

export function normalizeMaCrossForm(body = {}) {
  const d = MA_CROSS_DEFAULTS;
  const exit = body.exit ?? {};
  const maCross = exit.maCross ?? (exit.ma1 ? exit : null) ?? d.exit.maCross;

  return {
    label: body.label ?? d.label,
    kind: 'ma_cross',
    entry: normalizeCrossBlock(body.entry ?? d.entry, d.entry),
    maFiltersEnabled: body.maFiltersEnabled !== false,
    maFilters: mapMaFilters(body.maFilters, body.priceFilter),
    exit: {
      logic: exit.logic ?? d.exit.logic,
      maCross: normalizeCrossBlock(maCross, d.exit.maCross),
      rsi: {
        enabled: exit.rsi?.enabled === true,
        logic: exit.rsi?.logic ?? d.exit.rsi.logic,
        conditions: mapRsiConditions(exit.rsi?.conditions),
      },
    },
    stopLoss: {
      enabled: body.stopLoss?.enabled !== false,
      maxLossPct: Number(body.stopLoss?.maxLossPct ?? d.stopLoss.maxLossPct),
    },
    execution: {
      ...d.execution,
      ...body.execution,
      pullbackEntry: {
        ...d.execution.pullbackEntry,
        ...body.execution?.pullbackEntry,
      },
    },
    polling: { ...d.polling, ...body.polling },
    adaptiveOpts: { ...d.adaptiveOpts, ...body.adaptiveOpts },
    volume: { ...d.volume, ...body.volume },
    entryCooldownHours: Number(body.entryCooldownHours ?? d.entryCooldownHours ?? 4),
  };
}

export function maCrossFormFromEntry(entry) {
  if (entry?.tradeConfig?.kind === 'ma_cross') return normalizeMaCrossForm(entry.tradeConfig);
  if (entry?.kind === 'ma_cross') return normalizeMaCrossForm(entry);
  return normalizeMaCrossForm(entry);
}

export function maCrossFormToPayload(form, meta = {}) {
  const c = normalizeMaCrossForm(form);
  return {
    ...meta,
    kind: 'ma_cross',
    label: c.label,
    entry: c.entry,
    maFiltersEnabled: c.maFiltersEnabled,
    maFilters: c.maFilters.map(({ id, enabled, period, interval, mode, maxDipPct, fixedDipPct, maxAbovePct, fixedAbovePct, tolerancePct }) => ({
      id, enabled, period, interval, mode, maxDipPct, maxAbovePct, tolerancePct,
      ...(fixedDipPct !== '' && fixedDipPct != null ? { fixedDipPct: Number(fixedDipPct) } : {}),
      ...(fixedAbovePct !== '' && fixedAbovePct != null ? { fixedAbovePct: Number(fixedAbovePct) } : {}),
    })),
    exit: {
      logic: c.exit.logic,
      maCross: c.exit.maCross,
      rsi: {
        enabled: c.exit.rsi.enabled,
        logic: c.exit.rsi.logic,
        conditions: c.exit.rsi.conditions
          .filter(cond => cond.enabled)
          .map(({ interval, period, operator, value }) => ({ enabled: true, interval, period, operator, value })),
      },
    },
    stopLoss: c.stopLoss,
    execution: c.execution,
    polling: c.polling,
    adaptiveOpts: c.adaptiveOpts,
    volume: c.volume,
    entryCooldownHours: c.entryCooldownHours,
  };
}
