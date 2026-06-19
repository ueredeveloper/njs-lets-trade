'use strict';

/**
 * AMAP — Adaptive MA Pullback engine
 * Motor unificado: lê parâmetros normalizados (tradeConfigSchema) e avalia entrada/saída.
 */

const ti = require('technicalindicators');
const { analyzeAdaptiveDip, lastMa, DEFAULT_OPTS } = require('./adaptiveMaDip');
const { normalizeTradeConfig, toEngineConfig, TRADE_CONFIG_DEFAULTS } = require('./tradeConfigSchema');

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

const BOT_DEFAULTS = {
  entryDiscount:    TRADE_CONFIG_DEFAULTS.execution.entryDiscount,
  immediateEntry:   TRADE_CONFIG_DEFAULTS.execution.immediateEntry,
  pendingTimeoutMs: TRADE_CONFIG_DEFAULTS.execution.pendingTimeoutMs,
  pendingCancelPct: TRADE_CONFIG_DEFAULTS.execution.pendingCancelPct,
  pollMs:           TRADE_CONFIG_DEFAULTS.polling.pollMs,
  fastPollMs:       TRADE_CONFIG_DEFAULTS.polling.fastPollMs,
  fastRsiThreshold: TRADE_CONFIG_DEFAULTS.polling.fastRsiThreshold,
  minVolumeUsdt:    TRADE_CONFIG_DEFAULTS.volume.minVolumeUsdt,
};

function maKey(period, interval) {
  return `${period}_${interval}`;
}

/** Converte payload do frontend → trade_config persistido (formato motor) */
function buildTradeConfig(body = {}) {
  return toEngineConfig(normalizeTradeConfig(body));
}

/** Intervalos de candles necessários para avaliar a config */
function getRequiredSpecs(config) {
  const specs = new Map();
  const add = (interval, limit) => {
    const prev = specs.get(interval) ?? 0;
    specs.set(interval, Math.max(prev, limit));
  };

  add(config.entryRsi.interval, config.entryRsi.period + 50);
  add(config.exitRsi.interval,  config.exitRsi.period  + 50);

  for (const f of config.maFilters ?? []) {
    add(f.interval, f.period + 60);
  }
  if (config.extension?.enabled) {
    const { threeInterval, fourInterval } = getExtensionIntervals(config.extension);
    add(threeInterval, 60);
    add(fourInterval, 60);
    add(config.extension.maInterval, config.extension.maPeriod + 10);
  }
  if (config.stopLoss?.enabled !== false) {
    add(config.stopLoss.interval, config.stopLoss.period + 10);
  }

  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

/** Calcula dips adaptativos para cada filtro MA com mode adaptive */
function computeAdaptiveDips(cMap, config) {
  const dips = {};
  for (const f of config.maFilters ?? []) {
    if (f.mode !== 'adaptive') continue;
    if (f.fixedDipPct != null) {
      dips[maKey(f.period, f.interval)] = f.fixedDipPct;
      continue;
    }
    const candles = cMap[f.interval];
    const key     = maKey(f.period, f.interval);
    dips[key]     = analyzeAdaptiveDip(candles, f.period, config.adaptiveOpts).dipPct;
  }
  return dips;
}

/** Monta snapshot de MAs a partir do candle map */
function buildMaSnapshot(cMap, config) {
  const snap = {};
  const intervals = new Set([
    ...(config.maFilters ?? []).map(f => f.interval),
    config.extension?.enabled && config.extension?.maInterval,
    config.stopLoss?.enabled !== false && config.stopLoss?.interval,
  ].filter(Boolean));

  for (const iv of intervals) {
    const candles = cMap[iv];
    if (!candles?.length) continue;
    for (const f of config.maFilters ?? []) {
      if (f.interval !== iv) continue;
      snap[maKey(f.period, iv)] = { ma: lastMa(candles, f.period), candles, period: f.period, interval: iv };
    }
    if (config.extension?.enabled && config.extension.maInterval === iv) {
      const p = config.extension.maPeriod ?? 50;
      const k = maKey(p, iv);
      if (!snap[k]) snap[k] = { ma: lastMa(candles, p), candles, period: p, interval: iv };
    }
    if (config.stopLoss?.enabled !== false && config.stopLoss?.interval === iv) {
      const p = config.stopLoss.period;
      snap[`sl_${maKey(p, iv)}`] = { ma: lastMa(candles, p), period: p, interval: iv };
    }
  }
  return snap;
}

function checkRsi(value, rule) {
  if (value == null) return false;
  if (rule.operator === '<=') return value <= rule.value;
  if (rule.operator === '>=') return value >= rule.value;
  return rule.operator === '<' ? value < rule.value : value > rule.value;
}

/** @deprecated confirmInterval — use threeInterval / fourInterval */
function getExtensionIntervals(extension) {
  const fallback = extension?.threeInterval ?? extension?.fourInterval
    ?? extension?.confirmInterval ?? '1h';
  return {
    threeInterval: extension?.threeInterval ?? fallback,
    fourInterval:  extension?.fourInterval ?? fallback,
  };
}

function completedCandles(candles, interval, entryTimeMs) {
  const intervalMs = INTERVAL_MS[interval] ?? 3_600_000;
  return (candles ?? []).filter(c => c.openTime + intervalMs <= entryTimeMs);
}

function resolveConfirmCandles(confirmCandles) {
  if (Array.isArray(confirmCandles)) {
    return { three: confirmCandles, four: confirmCandles };
  }
  return {
    three: confirmCandles?.three ?? confirmCandles?.four ?? [],
    four:  confirmCandles?.four ?? confirmCandles?.three ?? [],
  };
}

function analyzeExtension(close, maValue, confirmCandles, extension, entryTimeMs) {
  const thresholdPct = extension?.abovePct ?? 5;
  const aboveMaPct   = maValue != null ? ((close / maValue - 1) * 100) : null;

  if (!extension?.enabled || maValue == null) {
    return {
      extended: false, allowed: true, reason: null,
      threeOk: false, fourOk: false, aboveMaPct, thresholdPct,
    };
  }

  const threshold = maValue * (1 + thresholdPct / 100);
  if (close <= threshold) {
    return {
      extended: false, allowed: true, reason: null,
      threeOk: false, fourOk: false, aboveMaPct, thresholdPct,
    };
  }

  if (!extension.threeCandles && !extension.fourCandles) {
    return {
      extended: true, allowed: true, reason: null,
      threeOk: false, fourOk: false, aboveMaPct, thresholdPct,
    };
  }

  const { threeInterval, fourInterval } = getExtensionIntervals(extension);
  const { three, four } = resolveConfirmCandles(confirmCandles);
  const last3 = completedCandles(three, threeInterval, entryTimeMs).slice(-3);
  const last4 = completedCandles(four, fourInterval, entryTimeMs).slice(-4);

  const threeOk = !!(extension.threeCandles &&
    last3.length >= 3 && last3.every(c => c.close > c.open));

  const fourOk = !!(extension.fourCandles &&
    last4.length >= 4 &&
    last4[0].close > last4[0].open &&
    last4[1].close > last4[1].open &&
    last4[2].close > last4[2].open &&
    last4[3].close < last4[3].open);

  const logic     = extension.confirmLogic ?? 'any';
  const confirmed = logic === 'all' ? (threeOk && fourOk) : (threeOk || fourOk);

  return {
    extended: true,
    allowed:  confirmed,
    reason:   confirmed ? null : 'THREE_CANDLES_BLOCKED',
    threeOk,
    fourOk,
    aboveMaPct,
    thresholdPct,
    threeInterval,
    fourInterval,
  };
}

function checkExtension(close, maValue, confirmCandles, extension, entryTimeMs) {
  const r = analyzeExtension(close, maValue, confirmCandles, extension, entryTimeMs);
  if (!r.allowed && r.extended) return { allowed: false, reason: r.reason ?? 'THREE_CANDLES_BLOCKED' };
  return { allowed: true, reason: null };
}

function checkMaFilters({ close, maFilters, maSnap, adaptiveDips }) {
  for (const f of maFilters ?? []) {
    const key = maKey(f.period, f.interval);
    const md  = maSnap[key];
    if (!md || md.ma == null) return { allowed: false, reason: 'MA_NO_DATA', filter: key };

    if (f.mode === 'strict_above') {
      if (close <= md.ma) return { allowed: false, reason: 'MA_BLOCKED', filter: key };
    } else if (f.mode === 'adaptive') {
      const dipPct = adaptiveDips[key] ?? DEFAULT_OPTS.defaultPct;
      const floor  = md.ma * (1 - dipPct / 100);
      if (close < floor) return { allowed: false, reason: 'MA_ADAPTIVE_BLOCKED', filter: key, dipPct, floor };
    }
  }
  return { allowed: true, reason: null };
}

function evaluateEntry({ entryRsi, close, entryTimeMs, config, maSnap, adaptiveDips, cMap }) {
  if (!checkRsi(entryRsi, config.entryRsi)) {
    return { allowed: false, reason: 'RSI_NOT_MET' };
  }

  const maCheck = checkMaFilters({
    close, maFilters: config.maFilters, maSnap, adaptiveDips,
  });
  if (!maCheck.allowed) return maCheck;

  if (config.extension?.enabled) {
    const extIv  = config.extension.maInterval;
    const extP   = config.extension.maPeriod ?? 50;
    const extKey = maKey(extP, extIv);
    const md     = maSnap[extKey];
    const extMa  = md?.ma;
    const { threeInterval, fourInterval } = getExtensionIntervals(config.extension);
    const confirmCandles = cMap ? {
      three: cMap[threeInterval],
      four:  cMap[fourInterval],
    } : { three: md?.candles, four: md?.candles };
    const extCheck = checkExtension(close, extMa, confirmCandles, config.extension, entryTimeMs);
    if (!extCheck.allowed) return extCheck;
  }

  return { allowed: true, reason: null };
}

function evaluateExit({ close, exitRsi, stopLossMa, config }) {
  if (config.stopLoss?.enabled !== false && stopLossMa != null && close < stopLossMa) {
    return { exit: true, reason: 'stop_loss_ma' };
  }
  if (checkRsi(exitRsi, config.exitRsi)) {
    return { exit: true, reason: 'rsi' };
  }
  return { exit: false };
}

function checkMinVolume(volumeUsdt, config) {
  if (config?.allowLowVolume) return { allowed: true, reason: null, lowVolumeMode: true };
  const min = config?.minVolumeUsdt ?? BOT_DEFAULTS.minVolumeUsdt;
  if (volumeUsdt == null) return { allowed: true, reason: null };
  if (volumeUsdt >= min) return { allowed: true, reason: null };
  return { allowed: false, reason: 'VOLUME_LOW', volumeUsdt, minVolumeUsdt: min, lowVolumeMode: true };
}

function needsMarketSell(config, volumeUsdt) {
  if (config?.allowLowVolume) return true;
  if (config?.aggressiveExitOnLowVolume === false) return false;
  if (volumeUsdt == null) return false;
  const min = config?.minVolumeUsdt ?? BOT_DEFAULTS.minVolumeUsdt;
  return volumeUsdt < min;
}

function getStopLossMa(maSnap, config) {
  if (config.stopLoss?.enabled === false) return null;
  const sl = config.stopLoss;
  const key = `sl_${maKey(sl.period, sl.interval)}`;
  return maSnap[key]?.ma ?? maSnap[maKey(sl.period, sl.interval)]?.ma ?? null;
}

function buildAdaptiveReport(cMap, config) {
  const lines = [];
  for (const f of config.maFilters ?? []) {
    if (f.mode !== 'adaptive') continue;
    const candles  = cMap[f.interval];
    const analysis = analyzeAdaptiveDip(candles, f.period, config.adaptiveOpts);
    lines.push({
      interval: f.interval,
      period:   f.period,
      ...analysis,
      currentMa: lastMa(candles, f.period),
    });
  }
  return lines;
}

module.exports = {
  buildTradeConfig,
  getRequiredSpecs,
  computeAdaptiveDips,
  buildMaSnapshot,
  evaluateEntry,
  evaluateExit,
  getStopLossMa,
  checkRsi,
  checkExtension,
  analyzeExtension,
  getExtensionIntervals,
  checkMinVolume,
  needsMarketSell,
  buildAdaptiveReport,
  maKey,
  BOT_DEFAULTS,
  INTERVAL_MS,
};
