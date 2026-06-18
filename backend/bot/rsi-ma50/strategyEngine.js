'use strict';

/**
 * AMAP — Adaptive MA Pullback engine
 * Motor unificado: entrada RSI + filtros MA (fixo/adaptativo) + extensão (3/4 candles) + saída + stop.
 */

const ti = require('technicalindicators');
const { analyzeAdaptiveDip, lastMa, DEFAULT_OPTS } = require('./adaptiveMaDip');

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

const BOT_DEFAULTS = {
  entryDiscount:    0.001,
  immediateEntry:   false,
  pendingTimeoutMs: 30 * 60_000,
  pendingCancelPct: 0.002,
  pollMs:           60_000,
  fastPollMs:       30_000,
  fastRsiThreshold: 65,
  minVolumeUsdt:    1_000_000,
};

function maKey(period, interval) {
  return `${period}_${interval}`;
}

function normalizeRsi(rsi, fallbackOp, fallbackVal, fallbackIv) {
  return {
    interval: rsi?.interval ?? fallbackIv,
    period:   rsi?.period   ?? 14,
    operator: rsi?.operator ?? fallbackOp,
    value:    Number(rsi?.value ?? fallbackVal),
  };
}

/** Converte payload do frontend → trade_config persistido */
function buildTradeConfig(body = {}) {
  const maConditions = body.maConditions ?? [];
  const hasExtension = !!(body.rule3candles || body.rule4candles || body.extension?.enabled);

  const primaryMa = maConditions.find(m => m.adaptive)?.interval
    ?? maConditions[0]?.interval
    ?? '1h';

  const timingKeys = ['entryDiscount', 'immediateEntry', 'pendingTimeoutMs', 'pendingCancelPct', 'pollMs', 'fastPollMs', 'fastRsiThreshold'];
  const timing = {};
  for (const k of timingKeys) {
    if (body[k] != null) timing[k] = body[k];
  }

  return {
    label: `AMAP ${body.entryRsi?.interval ?? '15m'} RSI<${body.entryRsi?.value ?? 30}`,
    entryRsi:  normalizeRsi(body.entryRsi,  '<', 30, '15m'),
    exitRsi:   normalizeRsi(body.exitRsi,   '>', 70, '15m'),
    maFilters: maConditions.map(m => ({
      period:   Number(m.period   ?? 50),
      interval: m.interval ?? '1h',
      mode:     m.adaptive ? 'adaptive' : 'strict_above',
    })),
    extension: {
      enabled:         hasExtension,
      maInterval:      body.extension?.maInterval      ?? primaryMa,
      abovePct:        Number(body.extension?.abovePct ?? 5),
      confirmInterval: body.extension?.confirmInterval ?? '1h',
      threeCandles:    !!body.rule3candles,
      fourCandles:     !!body.rule4candles,
    },
    stopLoss: {
      period:   Number(body.stopLoss?.period   ?? 50),
      interval: body.stopLoss?.interval ?? '1h',
    },
    adaptiveOpts: { ...DEFAULT_OPTS, ...(body.adaptiveOpts ?? {}) },
    minVolumeUsdt: Number(body.minVolumeUsdt ?? BOT_DEFAULTS.minVolumeUsdt),
    allowLowVolume:  !!body.allowLowVolume,
    ...BOT_DEFAULTS,
    ...timing,
  };
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
    add(config.extension.confirmInterval, 60);
    add(config.extension.maInterval, 60);
  }
  add(config.stopLoss.interval, config.stopLoss.period + 10);

  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

/** Calcula dips adaptativos para cada filtro MA com mode adaptive */
function computeAdaptiveDips(cMap, config) {
  const dips = {};
  for (const f of config.maFilters ?? []) {
    if (f.mode !== 'adaptive') continue;
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
    config.extension?.maInterval,
    config.stopLoss?.interval,
  ].filter(Boolean));

  for (const iv of intervals) {
    const candles = cMap[iv];
    if (!candles?.length) continue;
    for (const f of config.maFilters ?? []) {
      if (f.interval !== iv) continue;
      snap[maKey(f.period, iv)] = { ma: lastMa(candles, f.period), candles, period: f.period, interval: iv };
    }
    if (config.extension?.maInterval === iv) {
      const k = maKey(50, iv);
      if (!snap[k]) snap[k] = { ma: lastMa(candles, 50), candles, period: 50, interval: iv };
    }
    if (config.stopLoss?.interval === iv) {
      const p = config.stopLoss.period;
      snap[`sl_${maKey(p, iv)}`] = { ma: lastMa(candles, p), period: p, interval: iv };
    }
  }
  return snap;
}

function checkRsi(value, rule) {
  if (value == null) return false;
  return rule.operator === '<' ? value < rule.value : value > rule.value;
}

function checkExtension(close, maValue, maCandles, extension, entryTimeMs) {
  if (!extension?.enabled || maValue == null) return { allowed: true, reason: null };

  const thresholdPct = extension.abovePct ?? 5;
  const threshold    = maValue * (1 + thresholdPct / 100);
  if (close <= threshold) return { allowed: true, reason: null };

  if (!extension.threeCandles && !extension.fourCandles) {
    return { allowed: true, reason: null };
  }

  const intervalMs = INTERVAL_MS[extension.confirmInterval] ?? 3_600_000;
  const completed  = (maCandles ?? []).filter(c => c.openTime + intervalMs <= entryTimeMs);
  const last3      = completed.slice(-3);
  const last4      = completed.slice(-4);

  const threeOk = extension.threeCandles &&
    last3.length >= 3 && last3.every(c => c.close > c.open);

  const fourOk = extension.fourCandles &&
    last4.length >= 4 &&
    last4[0].close > last4[0].open &&
    last4[1].close > last4[1].open &&
    last4[2].close > last4[2].open &&
    last4[3].close < last4[3].open;

  if (!threeOk && !fourOk) {
    return { allowed: false, reason: 'THREE_CANDLES_BLOCKED' };
  }
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

/**
 * Avalia se entrada é permitida.
 * @returns {{ allowed, reason?, dipPct?, filter? }}
 */
function evaluateEntry({ entryRsi, close, entryTimeMs, config, maSnap, adaptiveDips }) {
  if (!checkRsi(entryRsi, config.entryRsi)) {
    return { allowed: false, reason: 'RSI_NOT_MET' };
  }

  const maCheck = checkMaFilters({
    close, maFilters: config.maFilters, maSnap, adaptiveDips,
  });
  if (!maCheck.allowed) return maCheck;

  if (config.extension?.enabled) {
    const extIv  = config.extension.maInterval;
    const extKey = maKey(50, extIv);
    const md     = maSnap[extKey] ?? maSnap[maKey(50, extIv)];
    const extMa  = md?.ma;
    const extC   = md?.candles ?? maSnap[maKey(50, config.extension.confirmInterval)]?.candles;
    const extCheck = checkExtension(close, extMa, extC, config.extension, entryTimeMs);
    if (!extCheck.allowed) return extCheck;
  }

  return { allowed: true, reason: null };
}

/**
 * Avalia saída por RSI ou stop loss MA.
 * @returns {{ exit: boolean, reason?: 'rsi'|'stop_loss_ma' }}
 */
function evaluateExit({ close, exitRsi, stopLossMa, config }) {
  if (stopLossMa != null && close < stopLossMa) {
    return { exit: true, reason: 'stop_loss_ma' };
  }
  if (checkRsi(exitRsi, config.exitRsi)) {
    return { exit: true, reason: 'rsi' };
  }
  return { exit: false };
}

/** Bloqueia entrada se volume 24h (USDT) estiver abaixo do mínimo (exceto allowLowVolume) */
function checkMinVolume(volumeUsdt, config) {
  if (config?.allowLowVolume) return { allowed: true, reason: null, lowVolumeMode: true };
  const min = config?.minVolumeUsdt ?? BOT_DEFAULTS.minVolumeUsdt;
  if (volumeUsdt == null) return { allowed: true, reason: null };
  if (volumeUsdt >= min) return { allowed: true, reason: null };
  return { allowed: false, reason: 'VOLUME_LOW', volumeUsdt, minVolumeUsdt: min, lowVolumeMode: true };
}

/** Saída a mercado agressiva quando volume baixo ou usuário autorizou */
function needsMarketSell(config, volumeUsdt) {
  if (config?.allowLowVolume) return true;
  if (volumeUsdt == null) return false;
  const min = config?.minVolumeUsdt ?? BOT_DEFAULTS.minVolumeUsdt;
  return volumeUsdt < min;
}

function getStopLossMa(maSnap, config) {
  const sl = config.stopLoss;
  const key = `sl_${maKey(sl.period, sl.interval)}`;
  return maSnap[key]?.ma ?? maSnap[maKey(sl.period, sl.interval)]?.ma ?? null;
}

/** Relatório de adaptação para 1+ intervalos */
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
  checkMinVolume,
  needsMarketSell,
  buildAdaptiveReport,
  maKey,
  BOT_DEFAULTS,
  INTERVAL_MS,
};
