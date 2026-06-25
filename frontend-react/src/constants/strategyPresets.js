/** Presets AMAP — uma entrada por timeframe (amap-15m, amap-1h). */
import { formStateFromEntry } from './tradeConfigSchema';

export const STRATEGY_IDS = ['amap-15m', 'amap-1h'];

export const STRATEGY_LABELS = {
  'amap-15m': '15m Swing',
  'amap-1h':  '1h Swing',
};

export const STRATEGY_COLORS = {
  'amap-15m': '#26a69a',
  'amap-1h':  '#6366f1',
};

/** Payload legado → formState (via formStateFromEntry). */
const PRESET_PAYLOADS = {
  'amap-15m': {
    label: 'AMAP 15m RSI<30',
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
        fixedAboveMaEnabled: false, adaptiveAboveMaEnabled: false,
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
      entryMa: {
        period: 50, trigger: 'cross_up', interval: '1h',
        tolerancePct: 0.5, aboveMaCandles: 10, aboveMaEnabled: true,
      },
      exitRsiConditions: [
        { enabled: true, value: 70, period: 14, interval: '15m', operator: '>' },
        { enabled: true, value: 80, period: 14, interval: '15m', operator: '>' },
      ],
      exitRsiLogic: 'any',
      stopLoss: { adaptiveEnabled: false, adaptiveAboveMaEnabled: false },
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
        fixedAboveMaEnabled: false, adaptiveAboveMaEnabled: false,
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
      entryMa: {
        period: 50, trigger: 'cross_up', interval: '4h',
        tolerancePct: 0.8, aboveMaCandles: 8, aboveMaEnabled: true,
      },
      exitRsiConditions: [
        { enabled: true, value: 70, period: 14, interval: '1h', operator: '>' },
        { enabled: true, value: 75, period: 14, interval: '4h', operator: '>' },
      ],
      exitRsiLogic: 'any',
      stopLoss: { adaptiveEnabled: true, adaptiveAboveMaEnabled: false },
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

export function presetFormState(strategyId) {
  return formStateFromEntry(PRESET_PAYLOADS[strategyId] ?? PRESET_PAYLOADS['amap-15m']);
}

export function normalizeStrategyId(id) {
  if (!id || id === 'flex') return 'amap-15m';
  return STRATEGY_IDS.includes(id) ? id : 'amap-15m';
}

/** Monta estado dual a partir de entradas existentes (0–2 rows por símbolo). */
export function buildDualStrategyState(currentEntries, { symbol, exchange, defaultCapital = 40 } = {}) {
  const byId = {};
  for (const e of currentEntries ?? []) {
    const sid = normalizeStrategyId(e.strategyId ?? e.strategy_id);
    byId[sid] = e;
  }

  const strategies = {};
  for (const sid of STRATEGY_IDS) {
    const existing = byId[sid];
    strategies[sid] = {
      enabled: existing ? (existing.enabled !== false) : sid === 'amap-15m',
      id: existing?.id ?? null,
      capital: existing?.capital ?? defaultCapital,
      form: existing?.tradeConfig ? formStateFromEntry(existing) : presetFormState(sid),
    };
  }

  return {
    symbol: symbol ?? currentEntries?.[0]?.symbol ?? '',
    exchange: exchange ?? currentEntries?.[0]?.exchange ?? 'binance',
    strategies,
  };
}

export function getEntriesForSymbol(favorites, symbol) {
  const sym = symbol?.toUpperCase();
  return (favorites ?? []).filter(e => e.symbol === sym);
}

export function symbolHasMultitrade(favorites, symbol) {
  return getEntriesForSymbol(favorites, symbol).some(e => e.enabled !== false);
}
