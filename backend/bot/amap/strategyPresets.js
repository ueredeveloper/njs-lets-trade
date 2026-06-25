'use strict';

const { flatConfigToBody } = require('./tradeConfigSchema');

/** Presets AMAP por strategy_id — espelho de frontend-react/src/constants/strategyPresets.js */

const STRATEGY_IDS = ['amap-15m', 'amap-1h'];

const PRESET_BODIES = {
  'amap-15m': {
    label: 'AMAP 15m Swing',
    rule1: {
      enabled: true,
      maFiltersEnabled: true,
      entryRsi: { value: 30, period: 14, interval: '15m', operator: '<' },
      exitRsi:  { value: 70, period: 14, interval: '15m', operator: '>' },
      maConditions: [
        { mode: 'adaptive', period: 50, interval: '1h', fixedDipPct: 2.42, aboveMaCandles: 3, aboveMaEnabled: true },
        { mode: 'adaptive', period: 50, interval: '4h', fixedDipPct: 5,    aboveMaCandles: 3, aboveMaEnabled: true },
      ],
      extension: {
        enabled: true, maPeriod: 50, maInterval: '1h', abovePct: 5,
        threeCandles: true, fourCandles: true, confirmLogic: 'any',
        threeInterval: '1h', fourInterval: '1h',
      },
      stopLoss: {
        period: 50, interval: '4h', maxLossPct: 5,
        fixedEnabled: true, adaptiveEnabled: false, pctCapEnabled: true,
      },
      execution: {
        immediateEntry: true, entryDiscount: 0.001,
        pendingTimeoutMs: 30 * 60_000, pendingCancelPct: 0.002,
        pendingCancelOnExitRsi: true,
      },
      adaptiveOpts: { maxPct: 5, minPct: 0.5, defaultPct: 3, minEpisodes: 3 },
    },
    rule2: {
      enabled: true,
      entryMa: { period: 50, trigger: 'cross_up', interval: '1h', tolerancePct: 0.5, aboveMaCandles: 10, aboveMaEnabled: true },
      exitRsiConditions: [
        { enabled: true, value: 70, period: 14, interval: '15m', operator: '>' },
        { enabled: true, value: 80, period: 14, interval: '15m', operator: '>' },
      ],
      exitRsiLogic: 'any',
      stopLoss: { adaptiveEnabled: false },
      entryDiscount: 0.02,
      pendingTimeoutMs: 30 * 60_000,
      pendingCancelPct: 0.002,
      pendingCancelOnExitRsi: true,
      adaptiveOpts: { maxPct: 8, minPct: 0.5, defaultPct: 3, minEpisodes: 3 },
    },
    polling: { pollMs: 60_000, fastPollMs: 30_000, fastRsiThreshold: 65 },
    volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false, aggressiveExitOnLowVolume: true },
  },
  'amap-1h': {
    label: 'AMAP 1h Swing',
    rule1: {
      enabled: true,
      maFiltersEnabled: true,
      entryRsi: { value: 35, period: 14, interval: '1h', operator: '<' },
      exitRsi:  { value: 65, period: 14, interval: '1h', operator: '>' },
      maConditions: [
        { mode: 'adaptive', period: 50, interval: '4h', fixedDipPct: 3.5, aboveMaCandles: 5, aboveMaEnabled: true },
        { mode: 'adaptive', period: 50, interval: '1d', fixedDipPct: 6,   aboveMaCandles: 3, aboveMaEnabled: true },
      ],
      extension: {
        enabled: true, maPeriod: 50, maInterval: '4h', abovePct: 7,
        threeCandles: true, fourCandles: true, confirmLogic: 'any',
        threeInterval: '4h', fourInterval: '4h',
      },
      stopLoss: {
        period: 50, interval: '1d', maxLossPct: 5,
        fixedEnabled: true, adaptiveEnabled: false, pctCapEnabled: true,
      },
      execution: {
        immediateEntry: false, entryDiscount: 0.015,
        pendingTimeoutMs: 2 * 60 * 60_000, pendingCancelPct: 0.003,
        pendingCancelOnExitRsi: true,
      },
      adaptiveOpts: { maxPct: 5, minPct: 0.5, defaultPct: 3, minEpisodes: 3 },
    },
    rule2: {
      enabled: true,
      entryMa: { period: 50, trigger: 'cross_up', interval: '4h', tolerancePct: 0.8, aboveMaCandles: 8, aboveMaEnabled: true },
      exitRsiConditions: [
        { enabled: true, value: 70, period: 14, interval: '1h', operator: '>' },
        { enabled: true, value: 75, period: 14, interval: '4h', operator: '>' },
      ],
      exitRsiLogic: 'any',
      stopLoss: { adaptiveEnabled: true },
      entryDiscount: 0.025,
      pendingTimeoutMs: 2 * 60 * 60_000,
      pendingCancelPct: 0.003,
      pendingCancelOnExitRsi: true,
      adaptiveOpts: { maxPct: 8, minPct: 0.5, defaultPct: 3, minEpisodes: 3 },
    },
    polling: { pollMs: 5 * 60_000, fastPollMs: 60_000, fastRsiThreshold: 60 },
    volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false, aggressiveExitOnLowVolume: true },
  },
};

function normalizeStrategyId(id) {
  if (!id || id === 'flex') return 'amap-15m';
  return STRATEGY_IDS.includes(id) ? id : 'amap-15m';
}

function getStrategyPresetBody(strategyId) {
  return PRESET_BODIES[normalizeStrategyId(strategyId)] ?? PRESET_BODIES['amap-15m'];
}

/** Row DB ou strategy_id → body para normalizeTradeConfig / buildTradeConfig */
function resolveConfigBody(row) {
  if (row?.trade_config) return flatConfigToBody(row.trade_config);
  const sid = normalizeStrategyId(row?.strategy_id);
  return getStrategyPresetBody(sid);
}

module.exports = {
  STRATEGY_IDS,
  PRESET_BODIES,
  normalizeStrategyId,
  getStrategyPresetBody,
  resolveConfigBody,
};
