'use strict';

const path = require('path');
const fs = require('fs');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { compactBacktestForApi } = require('../amap/amapBacktest');
const {
  getRequiredSpecs,
  getFinestPollInterval,
  evaluateEntry,
  evaluateExit,
  computeAdaptiveDips,
  checkMaCrossover,
  checkPriceFilter,
} = require('./strategyEngine');

function crossLabel(leg) {
  return `SMA${leg.period}(${leg.interval})`;
}

function activeMaFilters(config) {
  if (config.maFiltersEnabled === false) return [];
  return (config.maFilters ?? []).filter(f => f.enabled && f.mode !== 'off');
}

const FEE_RATE = 0.002;
const LIMIT = 500;

const OUTCOME_LABELS = {
  BOUGHT: 'Comprou',
  POSITION_OPEN: 'Posição aberta',
  NO_CROSS_UP: 'Sem cruzamento ↑',
  NO_CROSS_DOWN: 'Sem cruzamento ↓',
  NOT_ABOVE_MA: 'Bloqueado — abaixo MA filtro',
  NOT_BELOW_MA: 'Bloqueado — acima MA filtro',
  BELOW_ADAPTIVE_FLOOR: 'Bloqueado — abaixo piso adaptativo',
  FILTER_NO_MA: 'Bloqueado — MA filtro indisponível',
  MA_CROSS_EXIT: 'Saída cruzamento',
  STOP_LOSS: 'Stop loss',
  RSI_EXIT: 'Saída RSI',
  ENTRY_OFF: 'Entrada desligada',
};

function loadLocalCandles(symbol, interval) {
  try {
    const filePath = path.join(__dirname, '../../data/candlestick', `${symbol}-${interval}.json`);
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map(normalizeCandle) : [];
  } catch {
    return [];
  }
}

function normalizeCandle(c) {
  return {
    openTime: Number(c.openTime),
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
  };
}

async function fetchCandlesForExchange(exchange, symbol, interval, limit) {
  const need = Math.min(limit, 1000);
  if (exchange === 'gate') {
    return fetchGateCandles(toGateSymbol(symbol), need, interval);
  }
  return fetchBinanceCandles(symbol, need, interval);
}

function sliceCMap(fullMap, openTime) {
  const out = {};
  for (const [iv, candles] of Object.entries(fullMap)) {
    out[iv] = candles.filter(c => c.openTime <= openTime);
  }
  return out;
}

function formatEntryLabel(config) {
  const e = config.entry ?? {};
  const dir = e.direction === 'cross_down' ? '↓' : '↑';
  return `${crossLabel(e.ma1 ?? { period: 9, interval: '15m' })} cruza ${dir} ${crossLabel(e.ma2 ?? { period: 21, interval: '15m' })}`;
}

function formatExitLabel(config) {
  const ex = config.exit?.maCross;
  if (!ex?.enabled) return '—';
  const dir = ex.direction === 'cross_up' ? '↑' : '↓';
  return `${crossLabel(ex.ma1)} cruza ${dir} ${crossLabel(ex.ma2)}`;
}

function buildMaChecks(config, cMap, adaptiveDips, close) {
  return activeMaFilters(config).map(f => {
    const label = `SMA${f.period} ${f.interval}`;
    const key = `${f.period}_${f.interval}`;
    const pf = checkPriceFilter(close, cMap[f.interval] ?? [], f, adaptiveDips[key], config.adaptiveOpts);
    let detail = 'OK';
    if (!pf.allowed) {
      if (pf.reason === 'FILTER_NO_MA') detail = 'sem dados';
      else if (pf.reason === 'BELOW_ADAPTIVE_FLOOR') detail = `abaixo piso adaptativo (−${pf.dipPct ?? '?'}%)`;
      else if (pf.reason === 'NOT_ABOVE_MA') detail = 'preço abaixo da MA';
      else if (pf.reason === 'NOT_BELOW_MA') detail = 'preço acima da MA';
      else detail = pf.reason ?? 'bloqueado';
    }
    return { label, ok: pf.allowed, mode: f.mode ?? null, detail };
  });
}

function crossShort(config) {
  const dir = config.entry?.direction === 'cross_down' ? '↓' : '↑';
  const e = config.entry ?? {};
  return `X${dir}`;
}

function backtestPeriodLabel(candles, interval) {
  if (!candles?.length) return null;
  const first = candles[0].openTime;
  const last = candles[candles.length - 1].openTime;
  const days = Math.max(1, Math.round((last - first) / 86_400_000));
  return {
    interval,
    count: candles.length,
    daysLbl: `${days}d`,
    from: new Date(first).toISOString(),
    to: new Date(last).toISOString(),
  };
}

function serializeMaCrossRow(e) {
  const outcomeLabel = OUTCOME_LABELS[e.outcome] ?? e.outcome ?? '—';
  const failed = (e.maChecks ?? []).find(m => !m.ok);
  return {
    time: e.time,
    timeISO: new Date(e.time).toISOString(),
    buyTime: e.buyTime ?? null,
    buyTimeISO: e.buyTime ? new Date(e.buyTime).toISOString() : null,
    buyPrice: e.buyPrice ?? null,
    exitTime: e.exitTime ?? null,
    exitTimeISO: e.exitTime ? new Date(e.exitTime).toISOString() : null,
    exitPrice: e.exitPrice ?? null,
    price: e.price,
    ma1: e.ma1 != null ? parseFloat(Number(e.ma1).toFixed(6)) : null,
    ma2: e.ma2 != null ? parseFloat(Number(e.ma2).toFixed(6)) : null,
    entryKind: 'ma_cross',
    entryKindShort: e.entryKindShort ?? 'X↑',
    entryKindLabel: e.entryKindLabel ?? null,
    outcome: e.outcome,
    outcomeLabel,
    outcomeShort: failed?.detail ?? outcomeLabel,
    outcomeDetail: e.exitDetail ?? failed?.detail ?? null,
    pnlPct: e.pnlPct != null ? parseFloat(Number(e.pnlPct).toFixed(2)) : null,
    maChecks: e.maChecks ?? [],
    exitDetail: e.exitDetail ?? null,
  };
}

function reconcileEntryLog(entryLog, signals) {
  const byTime = new Map(entryLog.map(e => [e.time, e]));
  for (const sig of signals) {
    const row = byTime.get(sig.entryTime);
    if (!row) continue;
    row.outcome = sig.result;
    if (sig.pnlPct != null) row.pnlPct = sig.pnlPct;
    if (sig.exitDetail) row.exitDetail = sig.exitDetail;
    if (sig.buyTime) row.buyTime = sig.buyTime;
    if (sig.buyPrice != null) row.buyPrice = sig.buyPrice;
    if (sig.exitTime) row.exitTime = sig.exitTime;
    if (sig.exitPrice != null) row.exitPrice = sig.exitPrice;
  }
}

async function runMaCrossBacktest({ symbol, config, exchange = 'binance', capital = 100, cMap: cMapIn }) {
  const specs = getRequiredSpecs(config);
  const cMap = cMapIn ?? {};

  if (!cMapIn) {
    for (const { interval, limit } of specs) {
      const need = Math.max(limit, LIMIT);
      let candles = loadLocalCandles(symbol, interval);
      if (!candles?.length || candles.length < need) {
        const fetched = await fetchCandlesForExchange(exchange, symbol, interval, need);
        if (!candles?.length || fetched.length > candles.length) candles = fetched.map(normalizeCandle);
      }
      cMap[interval] = candles;
    }
  }

  const scanIv = getFinestPollInterval(config);
  const scanCandles = cMap[scanIv] ?? [];
  if (!scanCandles?.length) {
    return { error: 'sem candles de entrada', symbol, exchange, capital };
  }

  const startCapital = Number(capital);
  let runningCapital = startCapital;
  let phase = 'WATCHING';
  let position = null;
  let openSignalIdx = null;
  const trades = [];
  const signals = [];
  const entryLog = [];
  let blockedCount = 0;

  const warmup = Math.max(30, (config.entry?.ma2?.period ?? 21) + 5);
  const evalOpts = { closedOnly: true };
  const entryLabel = formatEntryLabel(config);
  const dirShort = crossShort(config);

  for (let i = warmup; i < scanCandles.length; i++) {
    const c = scanCandles[i];
    const cMapSlice = sliceCMap(cMap, c.openTime);
    const dips = computeAdaptiveDips(config, cMapSlice);

    if (phase === 'WATCHING') {
      const entry = config.entry ?? {};
      const cross = checkMaCrossover({
        candles1: cMapSlice[entry.ma1?.interval ?? scanIv] ?? [],
        period1: entry.ma1?.period ?? 9,
        interval1: entry.ma1?.interval ?? scanIv,
        candles2: cMapSlice[entry.ma2?.interval ?? scanIv] ?? [],
        period2: entry.ma2?.period ?? 21,
        interval2: entry.ma2?.interval ?? scanIv,
        direction: entry.direction ?? 'cross_up',
        tolerancePct: entry.tolerancePct ?? 0,
        closedOnly: true,
      });

      if (!cross.crossed) continue;

      const entryEval = evaluateEntry(config, cMapSlice, dips, evalOpts);
      const maChecks = buildMaChecks(config, cMapSlice, dips, cross.close);
      const row = {
        time: c.openTime,
        price: cross.close,
        ma1: cross.ma1,
        ma2: cross.ma2,
        entryKind: 'ma_cross',
        entryKindShort: dirShort,
        entryKindLabel: entryLabel,
        maChecks,
        outcome: entryEval.allowed ? 'BOUGHT' : (entryEval.reason ?? 'BLOCKED'),
      };
      entryLog.push(row);

      if (!entryEval.allowed) {
        blockedCount++;
        signals.push({
          entryTime: c.openTime,
          entryPrice: cross.close,
          result: entryEval.reason,
        });
        continue;
      }

      const entryPrice = cross.close * (1 + FEE_RATE);
      position = {
        entryTime: c.openTime,
        entryPrice,
        qty: runningCapital / entryPrice,
        usdtIn: runningCapital,
      };
      openSignalIdx = signals.length;
      signals.push({
        entryTime: c.openTime,
        entryPrice: cross.close,
        buyTime: c.openTime,
        buyPrice: cross.close,
        result: 'BOUGHT',
      });
      trades.push({ type: 'BUY', time: c.openTime, price: cross.close });
      phase = 'BOUGHT';
    } else if (phase === 'BOUGHT' && position) {
      const exit = evaluateExit(config, cMapSlice, position.entryPrice, evalOpts);
      if (!exit.exit) continue;

      const exitPrice = exit.close * (1 - FEE_RATE);
      const usdtOut = exitPrice * position.qty;
      const pnlPct = ((usdtOut - position.usdtIn) / position.usdtIn) * 100;
      runningCapital = usdtOut;

      const exitDetail = exit.exitDesc ?? OUTCOME_LABELS[exit.reason] ?? exit.reason;
      if (openSignalIdx != null) {
        signals[openSignalIdx].exitTime = c.openTime;
        signals[openSignalIdx].exitPrice = exit.close;
        signals[openSignalIdx].pnlPct = pnlPct;
        signals[openSignalIdx].exitDetail = exitDetail;
        signals[openSignalIdx].result = exit.reason === 'STOP_LOSS' ? 'STOP_LOSS' : 'MA_CROSS_EXIT';
      }

      trades.push({
        type: 'SELL',
        time: c.openTime,
        price: exit.close,
        exitReason: exit.reason,
        pnlUsdt: usdtOut - position.usdtIn,
        pnlPct,
        capitalAfter: runningCapital,
      });

      position = null;
      phase = 'WATCHING';
      openSignalIdx = null;
    }
  }

  if (phase === 'BOUGHT' && openSignalIdx != null) {
    signals[openSignalIdx].result = 'POSITION_OPEN';
  }

  reconcileEntryLog(entryLog, signals);

  const sells = trades.filter(t => t.type === 'SELL');
  const wins = sells.filter(t => t.pnlUsdt >= 0).length;
  const totalPnl = sells.reduce((s, t) => s + (t.pnlUsdt ?? 0), 0);
  const period = backtestPeriodLabel(scanCandles, scanIv);

  return compactBacktestForApi({
    symbol: symbol.toUpperCase(),
    exchange,
    capital: startCapital,
    label: config.label ?? 'MA Cross',
    strategyKind: 'ma_cross',
    command: `node backend/bot/ma-cross/backtest-ma-cross.js ${symbol.toUpperCase()} ${exchange} ${startCapital}`,
    config: {
      entryPaths: entryLabel,
      exitCross: formatExitLabel(config),
      stopLoss: config.stopLoss?.enabled ? `−${config.stopLoss.maxLossPct}%` : 'off',
    },
    period,
    maFilterStats: [],
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
      stopMaCount: 0,
      stopAdaptCount: 0,
      entrySignals: entryLog.length,
      crossSignals: entryLog.length,
    },
    entryLog: entryLog.map(serializeMaCrossRow),
    trades: trades.map(t => ({
      type: t.type,
      time: t.time,
      timeISO: new Date(t.time).toISOString(),
      price: t.price,
      exitReason: t.exitReason ?? null,
      pnlUsdt: t.pnlUsdt != null ? parseFloat(t.pnlUsdt.toFixed(2)) : null,
      pnlPct: t.pnlPct != null ? parseFloat(t.pnlPct.toFixed(2)) : null,
      capitalAfter: t.capitalAfter ?? null,
    })),
  });
}

module.exports = {
  runMaCrossBacktest,
  formatEntryLabel,
  formatExitLabel,
};
