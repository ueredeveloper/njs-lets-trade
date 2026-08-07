'use strict';

const { normalizeVwapBandsConfig, toEngineConfig } = require('./tradeConfigSchema');

const STRATEGY_IDS = ['vwap-bands'];

const PRESET_BODIES = {
  'vwap-bands': {
    label: 'VWAP Bands',
    kind: 'vwap_bands',
    entry: {
      enabled: true,
      interval: '1h',
      vwapInterval: '4h',
      session: 'weekly',
      minBandDistancePct: 3,
      reclaimLookbackCandles: 24,
      pullback: { waitCandles: 5, tolerancePct: 1, pollInterval: '5m' },
    },
    exit: { tolerancePct: 0, fastCheck: { enabled: true, proximityPct: 1 } },
    stopLoss: { enabled: true, mode: 'ladder', tolerancePct: 0, maxLossPct: 5, trailing: true, trailStepPct: 5 },
    execution: { entryDiscount: 0.001 },
    polling: { pollMs: 60_000, fastPollMs: 30_000 },
    volume: { minVolumeUsdt: 1_000_000 },
  },
};

function isVwapBandsStrategy(id) {
  return STRATEGY_IDS.includes(id);
}

function normalizeStrategyId(id) {
  return STRATEGY_IDS.includes(id) ? id : 'vwap-bands';
}

function getStrategyPresetBody(strategyId) {
  return PRESET_BODIES[normalizeStrategyId(strategyId)] ?? PRESET_BODIES['vwap-bands'];
}

function resolveConfigBody(row) {
  if (row?.trade_config?.kind) return row.trade_config;
  const sid = row?.strategy_id;
  if (!isVwapBandsStrategy(sid)) return null;
  return getStrategyPresetBody(sid);
}

function buildTradeConfig(body) {
  return toEngineConfig(normalizeVwapBandsConfig(body));
}

module.exports = {
  STRATEGY_IDS,
  PRESET_BODIES,
  isVwapBandsStrategy,
  normalizeStrategyId,
  getStrategyPresetBody,
  resolveConfigBody,
  buildTradeConfig,
};
