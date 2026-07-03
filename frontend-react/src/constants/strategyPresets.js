/** Presets AMAP + Swing — múltiplas estratégias por símbolo. */
import { formStateFromEntry } from './tradeConfigSchema';
import { swingFormFromEntry, normalizeSwingForm } from './swingConfigSchema';
import { maCrossFormFromEntry, normalizeMaCrossForm } from './maCrossConfigSchema';

export const MA_CROSS_STRATEGY_IDS = ['ma-cross'];
/** Frontend MA-Cross only — backend ainda aceita outras estratégias. */
export const STRATEGY_IDS = [...MA_CROSS_STRATEGY_IDS];

export const STRATEGY_LABELS = {
  'amap-15m':      'AMAP 15m',
  'amap-1h':       'AMAP 1h',
  'swing-rsi-1h':  'RSI 1h',
  'swing-ma50-8h': 'MA50 8h',
  'ma-cross':      'MA Cross',
};

export const STRATEGY_COLORS = {
  'amap-15m':      '#26a69a',
  'amap-1h':       '#6366f1',
  'swing-rsi-1h':  '#f59e0b',
  'swing-ma50-8h': '#ec4899',
  'ma-cross':      '#22d3ee',
};

const SWING_STRATEGY_IDS = ['swing-rsi-1h', 'swing-ma50-8h'];

export function isSwingStrategy(id) {
  return SWING_STRATEGY_IDS.includes(id);
}

export function isMaCrossStrategy(id) {
  return MA_CROSS_STRATEGY_IDS.includes(id);
}

const AMAP_PRESETS = {
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

const SWING_PRESETS = {
  'swing-rsi-1h': {
    label: 'Swing RSI 1h',
    kind: 'rsi',
    entryRsi:  { value: 30, period: 14, interval: '1h', operator: '<' },
    exitRsi:   { value: 75, period: 14, interval: '1h', operator: '>' },
    entryMaFilter: { enabled: true, period: 50, interval: '8h', mode: 'strict_above' },
  },
  'swing-ma50-8h': {
    label: 'Swing MA50 8h',
    kind: 'ma',
    entryMa: {
      period: 50, interval: '8h', trigger: 'cross_up',
      tolerancePct: 0.5, aboveMaCandles: 3, aboveMaEnabled: true,
    },
    exitRsi: { value: 80, period: 14, interval: '4h', operator: '>' },
    entryMaFilter: { enabled: false },
  },
};

const MA_CROSS_PRESETS = {
  'ma-cross': {
    label: 'MA Cross',
    kind: 'ma_cross',
    entry: {
      enabled: true,
      ma1: { period: 9, interval: '15m' },
      ma2: { period: 21, interval: '15m' },
      direction: 'cross_up',
      tolerancePct: 0.1,
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
      rsi: { enabled: false, logic: 'any', conditions: [{ enabled: true, interval: '15m', period: 14, operator: '>', value: 70 }] },
    },
    stopLoss: { enabled: true, maxLossPct: 5 },
    execution: { immediateEntry: true, entryDiscount: 0.001, pendingTimeoutMs: 30 * 60_000 },
    polling: { pollMs: 60_000, fastPollMs: 30_000 },
    adaptiveOpts: { defaultPct: 3, maxPct: 8, minPct: 0.5, minEpisodes: 3 },
    volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false },
  },
};

export function presetFormState(strategyId) {
  if (isMaCrossStrategy(strategyId)) {
    return normalizeMaCrossForm(MA_CROSS_PRESETS[strategyId] ?? MA_CROSS_PRESETS['ma-cross']);
  }
  if (isSwingStrategy(strategyId)) {
    return normalizeSwingForm(SWING_PRESETS[strategyId] ?? SWING_PRESETS['swing-rsi-1h']);
  }
  return formStateFromEntry(AMAP_PRESETS[strategyId] ?? AMAP_PRESETS['amap-15m']);
}

export function normalizeStrategyId(id) {
  if (!id || id === 'flex') return 'ma-cross';
  if (STRATEGY_IDS.includes(id)) return id;
  if (id === 'ma-cross' || id === 'ma_cross') return 'ma-cross';
  return 'ma-cross';
}

/** strategy_id do painel; kind só quando strategy_id ausente ou inválido. */
export function resolveEntryStrategyId(entry) {
  const sid = entry?.strategyId ?? entry?.strategy_id;
  if (sid && STRATEGY_IDS.includes(sid)) return sid;
  const kind = entry?.tradeConfig?.kind;
  if (kind === 'ma_cross') return 'ma-cross';
  if (kind === 'rsi') return 'swing-rsi-1h';
  if (kind === 'ma') return 'swing-ma50-8h';
  return normalizeStrategyId(sid);
}

export function formForEntry(existing, strategyId) {
  if (isMaCrossStrategy(strategyId)) {
    if (existing?.tradeConfig?.kind === 'ma_cross') return maCrossFormFromEntry(existing);
    return presetFormState(strategyId);
  }
  if (isSwingStrategy(strategyId)) {
    if (existing?.tradeConfig?.kind === 'rsi' || existing?.tradeConfig?.kind === 'ma') {
      return swingFormFromEntry(existing);
    }
    return presetFormState(strategyId);
  }
  if (existing?.tradeConfig?.kind === 'ma_cross') return maCrossFormFromEntry(existing);
  if (existing?.tradeConfig?.kind) return swingFormFromEntry(existing);
  return existing?.tradeConfig ? formStateFromEntry(existing) : presetFormState(strategyId);
}

/** Monta estado de todas as estratégias a partir de entradas existentes. */
export function buildDualStrategyState(currentEntries, { symbol, exchange, defaultCapital = 40 } = {}) {
  const byId = {};
  for (const e of currentEntries ?? []) {
    byId[resolveEntryStrategyId(e)] = e;
  }

  const strategies = {};
  for (const sid of STRATEGY_IDS) {
    const existing = byId[sid];
    const defaultEnabled = sid === 'ma-cross';
    strategies[sid] = {
      enabled: existing ? (existing.enabled !== false) : false,
      id: existing?.id ?? null,
      capital: existing?.capital ?? defaultCapital,
      form: existing ? formForEntry(existing, sid) : presetFormState(sid),
      isSwing: isSwingStrategy(sid),
      isMaCross: isMaCrossStrategy(sid),
    };
    if (!existing && sid === 'ma-cross') strategies[sid].enabled = true;
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

export function strategyBadgeLabel(sid) {
  if (sid === 'amap-15m') return '15m';
  if (sid === 'amap-1h') return '1h';
  if (sid === 'swing-rsi-1h') return 'RSI';
  if (sid === 'swing-ma50-8h') return 'MA';
  if (sid === 'ma-cross') return 'X';
  return sid.slice(0, 4);
}
