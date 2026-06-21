'use strict';

/**
 * Schema único de parâmetros AMAP — fonte de verdade para defaults e normalização.
 * Toda nuance da estratégia é um parâmetro explícito configurável pelo usuário.
 */

const RSI_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const MA_INTERVALS  = ['15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const MA_PERIODS    = [20, 50, 100, 200];
const RSI_PERIODS   = [7, 14, 21];

/** Valores padrão quando o usuário não informa nada */
const TRADE_CONFIG_DEFAULTS = {
  entryRsi:  { interval: '15m', period: 14, operator: '<', value: 30 },
  exitRsi:   { interval: '15m', period: 14, operator: '>', value: 70 },

  /** Entrada por RSI (caminho 1) — pode desligar se usar só MA */
  entryRsiPath: { enabled: true },

  /** Entrada por toque/cruzamento de MA (caminho 2) — OR com RSI */
  entryMa: {
    enabled:       false,
    period:        50,
    interval:      '1h',
    /** touch = preço testa a MA; cross_up = close cruza MA de baixo para cima */
    trigger:       'touch',
    tolerancePct:  0.5,
    /** Se true, exige também RSI neste caminho (usa entryMa.entryRsi) */
    requireRsi:    false,
    entryRsi:      { interval: '15m', period: 14, operator: '<', value: 40 },
  },

  maConditions: [
    { period: 50, interval: '4h', mode: 'strict_above' },
    { period: 50, interval: '1h', mode: 'adaptive' },
  ],

  extension: {
    enabled:         true,
    maPeriod:        50,
    maInterval:      '1h',
    abovePct:        5,
    /** Intervalo dos candles da regra 3 (3 altas seguidas) */
    threeInterval:   '1h',
    /** Intervalo dos candles da regra 4 (3 altas + 1 queda) */
    fourInterval:    '1h',
    threeCandles:    true,
    fourCandles:     true,
    /** 'any' = basta 3 OU 4 candles; 'all' = exige ambas quando ativas */
    confirmLogic:    'any',
  },

  stopLoss: {
    enabled:  true,
    /** Stop quando close < MA(period, interval) */
    fixedEnabled: true,
    period:   50,
    interval: '4h',
    /** Pisos adaptativos (MA × (1−dip%)) dos filtros MA em modo adaptive */
    adaptiveEnabled: true,
  },

  execution: {
    immediateEntry:   false,
    entryDiscount:    0.001,
    pendingTimeoutMs: 30 * 60_000,
    pendingCancelPct: 0.002,
    /** Cancela PENDING se RSI de saída for atingido antes do alvo de compra */
    pendingCancelOnExitRsi: true,
  },

  polling: {
    pollMs:           60_000,
    fastPollMs:       30_000,
    fastRsiThreshold: 65,
  },

  adaptiveOpts: {
    defaultPct:  3.0,
    maxPct:      8.0,
    minPct:      0.5,
    minEpisodes: 3,
  },

  volume: {
    minVolumeUsdt:            1_000_000,
    allowLowVolume:           false,
    aggressiveExitOnLowVolume: true,
  },
};

function normalizeRsi(rsi, fallback) {
  const fb = fallback ?? TRADE_CONFIG_DEFAULTS.entryRsi;
  return {
    interval: rsi?.interval ?? fb.interval,
    period:   Number(rsi?.period ?? fb.period),
    operator: rsi?.operator ?? fb.operator,
    value:    Number(rsi?.value ?? fb.value),
  };
}

function normalizeMaCondition(m) {
  let mode = m.mode;
  if (mode == null) {
    if (m.adaptive === true) mode = 'adaptive';
    else if (m.adaptive === false) mode = 'strict_above';
    else mode = 'strict_above';
  }
  if (mode === 'fixed') mode = 'strict_above';
  return {
    period:       Number(m.period ?? 50),
    interval:     m.interval ?? '1h',
    mode,
    fixedDipPct:  m.fixedDipPct != null ? Number(m.fixedDipPct) : null,
  };
}

function clampEntryDiscount(v) {
  if (!Number.isFinite(v) || v < 0) return TRADE_CONFIG_DEFAULTS.execution.entryDiscount;
  return Math.min(0.1, Math.max(0.0001, v));
}

/** Aceita payload do formulário → trade_config completo */
function normalizeTradeConfig(body = {}) {
  const d = TRADE_CONFIG_DEFAULTS;

  const entryRsi = normalizeRsi(body.entryRsi, d.entryRsi);
  const exitRsi  = normalizeRsi(body.exitRsi,  d.exitRsi);

  const erpBody = body.entryRsiPath ?? {};
  const entryRsiPath = {
    enabled: erpBody.enabled ?? d.entryRsiPath.enabled,
  };

  const emBody = body.entryMa ?? {};
  const entryMa = {
    enabled:      emBody.enabled ?? d.entryMa.enabled,
    period:       Number(emBody.period ?? d.entryMa.period),
    interval:     emBody.interval ?? d.entryMa.interval,
    trigger:      emBody.trigger ?? d.entryMa.trigger,
    tolerancePct: Number(emBody.tolerancePct ?? d.entryMa.tolerancePct),
    requireRsi:   emBody.requireRsi ?? d.entryMa.requireRsi,
    entryRsi:     normalizeRsi(emBody.entryRsi, d.entryMa.entryRsi),
  };

  const rawMa = body.maConditions ?? body.maFilters ?? d.maConditions;
  const maConditions = (rawMa ?? []).map(normalizeMaCondition).filter(m => m.mode !== 'off' && m.mode !== 'disabled');

  const extBody = body.extension ?? {};
  const extFallback = extBody.confirmInterval ?? d.extension.threeInterval ?? '1h';
  const extension = {
    enabled:         extBody.enabled ?? d.extension.enabled,
    maPeriod:        Number(extBody.maPeriod ?? d.extension.maPeriod),
    maInterval:      extBody.maInterval ?? d.extension.maInterval,
    abovePct:        Number(extBody.abovePct ?? d.extension.abovePct),
    threeInterval:   extBody.threeInterval ?? extFallback,
    fourInterval:    extBody.fourInterval ?? extBody.threeInterval ?? extFallback,
    threeCandles:    extBody.threeCandles ?? d.extension.threeCandles,
    fourCandles:     extBody.fourCandles ?? d.extension.fourCandles,
    confirmLogic:    extBody.confirmLogic ?? d.extension.confirmLogic,
  };

  const slBody = body.stopLoss ?? {};
  const legacyOff = slBody.enabled === false
    && slBody.fixedEnabled == null
    && slBody.adaptiveEnabled == null;
  const fixedEnabled = legacyOff
    ? false
    : (slBody.fixedEnabled ?? slBody.enabled ?? d.stopLoss.fixedEnabled ?? true);
  const adaptiveEnabled = legacyOff
    ? false
    : (slBody.adaptiveEnabled ?? d.stopLoss.adaptiveEnabled ?? true);
  const stopLoss = {
    enabled: fixedEnabled || adaptiveEnabled,
    fixedEnabled,
    adaptiveEnabled,
    period:   Number(slBody.period ?? d.stopLoss.period),
    interval: slBody.interval ?? d.stopLoss.interval,
  };

  const execBody = body.execution ?? {};
  const execution = {
    immediateEntry:   execBody.immediateEntry ?? d.execution.immediateEntry,
    entryDiscount:    clampEntryDiscount(Number(execBody.entryDiscount ?? d.execution.entryDiscount)),
    pendingTimeoutMs: Number(execBody.pendingTimeoutMs ?? d.execution.pendingTimeoutMs),
    pendingCancelPct: Number(execBody.pendingCancelPct ?? d.execution.pendingCancelPct),
    pendingCancelOnExitRsi: execBody.pendingCancelOnExitRsi ?? d.execution.pendingCancelOnExitRsi,
  };

  const pollBody = body.polling ?? {};
  const polling = {
    pollMs:           Number(pollBody.pollMs ?? d.polling.pollMs),
    fastPollMs:       Number(pollBody.fastPollMs ?? d.polling.fastPollMs),
    fastRsiThreshold: Number(pollBody.fastRsiThreshold ?? d.polling.fastRsiThreshold),
  };

  const adaptiveOpts = { ...d.adaptiveOpts, ...(body.adaptiveOpts ?? {}) };

  const volBody = body.volume ?? {};
  const volume = {
    minVolumeUsdt: Number(volBody.minVolumeUsdt ?? d.volume.minVolumeUsdt),
    allowLowVolume: !!(volBody.allowLowVolume ?? d.volume.allowLowVolume),
    aggressiveExitOnLowVolume: volBody.aggressiveExitOnLowVolume ?? d.volume.aggressiveExitOnLowVolume,
  };

  const label = body.label ?? `AMAP ${entryRsi.interval} RSI${entryRsi.operator}${entryRsi.value}`;

  return { label, entryRsi, exitRsi, entryRsiPath, entryMa, maConditions, extension, stopLoss, execution, polling, adaptiveOpts, volume };
}

/** trade_config normalizado → formato interno do motor (maFilters, campos flat legados) */
function toEngineConfig(normalized) {
  const n = normalized ?? normalizeTradeConfig();
  return {
    label: n.label,
    entryRsi:  n.entryRsi,
    exitRsi:   n.exitRsi,
    entryRsiPath: n.entryRsiPath,
    entryMa:   n.entryMa,
    maFilters: n.maConditions.map(m => ({
      period:      m.period,
      interval:    m.interval,
      mode:        m.mode,
      fixedDipPct: m.fixedDipPct,
    })),
    extension: {
      enabled:       n.extension.enabled,
      maPeriod:      n.extension.maPeriod,
      maInterval:    n.extension.maInterval,
      abovePct:      n.extension.abovePct,
      threeInterval: n.extension.threeInterval,
      fourInterval:  n.extension.fourInterval,
      threeCandles:  n.extension.threeCandles,
      fourCandles:   n.extension.fourCandles,
      confirmLogic:  n.extension.confirmLogic,
    },
    stopLoss: {
      enabled:         n.stopLoss.enabled,
      fixedEnabled:    n.stopLoss.fixedEnabled,
      adaptiveEnabled: n.stopLoss.adaptiveEnabled,
      period:          n.stopLoss.period,
      interval:        n.stopLoss.interval,
    },
    adaptiveOpts: n.adaptiveOpts,
    minVolumeUsdt:  n.volume.minVolumeUsdt,
    allowLowVolume: n.volume.allowLowVolume,
    aggressiveExitOnLowVolume: n.volume.aggressiveExitOnLowVolume,
    immediateEntry:   n.execution.immediateEntry,
    entryDiscount:    n.execution.entryDiscount,
    pendingTimeoutMs: n.execution.pendingTimeoutMs,
    pendingCancelPct: n.execution.pendingCancelPct,
    pendingCancelOnExitRsi: n.execution.pendingCancelOnExitRsi,
    pollMs:           n.polling.pollMs,
    fastPollMs:       n.polling.fastPollMs,
    fastRsiThreshold: n.polling.fastRsiThreshold,
  };
}

/** trade_config persistido → estado do formulário */
function toFormState(config) {
  const n = config?.maConditions
    ? normalizeTradeConfig(config)
    : normalizeTradeConfig(flatConfigToBody(config));

  return {
    entryRsi:     n.entryRsi,
    exitRsi:      n.exitRsi,
    entryRsiPath: n.entryRsiPath,
    entryMa:      n.entryMa,
    maConditions: n.maConditions.map((m, i) => ({ ...m, id: i + 1 })),
    extension:    n.extension,
    stopLoss:     n.stopLoss,
    execution:    n.execution,
    polling:      n.polling,
    adaptiveOpts: n.adaptiveOpts,
    volume:       n.volume,
  };
}

/** Config do motor (trade_config JSONB) → body do formulário */
function flatConfigToBody(tc) {
  if (!tc) return {};
  return {
    label:        tc.label,
    entryRsi:     tc.entryRsi,
    exitRsi:      tc.exitRsi,
    entryRsiPath: tc.entryRsiPath,
    entryMa:      tc.entryMa,
    maConditions: (tc.maFilters ?? []).map(f => ({
      period: f.period, interval: f.interval, mode: f.mode, fixedDipPct: f.fixedDipPct,
    })),
    extension:    tc.extension,
    stopLoss:     tc.stopLoss,
    execution: {
      immediateEntry:   tc.immediateEntry,
      entryDiscount:    tc.entryDiscount,
      pendingTimeoutMs: tc.pendingTimeoutMs,
      pendingCancelPct: tc.pendingCancelPct,
      pendingCancelOnExitRsi: tc.pendingCancelOnExitRsi,
    },
    polling: {
      pollMs:           tc.pollMs,
      fastPollMs:       tc.fastPollMs,
      fastRsiThreshold: tc.fastRsiThreshold,
    },
    adaptiveOpts: tc.adaptiveOpts,
    volume: {
      minVolumeUsdt:             tc.minVolumeUsdt,
      allowLowVolume:            tc.allowLowVolume,
      aggressiveExitOnLowVolume: tc.aggressiveExitOnLowVolume,
    },
  };
}

function configFromRow(row) {
  if (!row) return null;
  if (row.trade_config) {
    const raw = typeof row.trade_config === 'string' ? JSON.parse(row.trade_config) : row.trade_config;
    return toEngineConfig(flatConfigToBody(raw));
  }
  if (row.entry_rsi) {
    return toEngineConfig(normalizeTradeConfig({
      entryRsi:     row.entry_rsi,
      exitRsi:      row.exit_rsi,
      maConditions: row.ma_conditions,
      extension:    { threeCandles: row.rule_3_candles, fourCandles: row.rule_4_candles },
    }));
  }
  return null;
}

function resolveStrategy(row) {
  const config = configFromRow(row);
  if (!config) return null;
  const d = TRADE_CONFIG_DEFAULTS;
  return {
    config,
    label: config.label ?? 'AMAP',
    pollMs:              config.pollMs              ?? d.polling.pollMs,
    fastPollMs:          config.fastPollMs          ?? d.polling.fastPollMs,
    fastRsiThreshold:    config.fastRsiThreshold    ?? d.polling.fastRsiThreshold,
    entryDiscount:       config.entryDiscount       ?? d.execution.entryDiscount,
    immediateEntry:      config.immediateEntry      ?? d.execution.immediateEntry,
    pendingTimeoutMs:    config.pendingTimeoutMs    ?? d.execution.pendingTimeoutMs,
    pendingCancelPct:    config.pendingCancelPct    ?? d.execution.pendingCancelPct,
    pendingCancelOnExitRsi: config.pendingCancelOnExitRsi ?? d.execution.pendingCancelOnExitRsi,
  };
}

function hasAdaptiveFilters(config) {
  return (config?.maFilters ?? []).some(f => f.mode === 'adaptive');
}

module.exports = {
  TRADE_CONFIG_DEFAULTS,
  RSI_INTERVALS,
  MA_INTERVALS,
  MA_PERIODS,
  RSI_PERIODS,
  normalizeTradeConfig,
  toEngineConfig,
  toFormState,
  flatConfigToBody,
  configFromRow,
  resolveStrategy,
  hasAdaptiveFilters,
};
