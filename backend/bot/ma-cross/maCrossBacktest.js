'use strict';

const path = require('path');
const fs = require('fs');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { compactBacktestForApi } = require('../amap/amapBacktest');
const { maLabel } = require('../../utils/movingAverage');
const { hasRecentCandleGaps } = require('../../utils/candleFreshness');
const {
  getRequiredSpecs,
  getFinestPollInterval,
  evaluateEntry,
  evaluatePullbackReady,
  pullbackEntryEnabled,
  evaluateExit,
  computeAdaptiveDips,
  computeAdaptiveStretches,
  checkMaCrossover,
  checkPriceFilter,
} = require('./strategyEngine');

function crossLabel(leg) {
  return maLabel(leg.period, leg.interval);
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
  ABOVE_ADAPTIVE_CEILING: 'Bloqueado — acima teto adaptativo',
  FILTER_NO_MA: 'Bloqueado — MA filtro indisponível',
  ABOVE_MA2_CAP: 'Bloqueado — acima teto MA2',
  NO_PULLBACK: 'Bloqueado — sem pullback',
  ENTRY_WINDOW_PASSED: 'Janela de pullback expirou',
  ENTRY_COOLDOWN: 'Cooldown entre entradas',
  PENDING_TIMEOUT: 'Timeout pending',
  PENDING: 'Aguardando pullback',
  MA_CROSS_EXIT: 'Saída cruzamento',
  STOP_LOSS: 'Stop loss',
  RSI_EXIT: 'Saída RSI',
  ENTRY_OFF: 'Entrada desligada',
  HTF_TREND_BELOW:    'Bloqueado — EMA9(1h) abaixo de EMA21(1h) (fora da tolerância)',
  HTF_TREND_NO_MA:    'Bloqueado — tendência 1h indisponível',
  HTF_TREND_NO_DATA:  'Bloqueado — dados 1h insuficientes',
  BB_FILTER_ABOVE:    'Bloqueado — %B acima do limite (BB)',
  BB_FILTER_NO_DATA:  'Bloqueado — sem dados BB',
};

function entryCooldownHours(config) {
  const h = Number(config?.entryCooldownHours);
  return Number.isFinite(h) && h > 0 ? h : 0;
}

function openBuy({
  close, openTime, signalTime, runningCapital, entryKindShort, entryLabel, mode,
}) {
  const entryPrice = close * (1 + FEE_RATE);
  return {
    position: {
      entryTime: openTime,
      signalTime: signalTime ?? openTime,
      entryPrice,
      qty: runningCapital / entryPrice,
      usdtIn: runningCapital,
      peakPrice: close,
      mode: mode ?? 'immediate',
    },
    signal: {
      entryTime: signalTime ?? openTime,
      entryPrice: close,
      buyTime: openTime,
      buyPrice: close,
      result: 'BOUGHT',
      mode: mode ?? 'immediate',
    },
    trade: { type: 'BUY', time: openTime, price: close },
    rowPatch: {
      buyTime: openTime,
      buyPrice: close,
      outcome: 'BOUGHT',
      entryKindShort,
      entryKindLabel: entryLabel,
    },
  };
}

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

/** Une disco + exchange por openTime (exchange preenche buracos sem perder histórico antigo). */
function mergeCandlesPreferRemote(local, remote) {
  const byTime = new Map();
  for (const c of local ?? []) byTime.set(Number(c.openTime), c);
  for (const c of remote ?? []) byTime.set(Number(c.openTime), normalizeCandle(c));
  return [...byTime.values()].sort((a, b) => a.openTime - b.openTime);
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

function buildMaChecks(config, cMap, adaptiveDips, close, adaptiveStretches = {}) {
  return activeMaFilters(config).map(f => {
    const label = `EMA${f.period} ${f.interval}`;
    const key = `${f.period}_${f.interval}`;
    const pf = checkPriceFilter(close, cMap[f.interval] ?? [], f, adaptiveDips[key], config.adaptiveOpts, adaptiveStretches[key]);
    let detail = 'OK';
    if (!pf.allowed) {
      if (pf.reason === 'FILTER_NO_MA') detail = 'sem dados';
      else if (pf.reason === 'BELOW_ADAPTIVE_FLOOR') detail = `abaixo piso adaptativo (−${pf.dipPct ?? '?'}%)`;
      else if (pf.reason === 'ABOVE_ADAPTIVE_CEILING') detail = `acima teto adaptativo (+${pf.abovePct ?? '?'}%)`;
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
      // Gaps no meio (ex.: AUDIOUSDT 12:00/12:15 faltando) fazem areConsecutiveCandles
      // pular o cruzamento — busca a exchange e mescla para preencher buracos.
      const hasGaps = candles?.length ? hasRecentCandleGaps(candles, interval, null) : false;
      const needsFetch = !candles?.length || candles.length < need || hasGaps;
      if (needsFetch) {
        const fetchLimit = Math.min(1000, Math.max(need, candles?.length ?? 0));
        const fetched = await fetchCandlesForExchange(exchange, symbol, interval, fetchLimit);
        candles = candles?.length
          ? mergeCandlesPreferRemote(candles, fetched)
          : fetched.map(normalizeCandle);
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
  let pending = null;
  let openSignalIdx = null;
  let openEntryLogIdx = null;
  let lastExitTime = null;
  const trades = [];
  const signals = [];
  const entryLog = [];
  let blockedCount = 0;

  const warmup = Math.max(30, (config.entry?.ma2?.period ?? 21) + 5);
  const evalOpts = { closedOnly: true };
  const entryLabel = formatEntryLabel(config);
  const dirShort = crossShort(config);
  const cooldownH = entryCooldownHours(config);
  const usePendingFallback = pullbackEntryEnabled(config) && config.execution?.immediateEntry !== true;
  const pendingTimeoutMs = Number(config.execution?.pendingTimeoutMs ?? 90 * 60_000);

  for (let i = warmup; i < scanCandles.length; i++) {
    const c = scanCandles[i];
    const cMapSlice = sliceCMap(cMap, c.openTime);
    const dips = computeAdaptiveDips(config, cMapSlice);
    const stretches = computeAdaptiveStretches(config, cMapSlice);

    // ── PENDING (pullback após cruzamento) ────────────────────────────────
    if (phase === 'PENDING' && pending) {
      if (pendingTimeoutMs > 0 && (c.openTime - pending.signalOpenTime) > pendingTimeoutMs) {
        if (openEntryLogIdx != null) {
          entryLog[openEntryLogIdx].outcome = 'PENDING_TIMEOUT';
        }
        signals.push({
          entryTime: pending.signalOpenTime,
          entryPrice: pending.signalClose,
          result: 'PENDING_TIMEOUT',
        });
        blockedCount++;
        pending = null;
        openEntryLogIdx = null;
        phase = 'WATCHING';
        continue;
      }

      const ready = evaluatePullbackReady(config, cMapSlice, dips, pending, stretches);
      if (ready.ready) {
        const buy = openBuy({
          close: ready.close,
          openTime: ready.entryOpenTime ?? c.openTime,
          signalTime: pending.signalOpenTime,
          runningCapital,
          entryKindShort: dirShort,
          entryLabel: `${entryLabel} (pullback)`,
          mode: 'pending',
        });
        position = buy.position;
        openSignalIdx = signals.length;
        signals.push(buy.signal);
        trades.push(buy.trade);
        if (openEntryLogIdx != null) {
          Object.assign(entryLog[openEntryLogIdx], buy.rowPatch, {
            price: ready.close,
            ma1: ready.ma1,
            ma2: ready.ma2,
          });
        }
        pending = null;
        openEntryLogIdx = null;
        phase = 'BOUGHT';
        continue;
      }

      if (ready.cancel) {
        const reason = ready.reason ?? 'NO_PULLBACK';
        if (openEntryLogIdx != null) {
          entryLog[openEntryLogIdx].outcome = reason;
          entryLog[openEntryLogIdx].exitDetail = OUTCOME_LABELS[reason] ?? reason;
        }
        signals.push({
          entryTime: pending.signalOpenTime,
          entryPrice: pending.signalClose,
          result: reason,
        });
        blockedCount++;
        pending = null;
        openEntryLogIdx = null;
        phase = 'WATCHING';
      }
      continue;
    }

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

      const maChecks = buildMaChecks(config, cMapSlice, dips, cross.close, stretches);
      const row = {
        time: c.openTime,
        price: cross.close,
        ma1: cross.ma1,
        ma2: cross.ma2,
        entryKind: 'ma_cross',
        entryKindShort: dirShort,
        entryKindLabel: entryLabel,
        maChecks,
        outcome: 'BOUGHT',
      };

      if (cooldownH > 0 && lastExitTime != null) {
        const elapsed = c.openTime - lastExitTime;
        if (elapsed < cooldownH * 3_600_000) {
          row.outcome = 'ENTRY_COOLDOWN';
          entryLog.push(row);
          blockedCount++;
          signals.push({
            entryTime: c.openTime,
            entryPrice: cross.close,
            result: 'ENTRY_COOLDOWN',
          });
          continue;
        }
      }

      const entryEval = evaluateEntry(config, cMapSlice, dips, {
        ...evalOpts,
        adaptiveStretches: stretches,
      });

      if (entryEval.allowed) {
        entryLog.push(row);
        const buy = openBuy({
          close: cross.close,
          openTime: c.openTime,
          signalTime: c.openTime,
          runningCapital,
          entryKindShort: dirShort,
          entryLabel,
          mode: 'immediate',
        });
        position = buy.position;
        openSignalIdx = signals.length;
        signals.push(buy.signal);
        trades.push(buy.trade);
        Object.assign(row, buy.rowPatch);
        phase = 'BOUGHT';
        continue;
      }

      // Híbrido (bot): se não comprou no cruzamento e pullback está ativo → PENDING
      if (usePendingFallback) {
        row.outcome = 'PENDING';
        entryLog.push(row);
        openEntryLogIdx = entryLog.length - 1;
        pending = {
          signalOpenTime: cross.openTime ?? c.openTime,
          signalClose: cross.close,
        };
        phase = 'PENDING';
        continue;
      }

      row.outcome = entryEval.reason ?? 'BLOCKED';
      entryLog.push(row);
      blockedCount++;
      signals.push({
        entryTime: c.openTime,
        entryPrice: cross.close,
        result: entryEval.reason,
      });
      continue;
    }

    if (phase === 'BOUGHT' && position) {
      const candleHigh = c.high != null ? parseFloat(c.high) : parseFloat(c.close);
      position.peakPrice = Math.max(position.peakPrice ?? position.entryPrice, candleHigh, parseFloat(c.close));
      const exit = evaluateExit(config, cMapSlice, position.entryPrice, {
        ...evalOpts,
        peakPrice: position.peakPrice,
      });
      if (!exit.exit) continue;

      const exitPrice = exit.close * (1 - FEE_RATE);
      const usdtOut = exitPrice * position.qty;
      const pnlPct = ((usdtOut - position.usdtIn) / position.usdtIn) * 100;
      runningCapital = usdtOut;
      lastExitTime = c.openTime;

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
  if (phase === 'PENDING' && openEntryLogIdx != null) {
    entryLog[openEntryLogIdx].outcome = 'PENDING';
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
      maxAboveMaPct: config.entry?.maxAboveMaPct ?? 3,
      pullback: usePendingFallback
        ? `até ${config.execution?.pullbackEntry?.waitCandles ?? 2} candles`
        : (config.execution?.immediateEntry ? 'off (só imediato)' : 'off'),
      cooldownHours: cooldownH || 'off',
      stopLoss: config.stopLoss?.enabled
        ? (config.stopLoss.trailing !== false
          ? `trailing −${config.stopLoss.maxLossPct}% / +${config.stopLoss.trailStepPct ?? config.stopLoss.maxLossPct}%`
          : `−${config.stopLoss.maxLossPct}%`)
        : 'off',
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
