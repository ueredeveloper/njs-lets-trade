'use strict';

/**
 * Backtest AMAP — retorna JSON estruturado (API / painel Multi-Trade).
 * Equivalente a: node backend/bot/amap/amap-bot.js --backtest SYMBOL exchange capital
 */

const path = require('path');
const fs   = require('fs');
const ti   = require('technicalindicators');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const {
  getRequiredSpecs, computeAdaptiveDips, diagnoseEntry, evaluateExit,
  getStopLossMa, isStopLossExit, checkRsi, maKey,
  getEntryScanInterval, entryRsiPathActive, entryMaPathActive, resolveEntrySignal,
} = require('./strategyEngine');

const DATA_DIR = path.join(__dirname, '../../data/candlestick');
const LIMIT    = 1000;

const ENTRY_OUTCOME_LABELS = {
  MA_BLOCKED:            'bloqueado — abaixo MA fixo',
  MA_ADAPTIVE_BLOCKED:   'bloqueado — abaixo piso adaptativo',
  MA_NO_DATA:            'bloqueado — sem dados MA',
  THREE_CANDLES_BLOCKED: 'bloqueado — extensão sem 3/4 velas',
  PENDING:               'pendente (aguardando desconto)',
  PENDING_OPEN:          'pendente ao fim do período',
  BOUGHT:                'comprado',
  POSITION_OPEN:         'comprado — posição aberta',
  STOP_LOSS_MA:          'comprado — stop MA',
  STOP_LOSS_ADAPTIVE:    'comprado — stop adaptativo',
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

function computeMaSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const maArr  = ti.SMA.calculate({ values: closes, period });
  return maArr.map((ma, i) => ({ openTime: candles[period - 1 + i].openTime, ma }));
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
  for (const f of config.maFilters ?? []) {
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

function backtestPeriodLabel(candles) {
  if (!candles?.length) return null;
  const from  = candles[0].openTime;
  const to    = candles[candles.length - 1].openTime;
  const days  = (to - from) / 86_400_000;
  return {
    from, to,
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

async function fetchCandlesForExchange(exchange, symbol, interval, limit) {
  if (exchange === 'gate') {
    return fetchGateCandles(toGateSymbol(symbol), limit, interval);
  }
  return fetchBinanceCandles(symbol, limit, interval);
}

function reconcileEntryLog(entryLog, signals) {
  const byTime = new Map(entryLog.map(e => [e.time, e]));
  for (const sig of signals) {
    const row = byTime.get(sig.entryTime);
    if (!row) continue;
    row.outcome = sig.result;
    if (sig.pnlPct != null) row.pnlPct = sig.pnlPct;
  }
}

function serializeEntryRow(e) {
  return {
    time: e.time,
    timeISO: new Date(e.time).toISOString(),
    rsi: e.rsi != null ? parseFloat(Number(e.rsi).toFixed(2)) : null,
    price: e.price,
    entryKind: e.entryKind ?? null,
    outcome: e.outcome,
    outcomeLabel: ENTRY_OUTCOME_LABELS[e.outcome] ?? e.outcome ?? '—',
    pnlPct: e.pnlPct != null ? parseFloat(e.pnlPct.toFixed(2)) : null,
    maChecks: (e.maChecks ?? []).map(m => ({
      label: m.label, ok: m.ok,
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
    for (const { interval, limit } of specs) {
      const local = loadLocalCandles(symbol, interval);
      cMap[interval] = local ?? await fetchCandlesForExchange(exchange, symbol, interval, Math.max(limit, LIMIT));
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
  const exitSeries  = config.entryRsi.interval === config.exitRsi.interval &&
    config.entryRsi.period === config.exitRsi.period
    ? computeRsiSeries(entryCandles ?? scanCandles, config.entryRsi.period)
    : computeRsiSeries(exitCandles, config.exitRsi.period);

  const adaptiveDips = computeAdaptiveDips(cMap, config);
  const startCapital = Number(capital);

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

  const botOpts = {
    entryDiscount:    config.entryDiscount    ?? 0.001,
    immediateEntry:   config.immediateEntry   ?? false,
    pendingTimeoutMs: config.pendingTimeoutMs ?? 30 * 60_000,
    pendingCancelPct: config.pendingCancelPct ?? 0.002,
    pendingCancelOnExitRsi: config.pendingCancelOnExitRsi ?? true,
  };

  for (const pt of scanPoints) {
    const { openTime, close, entryRsi, maPathRsi, rsiCtx, maCtx } = pt;
    const exitRsi    = exitRsiAt(exitSeries, openTime);
    const maSnap     = maSnapAt(cMap, config, openTime);
    const stopLossMa = getStopLossMa(maSnap, config);

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

      entryLog.push({
        time: openTime, price: close, rsi: entryRsi,
        entryKind: diag.entryKind,
        maChecks: diag.maChecks, extension: diag.extension,
        outcome: entryCheck.allowed ? (botOpts.immediateEntry ? 'BOUGHT' : 'PENDING') : entryCheck.reason,
      });

      if (!entryCheck.allowed) {
        blockedCount++;
        signals.push({
          entryTime: openTime, entryRsi, entryPrice: close,
          entryKind: diag.entryKind, result: entryCheck.reason,
        });
        continue;
      }

      if (botOpts.immediateEntry) {
        openSignalIdx = signals.length;
        signals.push({
          entryTime: openTime, entryRsi, entryPrice: close, entryKind: entryCheck.entryKind,
          buyTime: openTime, buyPrice: close, result: 'BOUGHT',
        });
        buyQty = runningCapital / close; buyUsdt = runningCapital;
        phase = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi, entryKind: entryCheck.entryKind });
      } else {
        triggerPrice = close;
        limitPrice   = parseFloat((close * (1 - botOpts.entryDiscount)).toFixed(8));
        pendingSince = openTime;
        pendingSignal = {
          entryTime: openTime, entryRsi, entryPrice: close, entryKind: entryCheck.entryKind,
        };
        phase = 'PENDING';
      }

    } else if (phase === 'PENDING') {
      const elapsedMs  = openTime - pendingSince;
      const cancelLine = triggerPrice * (1 + botOpts.pendingCancelPct);
      const exitRsiHit = botOpts.pendingCancelOnExitRsi !== false && checkRsi(exitRsi, config.exitRsi);
      if (close > cancelLine || elapsedMs > botOpts.pendingTimeoutMs || exitRsiHit) {
        const reason = exitRsiHit ? 'CANCELLED_EXIT_RSI'
          : close > cancelLine ? 'CANCELLED_RECOVERY' : 'CANCELLED_TIMEOUT';
        if (pendingSignal) { signals.push({ ...pendingSignal, result: reason }); pendingSignal = null; }
        phase = 'WATCHING';
        triggerPrice = limitPrice = pendingSince = null;
      } else if (close <= limitPrice) {
        openSignalIdx = signals.length;
        signals.push({ ...pendingSignal, buyTime: openTime, buyPrice: close, result: 'BOUGHT' });
        pendingSignal = null;
        buyQty = runningCapital / close; buyUsdt = runningCapital;
        phase = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi });
        triggerPrice = limitPrice = pendingSince = null;
      }

    } else if (phase === 'BOUGHT') {
      const exitEval = evaluateExit({ close, exitRsi, stopLossMa, maSnap, adaptiveDips, config });
      if (exitEval.exit) {
        const usdtOut = buyQty * close;
        const pnl     = usdtOut - buyUsdt;
        runningCapital += pnl;
        if (openSignalIdx !== null) {
          signals[openSignalIdx].exitTime  = openTime;
          signals[openSignalIdx].exitPrice = close;
          signals[openSignalIdx].exitRsi   = exitRsi;
          signals[openSignalIdx].pnlPct    = (pnl / buyUsdt) * 100;
          if (exitEval.reason === 'stop_loss_ma') signals[openSignalIdx].result = 'STOP_LOSS_MA';
          else if (exitEval.reason === 'stop_loss_adaptive') signals[openSignalIdx].result = 'STOP_LOSS_ADAPTIVE';
          else if (exitEval.reason === 'rsi') signals[openSignalIdx].result = 'SOLD_RSI';
          openSignalIdx = null;
        }
        trades.push({
          type: 'SELL', time: openTime, price: close, exitRsi,
          exitReason: exitEval.reason,
          stopLoss: isStopLossExit(exitEval.reason),
          pnlUsdt: pnl, pnlPct: (pnl / buyUsdt) * 100, capitalAfter: runningCapital,
        });
        phase = 'WATCHING';
        buyQty = buyUsdt = null;
      }
    }
  }

  if (pendingSignal) signals.push({ ...pendingSignal, result: 'PENDING_OPEN' });
  if (phase === 'BOUGHT' && openSignalIdx !== null) signals[openSignalIdx].result = 'POSITION_OPEN';

  reconcileEntryLog(entryLog, signals);

  const sells    = trades.filter(t => t.type === 'SELL');
  const wins     = sells.filter(t => t.pnlUsdt >= 0).length;
  const totalPnl = sells.reduce((s, t) => s + t.pnlUsdt, 0);
  const period   = backtestPeriodLabel(entryCandles);

  return compactBacktestForApi({
    symbol: symbol.toUpperCase(),
    exchange,
    capital: startCapital,
    label: config.label ?? 'AMAP',
    command: `node backend/bot/amap/amap-bot.js --backtest ${symbol.toUpperCase()} ${exchange} ${startCapital}`,
    config: {
      entryRsi: config.entryRsi,
      exitRsi:  config.exitRsi,
      stopLoss: formatStopLossLabel(config),
    },
    period,
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
  loadLocalCandles,
  computeRsiSeries,
  exitRsiAt,
  maSnapAt,
};
