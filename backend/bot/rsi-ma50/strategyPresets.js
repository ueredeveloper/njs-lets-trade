'use strict';

/**
 * Presets nomeados → trade_config (AMAP).
 * Substitui STRATEGIES hardcoded — um único motor, parâmetros explícitos.
 */

const { buildTradeConfig } = require('./strategyEngine');

/** Config padrão do formulário Multi-Trade */
const DEFAULT_FLEX_BODY = {
  entryRsi: { interval: '15m', value: 30 },
  exitRsi:  { interval: '15m', value: 70 },
  maConditions: [
    { period: 50, interval: '4h', adaptive: false },
    { period: 50, interval: '1h', adaptive: true  },
  ],
  rule3candles: true,
  rule4candles: true,
  stopLoss: { period: 50, interval: '1h' },
  extension: { abovePct: 5, confirmInterval: '1h' },
};

/**
 * Cada preset: { label, body } → buildTradeConfig(body)
 * body pode incluir entryDiscount, pollMs, fastPollMs, etc.
 */
const PRESETS = {
  flex: {
    label: 'AMAP flex (padrão UI)',
    body: DEFAULT_FLEX_BODY,
  },
  rsi15m_4h: {
    label: 'RSI(15m)<30 → RSI(15m)>70 | MA50(4h) fixo | MA50(1h) adaptativo',
    body: {
      entryRsi: { interval: '15m', value: 30 },
      exitRsi:  { interval: '15m', value: 70 },
      maConditions: [
        { period: 50, interval: '4h', adaptive: false },
        { period: 50, interval: '1h', adaptive: true  },
      ],
      rule3candles: false,
      rule4candles: false,
      stopLoss: { period: 50, interval: '4h' },
      entryDiscount:    0.01,
      pendingTimeoutMs: 2 * 60 * 60_000,
      pendingCancelPct: 0.005,
      fastRsiThreshold: 60,
      pollMs:           5 * 60_000,
      fastPollMs:       2 * 60_000,
    },
  },
  rsi5m30_15m70: {
    label: 'RSI(5m)<30 → RSI(15m)>70 + MA50(1h) + extensão 3/4',
    body: {
      entryRsi: { interval: '5m',  value: 30 },
      exitRsi:  { interval: '15m', value: 70 },
      maConditions: [{ period: 50, interval: '1h', adaptive: false }],
      rule3candles: true,
      rule4candles: true,
      stopLoss: { period: 50, interval: '1h' },
      extension: { abovePct: 5, confirmInterval: '1h' },
      fastRsiThreshold: 60,
      pollMs: 60_000,
      fastPollMs: 30_000,
    },
  },
  rsi1h35_15m85: {
    label: 'RSI(1h)<35 → RSI(15m)>85 + MA50(1h)',
    body: {
      entryRsi: { interval: '1h',  value: 35 },
      exitRsi:  { interval: '15m', value: 85 },
      maConditions: [{ period: 50, interval: '1h', adaptive: false }],
      rule3candles: true,
      rule4candles: true,
      stopLoss: { period: 50, interval: '1h' },
      extension: { abovePct: 5, confirmInterval: '1h' },
      pendingTimeoutMs: 2 * 60 * 60_000,
      pendingCancelPct: 0.005,
      fastRsiThreshold: 75,
      pollMs: 5 * 60_000,
      fastPollMs: 60_000,
    },
  },
  rsi1m30_1m70: {
    label: 'RSI(1m)<30 → RSI(1m)>70 (sem MA)',
    body: {
      entryRsi: { interval: '1m', value: 30 },
      exitRsi:  { interval: '1m', value: 70 },
      maConditions: [],
      rule3candles: false,
      rule4candles: false,
      stopLoss: { period: 50, interval: '1h' },
      immediateEntry: true,
      fastRsiThreshold: 60,
      pollMs: 60_000,
      fastPollMs: 30_000,
    },
  },
  rsi1m30_1m70_ma: {
    label: 'RSI(1m)<30 → RSI(1m)>70 + MA50(1h+15m)',
    body: {
      entryRsi: { interval: '1m', value: 30 },
      exitRsi:  { interval: '1m', value: 70 },
      maConditions: [
        { period: 50, interval: '1h',  adaptive: false },
        { period: 50, interval: '15m', adaptive: false },
      ],
      rule3candles: true,
      rule4candles: true,
      stopLoss: { period: 50, interval: '15m' },
      extension: { abovePct: 5, confirmInterval: '1h' },
      immediateEntry: true,
      fastRsiThreshold: 60,
      pollMs: 60_000,
      fastPollMs: 30_000,
    },
  },
  rsi1m30_1m80: {
    label: 'RSI(1m)<30 → RSI(1m)>80 (sem MA)',
    body: {
      entryRsi: { interval: '1m', value: 30 },
      exitRsi:  { interval: '1m', value: 80 },
      maConditions: [],
      rule3candles: false,
      rule4candles: false,
      stopLoss: { period: 50, interval: '1h' },
      immediateEntry: true,
      fastRsiThreshold: 70,
      pollMs: 60_000,
      fastPollMs: 30_000,
    },
  },
};

function presetIds() {
  return Object.keys(PRESETS);
}

function getPresetBody(presetId) {
  const p = PRESETS[presetId];
  return p ? { ...p.body } : null;
}

function configFromPreset(presetId, overrides = {}) {
  const body = getPresetBody(presetId);
  if (!body) return null;
  const config = buildTradeConfig({ ...body, ...overrides });
  if (PRESETS[presetId]?.label) config.label = PRESETS[presetId].label;
  return config;
}

function configFromRow(row) {
  if (row.trade_config) {
    const raw = typeof row.trade_config === 'string' ? JSON.parse(row.trade_config) : row.trade_config;
    return raw;
  }
  const sid = row.strategy_id ?? 'flex';
  return configFromPreset(sid) ?? (sid === 'flex' ? configFromPreset('flex') : null);
}

/** Resolve linha Supabase → objeto usado pelo bot */
function resolveStrategy(row) {
  const config = configFromRow(row);
  if (!config) return null;

  return {
    config,
    label: config.label ?? 'AMAP',
    strategy_id: row.strategy_id ?? 'flex',
    pollMs:              config.pollMs              ?? 60_000,
    fastPollMs:          config.fastPollMs          ?? 30_000,
    fastRsiThreshold:    config.fastRsiThreshold    ?? 65,
    entryDiscount:       config.entryDiscount       ?? 0.001,
    immediateEntry:      config.immediateEntry      ?? false,
    pendingTimeoutMs:    config.pendingTimeoutMs    ?? 30 * 60_000,
    pendingCancelPct:    config.pendingCancelPct    ?? 0.002,
  };
}

function hasAdaptiveFilters(config) {
  return (config?.maFilters ?? []).some(f => f.mode === 'adaptive');
}

function listPresetsForCli() {
  return presetIds().map(id => ({
    id,
    label: PRESETS[id].label,
  }));
}

module.exports = {
  PRESETS,
  DEFAULT_FLEX_BODY,
  presetIds,
  getPresetBody,
  configFromPreset,
  configFromRow,
  resolveStrategy,
  hasAdaptiveFilters,
  listPresetsForCli,
};
