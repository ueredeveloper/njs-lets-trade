'use strict';

const { normalizeBollingerBandsConfig, toEngineConfig } = require('./tradeConfigSchema');

const STRATEGY_IDS = ['bollinger-bands'];

const PRESET_BODIES = {
  'bollinger-bands': {
    label: 'Bollinger Bands',
    kind: 'bollinger_bands',
    entry: {
      enabled: true,
      interval: '4h',
      period: 20,
      stdDev: 2,
      pullback: { enabled: false, belowPct: 2 },
      emaFilter: {
        enabled: true, period: 50, interval: '4h', maxDipPct: 2,
        slopeLookback: 5, minSlopePct: 0,
      },
    },
    exit: { restingBracket: { enabled: true, driftPct: 3 } },
    stopLoss: {
      enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5,
      mode: 'fixed',
      ema: { period: 50, interval: '4h', belowPct: 2 },
    },
    polling: { pollMs: 60_000, fastPollMs: 30_000 },
    volume: { minVolumeUsdt: 1_000_000 },
  },
};

function isBollingerBandsStrategy(id) {
  return STRATEGY_IDS.includes(id);
}

function normalizeStrategyId(id) {
  return STRATEGY_IDS.includes(id) ? id : 'bollinger-bands';
}

function getStrategyPresetBody(strategyId) {
  return PRESET_BODIES[normalizeStrategyId(strategyId)] ?? PRESET_BODIES['bollinger-bands'];
}

function resolveConfigBody(row) {
  if (row?.trade_config?.kind) return row.trade_config;
  const sid = row?.strategy_id;
  if (!isBollingerBandsStrategy(sid)) return null;
  return getStrategyPresetBody(sid);
}

function buildTradeConfig(body) {
  return toEngineConfig(normalizeBollingerBandsConfig(body));
}

module.exports = {
  STRATEGY_IDS,
  PRESET_BODIES,
  isBollingerBandsStrategy,
  normalizeStrategyId,
  getStrategyPresetBody,
  resolveConfigBody,
  buildTradeConfig,
};
