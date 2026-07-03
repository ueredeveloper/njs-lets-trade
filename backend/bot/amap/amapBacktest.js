'use strict';

/**
 * Backtest AMAP — retorna JSON estruturado (API / painel Multi-Trade).
 * Equivalente a: node backend/bot/amap/amap-bot.js --backtest SYMBOL exchange capital
 */

const path = require('path');
const fs   = require('fs');
const ti   = require('technicalindicators');
const { computeMaSeries } = require('../../utils/movingAverage');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const {
  getRequiredSpecs, computeAdaptiveDips, computeMaFilterTimeStats, diagnoseEntry, evaluateExit,
  getStopLossMa, isStopLossExit, checkRsi, maKey, INTERVAL_MS,
  getEntryScanInterval, entryRsiPathActive, entryMaPathActive, resolveEntrySignal,
  getEntryDiscount, shouldUseImmediateEntry, resolveActiveMaFilters,
} = require('./strategyEngine');
const { buildExitReasonDetail, buildPendingCancelDetail, inferRuleId } = require('./exitReasonFormat');
const {
  evaluateRule2Exit, getRule2ExitRsiConditions, checkRule2ExitRsiConditions,
  computeRule2AdaptiveDip,
} = require('./rule2Engine');

const DATA_DIR = path.join(__dirname, '../../data/candlestick');
const LIMIT    = 1000;

const ENTRY_OUTCOME_LABELS = {
  MA_BLOCKED:            'bloqueado — abaixo MA fixo',
  MA_ADAPTIVE_BLOCKED:   'bloqueado — abaixo piso adaptativo',
  MA_NO_DATA:            'bloqueado — sem dados MA',
  ABOVE_MA_NOT_MET:      'bloqueado — candles abaixo da MA',
  ABOVE_MA_INSUFFICIENT_DATA: 'bloqueado — histórico insuficiente',
  ABOVE_MA_NO_DATA:      'bloqueado — sem dados candles acima MA',
  THREE_CANDLES_BLOCKED: 'bloqueado — extensão sem 3/4 velas',
  PENDING:               'pendente (aguardando desconto)',
  PENDING_OPEN:          'pendente ao fim do período',
  BOUGHT:                'comprado',
  POSITION_OPEN:         'comprado — posição aberta',
  STOP_LOSS_MA:          'comprado — stop MA',
  STOP_LOSS_ADAPTIVE:    'comprado — stop adaptativo',
  STOP_LOSS_PCT_CAP:     'comprado — stop −5% entrada',
  SOLD_RSI:              'vendido — RSI saída',
  CANCELLED_EXIT_RSI:    'cancelado — RSI saída',
  CANCELLED_RECOVERY:    'cancelado — preço subiu',
  CANCELLED_TIMEOUT:     'cancelado — timeout',
};

function computeRsiSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period });
  return rsiArr.map((rsi, i) => ({
    openTime: candles[period + i].openTime,
    close:    candles[period + i].close,
    rsi,
  }));
}

function exitRsiAt(exitSeries, entryTime) {
  let best = null;
  for (let i = 0; i < exitSeries.length; i++) {
    if (exitSeries[i].openTime <= entryTime) best = exitSeries[i].rsi;
    else break;
  }
  return best;
}

/** RSI de saída usando só velas fechadas (evita lookahead intra-bar). */
function exitRsiAtClosed(exitSeries, atTime, interval) {
  const intervalMs = INTERVAL_MS[interval] ?? 3_600_000;
  let best = null;
  for (const point of exitSeries) {
    if (point.openTime + intervalMs <= atTime) best = point.rsi;
    else break;
  }
  return best;
}

function buildExitRsiSpecs(config) {
  const specs = [];
  const seen = new Set();
  const add = (interval, period = 14) => {
    if (!interval) return;
    const key = `${interval}|${period}`;
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({ interval, period });
  };
  add(config.exitRsi?.interval, config.exitRsi?.period ?? 14);
  if (config.rule2?.enabled) {
    for (const c of getRule2ExitRsiConditions(config.rule2)) {
      add(c.interval, c.period ?? 14);
    }
  }
  return specs;
}

function buildExitRsiSeriesMap(cMap, specs) {
  const out = {};
  for (const { interval, period } of specs) {
    const candles = cMap[interval];
    if (!candles?.length) continue;
    out[`${interval}|${period}`] = computeRsiSeries(candles, period);
  }
  return out;
}

function exitRsiMapAt(seriesMap, specs, atTime, { closedOnly = true } = {}) {
  const map = {};
  for (const { interval, period } of specs) {
    const series = seriesMap[`${interval}|${period}`];
    if (!series) continue;
    map[interval] = closedOnly
      ? exitRsiAtClosed(series, atTime, interval)
      : exitRsiAt(series, atTime);
  }
  return map;
}

function evaluateBacktestExit({
  close, exitRsiMap, stopLossMa, maSnap, adaptiveDips, config, buyEntryKind, buyPrice, rule2Dip,
}) {
  const ruleId = inferRuleId(buyEntryKind);
  if (ruleId === 'rule2' && config.rule2?.enabled) {
    return evaluateRule2Exit({
      close,
      exitRsiMap,
      rule2: config.rule2,
      entryPrice: buyPrice,
      maSnap,
      adaptiveDip: rule2Dip,
    });
  }
  const iv = config.exitRsi?.interval;
  return evaluateExit({
    close,
    exitRsi: iv ? exitRsiMap[iv] : null,
    stopLossMa,
    maSnap,
    adaptiveDips,
    config,
    entryKind: buyEntryKind,
    entryPrice: buyPrice,
  });
}

function pendingExitRsiHit(exitRsiMap, config, entryKind) {
  const ruleId = inferRuleId(entryKind);
  if (ruleId === 'rule2' && config.rule2?.enabled) {
    return !!checkRule2ExitRsiConditions(exitRsiMap, config.rule2);
  }
  const iv = config.exitRsi?.interval;
  return checkRsi(iv ? exitRsiMap[iv] : null, config.exitRsi);
}

function pendingCancelExitMeta(exitRsiMap, config, entryKind) {
  const ruleId = inferRuleId(entryKind);
  if (ruleId === 'rule2' && config.rule2?.enabled) {
    const matched = checkRule2ExitRsiConditions(exitRsiMap, config.rule2);
    if (matched) {
      return {
        exitRsi: exitRsiMap[matched.interval],
        exitRsiConfig: matched,
      };
    }
    return { exitRsi: null, exitRsiConfig: config.rule2.exitRsi ?? config.exitRsi };
  }
  const iv = config.exitRsi?.interval;
  return { exitRsi: iv ? exitRsiMap[iv] : null, exitRsiConfig: config.exitRsi };
}

function maAt(maSeries, time) {
  let best = null;
  for (const point of maSeries) {
    if (point.openTime <= time) best = point.ma;
    else break;
  }
  return best;
}

function loadLocalCandles(symbol, interval) {
  const filePath = path.join(DATA_DIR, `${symbol}-${interval}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const arr = Array.isArray(raw) ? raw : Object.values(raw)[0];
  return arr.map(c => ({
    openTime: Number(c.openTime ?? c[0]),
    open:  parseFloat(c.open  ?? c[1]),
    high:  parseFloat(c.high  ?? c[2]),
    low:   parseFloat(c.low   ?? c[3]),
    close: parseFloat(c.close ?? c[4]),
  }));
}

function rsiAt(rsiSeries, openTime) {
  let best = null;
  for (const point of rsiSeries) {
    if (point.openTime <= openTime) best = point.rsi;
    else break;
  }
  return best;
}

function candleCtxAt(cMap, interval, openTime) {
  const candles = (cMap[interval] ?? []).filter(c => c.openTime <= openTime);
  if (!candles.length) return null;
  const n = candles.length;
  return {
    close: candles[n - 1].close,
    low:   candles[n - 1].low,
    prevClose: n >= 2 ? candles[n - 2].close : null,
    openTime: candles[n - 1].openTime,
  };
}

function buildEntryScanPoints(cMap, config) {
  const scanIv     = getEntryScanInterval(config);
  const scanCandles = cMap[scanIv] ?? [];
  if (!scanCandles.length) return { scanIv, points: [] };

  const entryRsiSeries = computeRsiSeries(
    cMap[config.entryRsi.interval] ?? scanCandles,
    config.entryRsi.period,
  );
  const maPathRsiSeries = entryMaPathActive(config) && config.entryMa.requireRsi
    ? computeRsiSeries(
      cMap[config.entryMa.entryRsi.interval] ?? scanCandles,
      config.entryMa.entryRsi.period,
    )
    : null;

  const minStart = Math.max(
    entryRsiPathActive(config) ? config.entryRsi.period : 0,
    entryMaPathActive(config) ? config.entryMa.period : 0,
    1,
  );

  const points = [];
  for (let i = minStart; i < scanCandles.length; i++) {
    const c = scanCandles[i];
    const rsiCtx = {
      close: c.close,
      low:   c.low,
      prevClose: i > 0 ? scanCandles[i - 1].close : null,
    };
    const maIv   = entryMaPathActive(config) ? config.entryMa.interval : scanIv;
    const maCtx  = candleCtxAt(cMap, maIv, c.openTime) ?? rsiCtx;

    points.push({
      openTime: c.openTime,
      close: c.close,
      entryRsi: rsiAt(entryRsiSeries, c.openTime),
      maPathRsi: maPathRsiSeries ? rsiAt(maPathRsiSeries, c.openTime) : null,
      rsiCtx,
      maCtx,
    });
  }
  return { scanIv, points };
}

function maSnapAt(cMap, config, openTime) {
  const snap = {};
  const add = (key, period, interval) => {
    const candles = (cMap[interval] ?? []).filter(c => c.openTime <= openTime);
    if (!candles.length) return;
    const series = computeMaSeries(candles, period);
    snap[key] = { ma: maAt(series, openTime), candles, period, interval };
  };
  for (const f of resolveActiveMaFilters(config)) {
    add(maKey(f.period, f.interval), f.period, f.interval);
  }
  if (config.extension?.enabled) {
    const iv = config.extension.maInterval;
    const p  = config.extension.maPeriod ?? 50;
    if (!snap[maKey(p, iv)]) add(maKey(p, iv), p, iv);
  }
  if (entryMaPathActive(config)) {
    const em = config.entryMa;
    add(maKey(em.period, em.interval), em.period, em.interval);
  }
  const sl = config.stopLoss;
  if (sl) add(`sl_${maKey(sl.period, sl.interval)}`, sl.period, sl.interval);
  return snap;
}

function backtestPeriodLabel(candles, interval = null) {
  if (!candles?.length) return null;
  const from  = candles[0].openTime;
  const to    = candles[candles.length - 1].openTime;
  const days  = (to - from) / 86_400_000;
  return {
    from, to,
    interval,
    daysLbl: days >= 1 ? `~${Math.round(days)} dias` : '<1 dia',
    count: candles.length,
  };
}

function formatStopLossLabel(config) {
  if (!config.stopLoss || config.stopLoss.enabled === false) return 'desligado';
  const parts = [];
  if (config.stopLoss.fixedEnabled !== false) {
    parts.push(`MA${config.stopLoss.period}(${config.stopLoss.interval})`);
  }
  if (config.stopLoss.adaptiveEnabled !== false) {
    for (const f of (config.maFilters ?? []).filter(m => m.mode === 'adaptive')) {
      parts.push(`adapt MA${f.period}(${f.interval}) −dip%`);
    }
  }
  return parts.length ? parts.join(' + ') : 'desligado';
}

function formatEntryPathsLabel(config) {
  const parts = [];
  if (entryRsiPathActive(config)) {
    parts.push(`RSI(${config.entryRsi.interval})${config.entryRsi.operator}${config.entryRsi.value}`);
  }
  if (entryMaPathActive(config)) {
    const em = config.entryMa;
    let lbl = `MA${em.period}(${em.interval}) ${em.trigger ?? 'touch'}`;
    if (em.requireRsi) {
      const r = em.entryRsi;
      lbl += ` + RSI(${r.interval})${r.operator}${r.value}`;
    }
    parts.push(lbl);
  }
  return parts.length ? parts.join(' OR ') : '—';
}

const ENTRY_KIND_SHORT = { rsi: 'RSI', ma: 'MA' };

function formatEntryKindLabel(kind, config) {
  if (kind === 'rsi') {
    const r = config.entryRsi;
    return `RSI(${r.interval}) ${r.operator ?? '<'} ${r.value}`;
  }
  if (kind === 'ma') {
    const em = config.entryMa;
    const triggerLbl = em.trigger === 'cross_up' ? 'cruzamento ↑' : 'toque';
    let lbl = `MA${em.period} ${em.interval} (${triggerLbl})`;
    if (em.requireRsi) {
      const r = em.entryRsi;
      lbl += ` + RSI(${r.interval}) ${r.operator ?? '<'} ${r.value}`;
    }
    return lbl;
  }
  return null;
}

async function fetchCandlesForExchange(exchange, symbol, interval, limit) {
  if (exchange === 'gate') {
    return fetchGateCandles(toGateSymbol(symbol), limit, interval);
  }
  return fetchBinanceCandles(symbol, limit, interval);
}

function resolveRuleConfigForBacktest(config, ruleId) {
  if (ruleId === 'rule2') {
    if (config.rule2) return config.rule2;
    return {
      exitRsi: { interval: '1h', period: 14, operator: '>', value: 70 },
      entryMa: config.entryMa ?? { period: 50, interval: '1h' },
      stopLoss: { adaptiveEnabled: true },
    };
  }
  return config.rule1 ?? config;
}

function reconcileEntryLog(entryLog, signals) {
  const byTime = new Map(entryLog.map(e => [e.time, e]));
  for (const sig of signals) {
    const row = byTime.get(sig.entryTime);
    if (!row) continue;
    row.outcome = sig.result;
    if (sig.pnlPct != null) row.pnlPct = sig.pnlPct;
    if (sig.exitDetail) row.exitDetail = sig.exitDetail;
    if (sig.ruleId) row.ruleId = sig.ruleId;
    if (sig.cancelDetail) row.cancelDetail = sig.cancelDetail;
    if (sig.cancelTime) row.cancelTime = sig.cancelTime;
    if (sig.buyTime) row.buyTime = sig.buyTime;
    if (sig.buyPrice != null) row.buyPrice = sig.buyPrice;
    if (sig.exitTime) row.exitTime = sig.exitTime;
    if (sig.exitPrice != null) row.exitPrice = sig.exitPrice;
  }
}

function buildEntryOutcomeLabel(e) {
  if (e.cancelDetail?.label) return e.cancelDetail.label;
  if (e.exitDetail?.label) return e.exitDetail.label;
  const failed = (e.maChecks ?? []).find(m => !m.ok);
  if (failed) {
    if (e.outcome === 'MA_NO_DATA' || failed.detail === 'sem dados') {
      return `bloqueado — sem histórico ${failed.label} (mín. 50 velas no intervalo)`;
    }
    if (e.outcome === 'MA_ADAPTIVE_BLOCKED' || failed.mode === 'adapt') {
      return `bloqueado — abaixo piso adaptativo ${failed.label}`;
    }
    if (e.outcome === 'MA_BLOCKED' || failed.mode === 'fixo') {
      return `bloqueado — abaixo ${failed.label}`;
    }
  }
  return ENTRY_OUTCOME_LABELS[e.outcome] ?? e.outcome ?? '—';
}

function serializeEntryRow(e) {
  const ruleId = e.ruleId ?? inferRuleId(e.entryKind);
  const exitLabel = e.exitDetail?.label ?? null;
  const cancelLabel = e.cancelDetail?.label ?? null;
  const outcomeLabel = cancelLabel ?? exitLabel ?? buildEntryOutcomeLabel(e);
  return {
    time: e.time,
    timeISO: new Date(e.time).toISOString(),
    cancelTime: e.cancelTime ?? e.cancelDetail?.cancelTime ?? null,
    cancelTimeISO: e.cancelTime ? new Date(e.cancelTime).toISOString() : (
      e.cancelDetail?.cancelTime ? new Date(e.cancelDetail.cancelTime).toISOString() : null
    ),
    buyTime: e.buyTime ?? null,
    buyTimeISO: e.buyTime ? new Date(e.buyTime).toISOString() : null,
    buyPrice: e.buyPrice ?? null,
    exitTime: e.exitTime ?? null,
    exitTimeISO: e.exitTime ? new Date(e.exitTime).toISOString() : null,
    exitPrice: e.exitPrice ?? null,
    rsi: e.rsi != null ? parseFloat(Number(e.rsi).toFixed(2)) : null,
    maPathRsi: e.maPathRsi != null ? parseFloat(Number(e.maPathRsi).toFixed(2)) : null,
    price: e.price,
    ruleId,
    ruleShort: ruleId === 'rule2' ? 'R2' : ruleId === 'rule1' ? 'R1' : null,
    entryKind: e.entryKind ?? null,
    entryKindShort: ruleId === 'rule2' ? 'R2' : ruleId === 'rule1' ? 'R1' : (ENTRY_KIND_SHORT[e.entryKind] ?? null),
    entryKindLabel: e.entryKindLabel ?? null,
    outcome: e.outcome,
    exitDetail: e.exitDetail ?? null,
    cancelDetail: e.cancelDetail ?? null,
    outcomeLabel,
    outcomeShort: e.cancelDetail?.short ?? e.exitDetail?.short ?? (
      (e.maChecks ?? []).find(m => !m.ok)?.detail ?? null
    ),
    outcomeDetail: e.cancelDetail?.detail ?? (
      (e.maChecks ?? []).find(m => !m.ok)?.detail ?? null
    ),
    pnlPct: e.pnlPct != null ? parseFloat(e.pnlPct.toFixed(2)) : null,
    maChecks: (e.maChecks ?? []).map(m => ({
      label: m.label,
      ok: m.ok,
      mode: m.mode ?? null,
      detail: m.detail ?? null,
    })),
    extension: e.extension ? {
      extended: e.extension.extended,
      threeOk:  e.extension.threeOk,
      fourOk:   e.extension.fourOk,
      allowed:  e.extension.allowed,
    } : null,
  };
}

/** Limita payload JSON do backtest (evita resposta >512KB truncada no browser). */
function compactBacktestForApi(result, { maxEntryLog = 250 } = {}) {
  if (!result?.entryLog?.length) return result;
  const total = result.entryLog.length;
  if (total <= maxEntryLog) return result;

  const priority = row => {
    const o = row.outcome ?? '';
    if (o === 'BOUGHT' || o === 'PENDING' || o.startsWith('SOLD') || o.startsWith('STOP')) return 0;
    if (o.startsWith('CANCELLED')) return 1;
    if (o.startsWith('MA_') || o.includes('BLOCKED')) return 2;
    return 3;
  };

  const sorted = [...result.entryLog].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return b.time - a.time;
  });

  const kept = sorted.slice(0, maxEntryLog).sort((a, b) => a.time - b.time);
  return {
    ...result,
    entryLog: kept,
    entryLogTruncated: true,
    entryLogTotal: total,
  };
}

/**
 * @param {{ symbol, config, exchange?, capital?, cMap? }} opts
 * @returns {Promise<object>}
 */
async function runAmapBacktest({ symbol, config, exchange = 'binance', capital = 100, cMap: cMapIn }) {
  const specs = getRequiredSpecs(config);
  const cMap  = cMapIn ?? {};

  if (!cMapIn) {
    const minMaWarmup = Math.max(
      50,
      ...(resolveActiveMaFilters(config)).map(f => (f.period ?? 50) + 10),
    );
    for (const { interval, limit } of specs) {
      const need = Math.max(limit, LIMIT, minMaWarmup);
      let candles = loadLocalCandles(symbol, interval);
      if (!candles?.length || candles.length < need) {
        const fetched = await fetchCandlesForExchange(exchange, symbol, interval, need);
        if (!candles?.length || fetched.length > candles.length) candles = fetched;
      }
      cMap[interval] = candles;
    }
  }

  const entryCandles = cMap[config.entryRsi.interval];
  const exitCandles  = cMap[config.exitRsi.interval];
  const scanIv       = getEntryScanInterval(config);
  const scanCandles  = cMap[scanIv];
  if (!scanCandles?.length && !entryCandles?.length) {
    return { error: 'sem candles de entrada', symbol, exchange, capital };
  }

  const { points: scanPoints } = buildEntryScanPoints(cMap, config);
  const exitRsiSpecs = buildExitRsiSpecs(config);
  const exitRsiSeriesMap = buildExitRsiSeriesMap(cMap, exitRsiSpecs);

  const adaptiveDips  = computeAdaptiveDips(cMap, config);
  const maFilterStats = computeMaFilterTimeStats(cMap, config, adaptiveDips);
  const startCapital  = Number(capital);

  let phase = 'WATCHING';
  let buyQty = null, buyUsdt = null;
  let triggerPrice = null, limitPrice = null, pendingSince = null;
  const trades = [], signals = [];
  const entryLog = [];
  let blockedCount = 0;
  let pendingSignal = null;
  let openSignalIdx = null;
  let runningCapital = startCapital;
  let lastMaSignalOpenTime = null;
  let buyEntryKind = null;
  let pendingEntryKind = null;
  let buyPrice = null;

  const botOpts = {
    entryDiscount:    config.entryDiscount    ?? 0.001,
    immediateEntry:   config.immediateEntry   ?? false,
    pendingTimeoutMs: config.pendingTimeoutMs ?? 30 * 60_000,
    pendingCancelPct: config.pendingCancelPct ?? 0.002,
    pendingCancelOnExitRsi: config.pendingCancelOnExitRsi ?? true,
  };

  for (const pt of scanPoints) {
    const { openTime, close, entryRsi, maPathRsi, rsiCtx, maCtx } = pt;
    const exitRsiMap = exitRsiMapAt(exitRsiSeriesMap, exitRsiSpecs, openTime);
    const maSnap     = maSnapAt(cMap, config, openTime);

    if (phase === 'WATCHING') {
      const resolved = resolveEntrySignal({
        entryRsi, maPathRsi, rsiCtx, maCtx,
        close, low: rsiCtx.low, prevClose: rsiCtx.prevClose,
        entryTimeMs: openTime, config, maSnap, adaptiveDips, cMap,
      });

      if (!resolved.allowed && resolved.reason === 'NO_ENTRY_SIGNAL') continue;

      const diag = diagnoseEntry({
        entryRsi, maPathRsi, rsiCtx, maCtx,
        close, low: rsiCtx.low, prevClose: rsiCtx.prevClose,
        entryTimeMs: openTime, config, maSnap, adaptiveDips, cMap,
      });
      const entryCheck = resolved;

      const pathSignal = diag.paths.some(p => p.signal);
      if (!pathSignal) continue;

      const maPathFired = diag.paths.some(p => p.kind === 'ma' && p.signal);
      if (maPathFired && lastMaSignalOpenTime === maCtx.openTime) continue;
      if (maPathFired) lastMaSignalOpenTime = maCtx.openTime;

      const resolvedKind = entryCheck.entryKind ?? diag.entryKind;
      const useImmediate = entryCheck.allowed
        && shouldUseImmediateEntry(resolvedKind, { ...config, ...botOpts });
      const pathDiscount = getEntryDiscount(resolvedKind, { ...config, ...botOpts });

      entryLog.push({
        time: openTime, price: close, rsi: entryRsi, maPathRsi,
        entryKind: diag.entryKind,
        entryKindLabel: formatEntryKindLabel(diag.entryKind, config),
        maChecks: diag.maChecks, extension: diag.extension,
        outcome: entryCheck.allowed ? (useImmediate ? 'BOUGHT' : 'PENDING') : entryCheck.reason,
      });

      if (!entryCheck.allowed) {
        blockedCount++;
        signals.push({
          entryTime: openTime, entryRsi, entryPrice: close,
          entryKind: diag.entryKind, result: entryCheck.reason,
        });
        continue;
      }

      if (useImmediate) {
        openSignalIdx = signals.length;
        signals.push({
          entryTime: openTime, entryRsi, entryPrice: close, entryKind: entryCheck.entryKind,
          buyTime: openTime, buyPrice: close, result: 'BOUGHT',
        });
        buyQty = runningCapital / close; buyUsdt = runningCapital;
        buyEntryKind = entryCheck.entryKind;
        buyPrice = close;
        phase = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi, entryKind: entryCheck.entryKind });
      } else {
        triggerPrice = close;
        limitPrice   = parseFloat((close * (1 - pathDiscount)).toFixed(8));
        pendingSince = openTime;
        pendingEntryKind = entryCheck.entryKind;
        pendingSignal = {
          entryTime: openTime, entryRsi, entryPrice: close, entryKind: entryCheck.entryKind,
        };
        phase = 'PENDING';
      }

    } else if (phase === 'PENDING') {
      const elapsedMs  = openTime - pendingSince;
      const cancelLine = triggerPrice * (1 + botOpts.pendingCancelPct);
      const exitRsiHit = botOpts.pendingCancelOnExitRsi !== false
        && pendingExitRsiHit(exitRsiMap, config, pendingEntryKind ?? pendingSignal?.entryKind);
      if (close > cancelLine || elapsedMs > botOpts.pendingTimeoutMs || exitRsiHit) {
        const reason = exitRsiHit ? 'CANCELLED_EXIT_RSI'
          : close > cancelLine ? 'CANCELLED_RECOVERY' : 'CANCELLED_TIMEOUT';
        const pendingRuleId = inferRuleId(pendingEntryKind ?? pendingSignal?.entryKind);
        const cancelExitMeta = pendingCancelExitMeta(
          exitRsiMap, config, pendingEntryKind ?? pendingSignal?.entryKind,
        );
        const cancelDetail = buildPendingCancelDetail({
          reason,
          ruleId: pendingRuleId,
          entryKind: pendingEntryKind ?? pendingSignal?.entryKind,
          pendingSince,
          cancelTime: openTime,
          elapsedMs,
          pendingTimeoutMs: botOpts.pendingTimeoutMs,
          triggerPrice,
          limitPrice,
          cancelLine,
          closeAtCancel: close,
          exitRsi: cancelExitMeta.exitRsi,
          exitRsiConfig: cancelExitMeta.exitRsiConfig,
          exitRsiHit,
        });
        if (pendingSignal) {
          signals.push({
            ...pendingSignal,
            result: reason,
            cancelDetail,
            cancelTime: openTime,
            ruleId: pendingRuleId,
          });
          pendingSignal = null;
        }
        phase = 'WATCHING';
        triggerPrice = limitPrice = pendingSince = null;
        pendingEntryKind = null;
      } else if (close <= limitPrice) {
        openSignalIdx = signals.length;
        signals.push({
          ...pendingSignal,
          buyTime: openTime,
          buyPrice: close,
          result: 'BOUGHT',
        });
        buyEntryKind = pendingEntryKind ?? pendingSignal?.entryKind ?? null;
        buyPrice = close;
        pendingSignal = null;
        pendingEntryKind = null;
        buyQty = runningCapital / close; buyUsdt = runningCapital;
        phase = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi, entryKind: buyEntryKind });
        triggerPrice = limitPrice = pendingSince = null;
      }

    } else if (phase === 'BOUGHT') {
      const stopLossMa = getStopLossMa(maSnap, config);
      const rule2Dip = buyEntryKind === 'ma' && config.rule2?.entryMa
        ? computeRule2AdaptiveDip(
          maSnap[maKey(config.rule2.entryMa.period, config.rule2.entryMa.interval)]?.candles,
          config.rule2,
        )
        : null;
      const exitEval = evaluateBacktestExit({
        close, exitRsiMap, stopLossMa, maSnap, adaptiveDips, config,
        buyEntryKind, buyPrice, rule2Dip,
      });
      if (exitEval.exit) {
        const usdtOut = buyQty * close;
        const pnl     = usdtOut - buyUsdt;
        runningCapital += pnl;
        const ruleId = inferRuleId(buyEntryKind);
        const ruleConfig = resolveRuleConfigForBacktest(config, ruleId);
        const exitDetail = buildExitReasonDetail({
          ruleId, entryKind: buyEntryKind, exitEval, ruleConfig,
        });
        const exitRsiLogged = exitEval.exitRsiCondition?.interval
          ? exitRsiMap[exitEval.exitRsiCondition.interval]
          : exitRsiMap[config.exitRsi?.interval];
        if (openSignalIdx !== null) {
          signals[openSignalIdx].exitTime  = openTime;
          signals[openSignalIdx].exitPrice = close;
          signals[openSignalIdx].exitRsi   = exitRsiLogged;
          signals[openSignalIdx].pnlPct    = (pnl / buyUsdt) * 100;
          signals[openSignalIdx].exitDetail = exitDetail;
          signals[openSignalIdx].ruleId = ruleId;
          if (exitEval.reason === 'stop_loss_ma') signals[openSignalIdx].result = 'STOP_LOSS_MA';
          else if (exitEval.reason === 'stop_loss_adaptive') signals[openSignalIdx].result = 'STOP_LOSS_ADAPTIVE';
          else if (exitEval.reason === 'stop_loss_pct_cap') signals[openSignalIdx].result = 'STOP_LOSS_PCT_CAP';
          else if (exitEval.reason === 'rsi') signals[openSignalIdx].result = 'SOLD_RSI';
          openSignalIdx = null;
        }
        trades.push({
          type: 'SELL', time: openTime, price: close, exitRsi: exitRsiLogged,
          exitReason: exitEval.reason,
          exitDetail,
          ruleId,
          stopLoss: isStopLossExit(exitEval.reason),
          pnlUsdt: pnl, pnlPct: (pnl / buyUsdt) * 100, capitalAfter: runningCapital,
        });
        phase = 'WATCHING';
        buyQty = buyUsdt = null;
        buyEntryKind = null;
        buyPrice = null;
      }
    }
  }

  if (pendingSignal) signals.push({ ...pendingSignal, result: 'PENDING_OPEN' });
  if (phase === 'BOUGHT' && openSignalIdx !== null) signals[openSignalIdx].result = 'POSITION_OPEN';

  reconcileEntryLog(entryLog, signals);

  const sells    = trades.filter(t => t.type === 'SELL');
  const wins     = sells.filter(t => t.pnlUsdt >= 0).length;
  const totalPnl = sells.reduce((s, t) => s + t.pnlUsdt, 0);
  const period   = backtestPeriodLabel(scanCandles ?? entryCandles, scanIv);

  return compactBacktestForApi({
    symbol: symbol.toUpperCase(),
    exchange,
    capital: startCapital,
    label: config.label ?? 'AMAP',
    command: `node backend/bot/amap/amap-bot.js --backtest ${symbol.toUpperCase()} ${exchange} ${startCapital}`,
    config: {
      entryRsi: config.entryRsi,
      exitRsi:  config.exitRsi,
      entryPaths: formatEntryPathsLabel(config),
      stopLoss: formatStopLossLabel(config),
    },
    period,
    maFilterStats,
    candlesByInterval: Object.fromEntries(
      Object.entries(cMap).map(([iv, arr]) => [iv, arr?.length ?? 0]),
    ),
    summary: {
      startCapital,
      endCapital: parseFloat(runningCapital.toFixed(2)),
      totalPnlUsdt: parseFloat(totalPnl.toFixed(2)),
      totalPnlPct: parseFloat(((runningCapital / startCapital - 1) * 100).toFixed(2)),
      trades: sells.length,
      wins,
      losses: sells.length - wins,
      winRate: sells.length ? parseFloat(((wins / sells.length) * 100).toFixed(1)) : null,
      blockedCount,
      stopMaCount: sells.filter(t => t.exitReason === 'stop_loss_ma').length,
      stopAdaptCount: sells.filter(t => t.exitReason === 'stop_loss_adaptive').length,
      stopPctCapCount: sells.filter(t => t.exitReason === 'stop_loss_pct_cap').length,
      rsiExitCount: sells.filter(t => t.exitReason === 'rsi').length,
      entrySignals: entryLog.length,
    },
    entryLog: entryLog.map(serializeEntryRow),
    trades: trades.map(t => ({
      type: t.type,
      time: t.time,
      timeISO: new Date(t.time).toISOString(),
      price: t.price,
      entryRsi: t.entryRsi ?? null,
      exitRsi: t.exitRsi ?? null,
      exitReason: t.exitReason ?? null,
      exitDetail: t.exitDetail ?? null,
      ruleId: t.ruleId ?? null,
      pnlUsdt: t.pnlUsdt != null ? parseFloat(t.pnlUsdt.toFixed(2)) : null,
      pnlPct: t.pnlPct != null ? parseFloat(t.pnlPct.toFixed(2)) : null,
      capitalAfter: t.capitalAfter ?? null,
    })),
  });
}

module.exports = {
  runAmapBacktest,
  compactBacktestForApi,
  ENTRY_OUTCOME_LABELS,
  formatStopLossLabel,
  formatEntryPathsLabel,
  formatEntryKindLabel,
  ENTRY_KIND_SHORT,
  loadLocalCandles,
  computeRsiSeries,
  exitRsiAt,
  exitRsiAtClosed,
  exitRsiMapAt,
  maSnapAt,
};
