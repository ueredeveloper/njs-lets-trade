'use strict';

const { normalizeMaCrossConfig, toEngineConfig } = require('./tradeConfigSchema');

const STRATEGY_IDS = ['ma-cross'];

const PRESET_BODIES = {
  'ma-cross': {
    label: 'MA Cross',
    kind:  'ma_cross',
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
      mode: 'adaptive', maxDipPct: 4,
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
        conditions: [{ enabled: true, interval: '15m', period: 14, operator: '>', value: 70 }],
      },
    },
    stopLoss:  { enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5 },
    execution: {
      immediateEntry: false,
      entryDiscount: 0.001,
      pendingTimeoutMs: 90 * 60_000,
      pullbackEntry: { enabled: true, waitCandles: 2, requirePullback: true },
    },
    polling:   { pollMs: 60_000, fastPollMs: 30_000 },
    adaptiveOpts: { defaultPct: 3, maxPct: 8, minPct: 0.5, minEpisodes: 3 },
    volume:    { minVolumeUsdt: 1_000_000, allowLowVolume: false },
    entryCooldownHours: 4,
  },
};

function isMaCrossStrategy(id) {
  return STRATEGY_IDS.includes(normalizeStrategyId(id));
}

function normalizeStrategyId(id) {
  if (!id) return 'ma-cross';
  return STRATEGY_IDS.includes(id) ? id : 'ma-cross';
}

function getStrategyPresetBody(strategyId) {
  return PRESET_BODIES[normalizeStrategyId(strategyId)] ?? PRESET_BODIES['ma-cross'];
}

function resolveConfigBody(row) {
  if (row?.trade_config?.kind === 'ma_cross') return row.trade_config;
  const sid = row?.strategy_id;
  if (!isMaCrossStrategy(sid)) return null;
  return getStrategyPresetBody(sid);
}

function buildTradeConfig(body) {
  return toEngineConfig(normalizeMaCrossConfig(body));
}

module.exports = {
  STRATEGY_IDS,
  PRESET_BODIES,
  isMaCrossStrategy,
  normalizeStrategyId,
  getStrategyPresetBody,
  resolveConfigBody,
  buildTradeConfig,
};
