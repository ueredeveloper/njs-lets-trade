'use strict';

const { normalizeSwingConfig, toEngineConfig } = require('./tradeConfigSchema');

/** Presets Swing — duas estratégias por símbolo (RSI 1h e MA50 8h) */

const STRATEGY_IDS = ['swing-rsi-1h', 'swing-ma50-8h'];

const PRESET_BODIES = {
  'swing-rsi-1h': {
    label: 'Swing RSI 1h',
    kind:  'rsi',
    entryRsi:  { value: 30, period: 14, interval: '1h', operator: '<' },
    exitRsi:   { value: 75, period: 14, interval: '1h', operator: '>' },
    entryMaFilter: { enabled: true, period: 50, interval: '8h', mode: 'strict_above' },
    stopLoss:  { enabled: true, maxLossPct: 5 },
    execution: { immediateEntry: true, entryDiscount: 0.01, pendingTimeoutMs: 60 * 60_000 },
    polling:   { pollMs: 5 * 60_000, fastPollMs: 60_000, fastRsiThreshold: 72 },
    volume:    { minVolumeUsdt: 1_000_000, allowLowVolume: false },
  },
  'swing-ma50-8h': {
    label: 'Swing MA50 8h',
    kind:  'ma',
    entryMa: {
      period: 50, interval: '8h', trigger: 'cross_up',
      tolerancePct: 0.5, aboveMaCandles: 3, aboveMaEnabled: true,
    },
    exitRsi:   { value: 80, period: 14, interval: '4h', operator: '>' },
    entryMaFilter: { enabled: false },
    stopLoss:  { enabled: true, maxLossPct: 5 },
    execution: { immediateEntry: true, entryDiscount: 0.01, pendingTimeoutMs: 2 * 60 * 60_000 },
    polling:   { pollMs: 5 * 60_000, fastPollMs: 60_000, fastRsiThreshold: 75 },
    volume:    { minVolumeUsdt: 1_000_000, allowLowVolume: false },
  },
};

function isSwingStrategy(id) {
  return STRATEGY_IDS.includes(normalizeStrategyId(id));
}

function normalizeStrategyId(id) {
  if (!id) return 'swing-rsi-1h';
  return STRATEGY_IDS.includes(id) ? id : 'swing-rsi-1h';
}

function getStrategyPresetBody(strategyId) {
  return PRESET_BODIES[normalizeStrategyId(strategyId)] ?? PRESET_BODIES['swing-rsi-1h'];
}

function resolveConfigBody(row) {
  if (row?.trade_config?.kind) return row.trade_config;
  const sid = row?.strategy_id;
  if (!isSwingStrategy(sid)) return null;
  return getStrategyPresetBody(sid);
}

function buildTradeConfig(body) {
  return toEngineConfig(normalizeSwingConfig(body));
}

module.exports = {
  STRATEGY_IDS,
  PRESET_BODIES,
  isSwingStrategy,
  normalizeStrategyId,
  getStrategyPresetBody,
  resolveConfigBody,
  buildTradeConfig,
};
