'use strict';

const { normalizeRsiMomentumConfig, toEngineConfig } = require('./tradeConfigSchema');

const STRATEGY_IDS = ['rsi-momentum'];

const PRESET_BODIES = {
  'rsi-momentum': {
    label: 'RSI Momentum',
    kind: 'rsi_momentum',
    entry: {
      enabled: true,
      interval: '15m',
      rsiThreshold: 70,
      pullback: { enabled: false, belowPct: 1 },
      limitWaitCandles: 20,
      reentryCooldownCandles: 3,
      bandWidth: { enabled: false, interval: '5m', period: 20, stdDev: 2, lookback: 300, minPct: 2 },
    },
    exit: { restingBracket: { enabled: true, targetPct: 5 } },
    stopLoss: { enabled: true, maxLossPct: 5 },
    polling: { pollMs: 60_000, fastPollMs: 20_000 },
    volume: { minVolumeUsdt: 1_000_000 },
    entryCooldownHours: 0,
  },
};

function isRsiMomentumStrategy(id) {
  return STRATEGY_IDS.includes(id);
}

function normalizeStrategyId(id) {
  return STRATEGY_IDS.includes(id) ? id : 'rsi-momentum';
}

function getStrategyPresetBody(strategyId) {
  return PRESET_BODIES[normalizeStrategyId(strategyId)] ?? PRESET_BODIES['rsi-momentum'];
}

function resolveConfigBody(row) {
  if (row?.trade_config?.kind) return row.trade_config;
  const sid = row?.strategy_id;
  if (!isRsiMomentumStrategy(sid)) return null;
  return getStrategyPresetBody(sid);
}

function buildTradeConfig(body) {
  return toEngineConfig(normalizeRsiMomentumConfig(body));
}

module.exports = {
  STRATEGY_IDS,
  PRESET_BODIES,
  isRsiMomentumStrategy,
  normalizeStrategyId,
  getStrategyPresetBody,
  resolveConfigBody,
  buildTradeConfig,
};
