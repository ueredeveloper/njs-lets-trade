'use strict';

/**
 * AMAP — Adaptive MA Pullback engine
 * Motor unificado: lê parâmetros normalizados (tradeConfigSchema) e avalia entrada/saída.
 */

const ti = require('technicalindicators');
const { analyzeAdaptiveDip, lastMa, DEFAULT_OPTS } = require('./adaptiveMaDip');
const { buildEntryDiscountReport } = require('./suggestEntryDiscount');
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
  pendingCancelOnExitRsi: TRADE_CONFIG_DEFAULTS.execution.pendingCancelOnExitRsi,
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
function stopLossFixedActive(config) {
  const sl = config?.stopLoss;
  if (!sl || sl.enabled === false) return false;
  return sl.fixedEnabled !== false;
}

function stopLossAdaptiveActive(config) {
  const sl = config?.stopLoss;
  if (!sl || sl.enabled === false) return false;
  return sl.adaptiveEnabled !== false;
}

function stopLossAnyActive(config) {
  return stopLossFixedActive(config) || stopLossAdaptiveActive(config);
}

function entryRsiPathActive(config) {
  return config?.entryRsiPath?.enabled !== false;
}

function entryMaPathActive(config) {
  return config?.entryMa?.enabled === true;
}

/** Intervalo mais fino entre os caminhos de entrada ativos */
function getEntryScanInterval(config) {
  const ivs = [];
  if (entryRsiPathActive(config)) ivs.push(config.entryRsi.interval);
  if (entryMaPathActive(config)) ivs.push(config.entryMa.interval);
  if (entryMaPathActive(config) && config.entryMa.requireRsi) {
    ivs.push(config.entryMa.entryRsi.interval);
  }
  if (!ivs.length) ivs.push(config.entryRsi.interval);
  return ivs.reduce((a, b) =>
    (INTERVAL_MS[a] ?? 1e12) <= (INTERVAL_MS[b] ?? 1e12) ? a : b);
}

function getRequiredSpecs(config) {
  const specs = new Map();
  const add = (interval, limit) => {
    const prev = specs.get(interval) ?? 0;
    specs.set(interval, Math.max(prev, limit));
  };

  if (entryRsiPathActive(config)) {
    add(config.entryRsi.interval, config.entryRsi.period + 50);
  }
  if (entryMaPathActive(config)) {
    add(config.entryMa.interval, config.entryMa.period + 60);
    if (config.entryMa.requireRsi) {
      add(config.entryMa.entryRsi.interval, config.entryMa.entryRsi.period + 50);
    }
  }
  if (!entryRsiPathActive(config) && !entryMaPathActive(config)) {
    add(config.entryRsi.interval, config.entryRsi.period + 50);
  }

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
  if (stopLossFixedActive(config)) {
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
    entryMaPathActive(config) && config.entryMa.interval,
    config.extension?.enabled && config.extension?.maInterval,
    config.stopLoss?.interval && stopLossFixedActive(config) && config.stopLoss.interval,
  ].filter(Boolean));

  for (const iv of intervals) {
    const candles = cMap[iv];
    if (!candles?.length) continue;
    for (const f of config.maFilters ?? []) {
      if (f.interval !== iv) continue;
      snap[maKey(f.period, iv)] = { ma: lastMa(candles, f.period), candles, period: f.period, interval: iv };
    }
    if (entryMaPathActive(config) && config.entryMa.interval === iv) {
      const p = config.entryMa.period;
      const k = maKey(p, iv);
      if (!snap[k]) snap[k] = { ma: lastMa(candles, p), candles, period: p, interval: iv };
    }
    if (config.extension?.enabled && config.extension.maInterval === iv) {
      const p = config.extension.maPeriod ?? 50;
      const k = maKey(p, iv);
      if (!snap[k]) snap[k] = { ma: lastMa(candles, p), candles, period: p, interval: iv };
    }
    if (stopLossFixedActive(config) && config.stopLoss?.interval === iv) {
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

function checkMaEntryTrigger({ close, low, prevClose, maSnap, config }) {
  const em = config.entryMa;
  if (!em?.enabled) return { triggered: false, reason: 'MA_PATH_OFF' };

  const key = maKey(em.period, em.interval);
  const md  = maSnap[key];
  const ma  = md?.ma;
  if (ma == null) return { triggered: false, reason: 'MA_ENTRY_NO_DATA', key };

  const tol     = (em.tolerancePct ?? 0.5) / 100;
  const trigger = em.trigger ?? 'touch';

  if (trigger === 'cross_up') {
    if (prevClose != null && prevClose < ma && close >= ma) {
      return { triggered: true, ma, key, trigger };
    }
    return { triggered: false, reason: 'MA_NO_CROSS', ma, key };
  }

  const nearClose = Math.abs(close - ma) / ma <= tol;
  const wickTouch = low != null && low <= ma * (1 + tol) && close >= ma * (1 - tol * 2);
  if (nearClose || wickTouch) return { triggered: true, ma, key, trigger };

  return { triggered: false, reason: 'MA_NOT_TOUCHED', ma, key };
}

function applySharedEntryFilters({ close, entryTimeMs, config, maSnap, adaptiveDips, cMap }) {
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

function resolveEntrySignal({
  entryRsi, maPathRsi,
  rsiCtx, maCtx,
  close, low, prevClose,
  entryTimeMs, config, maSnap, adaptiveDips, cMap,
}) {
  const rsiClose    = rsiCtx?.close ?? close;
  const rsiLow      = rsiCtx?.low ?? low;
  const rsiPrev     = rsiCtx?.prevClose ?? prevClose;
  const maClose     = maCtx?.close ?? close;
  const maLow       = maCtx?.low ?? low;
  const maPrevClose = maCtx?.prevClose ?? prevClose;

  const candidates = [];

  if (entryRsiPathActive(config) && checkRsi(entryRsi, config.entryRsi)) {
    candidates.push({ kind: 'rsi', close: rsiClose });
  }

  if (entryMaPathActive(config)) {
    const mt = checkMaEntryTrigger({
      close: maClose, low: maLow, prevClose: maPrevClose, maSnap, config,
    });
    if (mt.triggered) {
      const rsiForMa = maPathRsi ?? entryRsi;
      const rsiRule  = config.entryMa.requireRsi ? config.entryMa.entryRsi : null;
      if (!rsiRule || checkRsi(rsiForMa, rsiRule)) {
        candidates.push({ kind: 'ma', close: maClose, maTrigger: mt });
      }
    }
  }

  if (!candidates.length) {
    return { allowed: false, reason: 'NO_ENTRY_SIGNAL', kind: null };
  }

  candidates.sort((a, b) => (a.kind === 'rsi' ? 0 : 1) - (b.kind === 'rsi' ? 0 : 1));

  let lastBlock = { allowed: false, reason: 'NO_ENTRY_SIGNAL', kind: null };
  for (const c of candidates) {
    const filterResult = applySharedEntryFilters({
      close: c.close, entryTimeMs, config, maSnap, adaptiveDips, cMap,
    });
    if (filterResult.allowed) {
      return { allowed: true, reason: null, kind: c.kind, entryKind: c.kind };
    }
    lastBlock = { ...filterResult, kind: c.kind, entryKind: c.kind };
  }
  return lastBlock;
}

function evaluateEntry(params) {
  return resolveEntrySignal(params);
}

/** Detalha cada caminho de entrada, filtros MA e extensão (backtest / relatório). */
function diagnoseEntry({
  entryRsi, maPathRsi,
  rsiCtx, maCtx,
  close, low, prevClose,
  entryTimeMs, config, maSnap, adaptiveDips, cMap,
}) {
  const rsiClose    = rsiCtx?.close ?? close;
  const maClose     = maCtx?.close ?? close;
  const maLow       = maCtx?.low ?? low;
  const maPrevClose = maCtx?.prevClose ?? prevClose;

  const paths = [];

  if (entryRsiPathActive(config)) {
    paths.push({
      kind: 'rsi', active: true,
      signal: checkRsi(entryRsi, config.entryRsi),
      label: `RSI(${config.entryRsi.interval}) ${config.entryRsi.operator} ${config.entryRsi.value}`,
    });
  }

  if (entryMaPathActive(config)) {
    const mt = checkMaEntryTrigger({
      close: maClose, low: maLow, prevClose: maPrevClose, maSnap, config,
    });
    const em = config.entryMa;
    let rsiOk = true;
    if (em.requireRsi) {
      rsiOk = checkRsi(maPathRsi ?? entryRsi, em.entryRsi);
    }
    paths.push({
      kind: 'ma', active: true,
      signal: mt.triggered && rsiOk,
      maTrigger: mt,
      rsiOk,
      label: `MA${em.period} ${em.interval} (${em.trigger ?? 'touch'})` +
        (em.requireRsi ? ` + RSI ${em.entryRsi.operator} ${em.entryRsi.value}` : ''),
    });
  }

  const maChecks = [];
  for (const f of config.maFilters ?? []) {
    const key   = maKey(f.period, f.interval);
    const label = `MA${f.period} ${f.interval}`;
    const md    = maSnap[key];
    if (!md || md.ma == null) {
      maChecks.push({ label, ok: false, mode: f.mode, detail: 'sem dados' });
      continue;
    }
    const filterClose = paths.some(p => p.kind === 'ma' && p.signal) ? maClose : rsiClose;
    if (f.mode === 'strict_above') {
      const ok = filterClose > md.ma;
      maChecks.push({
        label, ok, mode: 'fixo',
        detail: ok ? `acima ${md.ma.toFixed(4)}` : `abaixo ${md.ma.toFixed(4)}`,
      });
    } else if (f.mode === 'adaptive') {
      const dipPct = adaptiveDips[key] ?? DEFAULT_OPTS.defaultPct;
      const floor  = md.ma * (1 - dipPct / 100);
      const ok     = filterClose >= floor;
      maChecks.push({
        label, ok, mode: 'adapt', dipPct,
        detail: ok
          ? `≥ piso ${floor.toFixed(4)} (−${dipPct.toFixed(1)}%)`
          : `< piso ${floor.toFixed(4)} (−${dipPct.toFixed(1)}%)`,
      });
    }
  }

  const signalPaths = paths.filter(p => p.signal);
  let extension = null;
  let allowed   = false;
  let reason    = 'NO_ENTRY_SIGNAL';
  let entryKind = null;

  if (signalPaths.length) {
    signalPaths.sort((a, b) => (a.kind === 'rsi' ? 0 : 1) - (b.kind === 'rsi' ? 0 : 1));
    for (const p of signalPaths) {
      const filterClose = p.kind === 'ma' ? maClose : rsiClose;
      const filterResult = applySharedEntryFilters({
        close: filterClose, entryTimeMs, config, maSnap, adaptiveDips, cMap,
      });
      if (filterResult.allowed) {
        allowed = true;
        reason = null;
        entryKind = p.kind;
        break;
      }
      reason = filterResult.reason;
      entryKind = p.kind;
    }
  }

  const rsiOk = paths.some(p => p.kind === 'rsi' && p.signal);

  if (allowed && config.extension?.enabled) {
    const extIv  = config.extension.maInterval;
    const extP   = config.extension.maPeriod ?? 50;
    const extKey = maKey(extP, extIv);
    const md     = maSnap[extKey];
    const extMa  = md?.ma;
    const filterClose = entryKind === 'ma' ? maClose : rsiClose;
    const { threeInterval, fourInterval } = getExtensionIntervals(config.extension);
    const confirmCandles = cMap ? {
      three: cMap[threeInterval],
      four:  cMap[fourInterval],
    } : { three: md?.candles, four: md?.candles };
    const ext = analyzeExtension(filterClose, extMa, confirmCandles, config.extension, entryTimeMs);
    extension = {
      label:    `ext MA${extP} ${extIv}`,
      extended: ext.extended,
      threeOk:  ext.threeOk,
      fourOk:   ext.fourOk,
      aboveMaPct: ext.aboveMaPct,
      thresholdPct: ext.thresholdPct,
      allowed:  !ext.extended || ext.allowed,
    };
    if (!extension.allowed) {
      allowed = false;
      reason  = ext.reason ?? 'THREE_CANDLES_BLOCKED';
    }
  } else if (!allowed && rsiOk && maChecks.some(m => !m.ok)) {
    if (maChecks.some(m => !m.ok && m.detail === 'sem dados')) reason = 'MA_NO_DATA';
    else {
      const failed = maChecks.find(m => !m.ok);
      if (failed) reason = failed.mode === 'adapt' ? 'MA_ADAPTIVE_BLOCKED' : 'MA_BLOCKED';
    }
  }

  return { rsiOk, allowed, reason, entryKind, paths, maChecks, extension };
}

function evaluateExit({ close, exitRsi, stopLossMa, maSnap, adaptiveDips, config }) {
  const adaptiveStopFloors = maSnap
    ? getAdaptiveStopFloors(maSnap, adaptiveDips, config)
    : [];
  const stopHit = checkStopLossHits(close, stopLossMa, adaptiveStopFloors, config);
  if (stopHit) return stopHit;

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
  if (!stopLossFixedActive(config)) return null;
  const sl = config.stopLoss;
  const key = `sl_${maKey(sl.period, sl.interval)}`;
  return maSnap[key]?.ma ?? maSnap[maKey(sl.period, sl.interval)]?.ma ?? null;
}

/** Pisos de stop adaptativo (MA × (1 − dip%)) para cada filtro MA em modo adaptive */
function getAdaptiveStopFloors(maSnap, adaptiveDips, config) {
  if (!stopLossAdaptiveActive(config)) return [];

  const floors = [];
  for (const f of config.maFilters ?? []) {
    if (f.mode !== 'adaptive') continue;
    const key = maKey(f.period, f.interval);
    const md  = maSnap[key];
    if (!md?.ma) continue;
    const dipPct = f.fixedDipPct ?? adaptiveDips?.[key] ?? DEFAULT_OPTS.defaultPct;
    floors.push({
      floor: md.ma * (1 - dipPct / 100),
      dipPct,
      ma: md.ma,
      period: f.period,
      interval: f.interval,
      key,
    });
  }
  return floors;
}

function isStopLossExit(reason) {
  return reason === 'stop_loss_ma' || reason === 'stop_loss_adaptive';
}

function checkStopLossHits(close, stopLossMa, adaptiveStopFloors, config) {
  if (!stopLossAnyActive(config)) return null;

  const stops = [];
  if (stopLossFixedActive(config) && stopLossMa != null) {
    stops.push({ level: stopLossMa, reason: 'stop_loss_ma' });
  }
  if (stopLossAdaptiveActive(config)) {
    for (const af of adaptiveStopFloors ?? []) {
      stops.push({
        level: af.floor,
        reason: 'stop_loss_adaptive',
        adaptiveKey: af.key,
        dipPct: af.dipPct,
        ma: af.ma,
        period: af.period,
        interval: af.interval,
      });
    }
  }

  const breached = stops.filter(s => close < s.level);
  if (!breached.length) return null;

  // Nível mais alto entre os violados = o que o preço atingiu primeiro na queda
  breached.sort((a, b) => b.level - a.level);
  const hit = breached[0];
  return {
    exit: true,
    reason: hit.reason,
    stopLossLevel: hit.level,
    ...(hit.reason === 'stop_loss_adaptive'
      ? { adaptiveKey: hit.adaptiveKey, dipPct: hit.dipPct, adaptiveMa: hit.ma }
      : { stopLossMa: hit.level }),
  };
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

/** Sugestão de dip % para um filtro MA adaptativo (histórico + snapshot ao vivo). */
function suggestAdaptiveDip(candles, period, interval, adaptiveOpts = {}) {
  const analysis = analyzeAdaptiveDip(candles, period, adaptiveOpts);
  const currentMa  = lastMa(candles, period);
  const close      = candles?.length ? candles[candles.length - 1].close : null;
  const dipPct     = analysis.dipPct;
  const floor      = currentMa != null ? currentMa * (1 - dipPct / 100) : null;
  const dipNow     = currentMa != null && close != null ? (currentMa - close) / currentMa * 100 : null;
  return {
    interval,
    period,
    suggestedDipPct: dipPct,
    ...analysis,
    currentMa,
    currentPrice: close,
    floor,
    dipNowPct: dipNow != null ? parseFloat(dipNow.toFixed(2)) : null,
    entryOk: floor != null && close != null && close >= floor,
  };
}

module.exports = {
  buildTradeConfig,
  getRequiredSpecs,
  getEntryScanInterval,
  entryRsiPathActive,
  entryMaPathActive,
  computeAdaptiveDips,
  buildMaSnapshot,
  evaluateEntry,
  resolveEntrySignal,
  checkMaEntryTrigger,
  diagnoseEntry,
  stopLossFixedActive,
  stopLossAdaptiveActive,
  stopLossAnyActive,
  evaluateExit,
  getStopLossMa,
  getAdaptiveStopFloors,
  isStopLossExit,
  checkStopLossHits,
  checkRsi,
  checkExtension,
  analyzeExtension,
  getExtensionIntervals,
  checkMinVolume,
  needsMarketSell,
  buildAdaptiveReport,
  suggestAdaptiveDip,
  buildEntryDiscountReport,
  maKey,
  BOT_DEFAULTS,
  INTERVAL_MS,
};
