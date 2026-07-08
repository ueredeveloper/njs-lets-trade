'use strict';
/**
 * Simula MA9/21 30m (entrada cross_up + saída cross_down) desde 06/07/2026
 * nos símbolos com trades ma-cross reais, e compara PnL.
 *
 * Uso: node backend/bot/ma-cross/analyze-30m-vs-15m.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { normalizeMaCrossConfig, toEngineConfig } = require('./tradeConfigSchema');
const {
  checkMaCrossover, evaluateExit, computeAdaptiveDips, evaluateEntry,
  getFinestPollInterval,
} = require('./strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM_ARG = process.argv[2]; // opcional: ISO date ou 'all'
const FROM_MS = !FROM_ARG || FROM_ARG === 'all'
  ? 0
  : Date.parse(FROM_ARG.includes('T') ? FROM_ARG : `${FROM_ARG}T00:00:00-03:00`);
const FEE = 0.002;
const CAPITAL = 40;

const CFG_30M = toEngineConfig(normalizeMaCrossConfig({
  entry: {
    ma1: { period: 9, interval: '30m' },
    ma2: { period: 21, interval: '30m' },
    direction: 'cross_up',
    tolerancePct: 0.1,
    maxAboveMaPct: 0,
  },
  maFiltersEnabled: false,
  maFilters: [],
  execution: { pullbackEntry: { enabled: false, waitCandles: 2, requirePullback: false } },
  exit: {
    logic: 'any',
    maCross: {
      enabled: true,
      ma1: { period: 9, interval: '30m' },
      ma2: { period: 21, interval: '30m' },
      direction: 'cross_down',
      tolerancePct: 0.1,
    },
    rsi: { enabled: false, conditions: [] },
  },
  stopLoss: { enabled: false },
}));

const CFG_30M_FILTERED = toEngineConfig(normalizeMaCrossConfig({
  entry: {
    ma1: { period: 9, interval: '30m' },
    ma2: { period: 21, interval: '30m' },
    direction: 'cross_up',
    tolerancePct: 0.1,
    maxAboveMaPct: 3,
  },
  maFiltersEnabled: true,
  maFilters: [{
    id: 1, enabled: true, period: 50, interval: '1h',
    mode: 'adaptive', maxDipPct: 4, maxAbovePct: 4,
  }],
  execution: { pullbackEntry: { enabled: true, waitCandles: 2, requirePullback: true } },
  exit: {
    logic: 'any',
    maCross: {
      enabled: true,
      ma1: { period: 9, interval: '30m' },
      ma2: { period: 21, interval: '30m' },
      direction: 'cross_down',
      tolerancePct: 0.1,
    },
    rsi: { enabled: false, conditions: [] },
  },
  stopLoss: { enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5 },
}));

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${table}: ${await res.text()}`);
  return res.json();
}

async function fetchBinanceRange(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      const t = Number(c[0]);
      if (t > endMs) break;
      out.push({ openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4] });
    }
    const last = raw[raw.length - 1][0];
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

async function fetchGateRange(symbol, interval, startMs, endMs) {
  const pair = toGateSymbol(symbol);
  const from = Math.floor(startMs / 1000);
  const to = Math.floor(endMs / 1000);
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
  const raw = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    openTime: Number(c[0]) * 1000,
    open: +c[5], high: +c[3], low: +c[4], close: +c[2],
  }));
}

function sliceCMap(cMap, openTime) {
  const out = {};
  for (const [iv, arr] of Object.entries(cMap)) {
    out[iv] = arr.filter(c => c.openTime <= openTime);
  }
  return out;
}

function fmt(ts) {
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
}

/**
 * Pure cross 30m: enter on cross_up of closed candle, exit on cross_down.
 * One position at a time. Window: FROM_MS → now.
 */
function simulatePure30m(c30, fromMs, toMs) {
  const trades = [];
  let position = null;
  const warmup = 25;

  for (let i = warmup; i < c30.length; i++) {
    const c = c30[i];
    if (c.openTime < fromMs || c.openTime > toMs) continue;

    const slice = c30.slice(0, i + 1);
    const cross = checkMaCrossover({
      candles1: slice, period1: 9, interval1: '30m',
      candles2: slice, period2: 21, interval2: '30m',
      direction: position ? 'cross_down' : 'cross_up',
      tolerancePct: 0.1,
      closedOnly: true,
    });

    if (!position) {
      if (!cross.crossed) continue;
      position = {
        entryTime: c.openTime,
        entryPrice: c.close,
        entryClose: c.close,
      };
      continue;
    }

    // in position — look for cross_down
    const down = checkMaCrossover({
      candles1: slice, period1: 9, interval1: '30m',
      candles2: slice, period2: 21, interval2: '30m',
      direction: 'cross_down',
      tolerancePct: 0.1,
      closedOnly: true,
    });
    if (!down.crossed) continue;

    const buyNet = position.entryPrice * (1 + FEE);
    const sellNet = c.close * (1 - FEE);
    const pnlPct = ((sellNet - buyNet) / buyNet) * 100;
    const pnlUsdt = (pnlPct / 100) * CAPITAL;
    trades.push({
      entryTime: position.entryTime,
      exitTime: c.openTime,
      entryPrice: position.entryPrice,
      exitPrice: c.close,
      pnlPct,
      pnlUsdt,
      open: false,
    });
    position = null;
  }

  if (position) {
    const last = c30[c30.length - 1];
    const buyNet = position.entryPrice * (1 + FEE);
    const mark = last.close * (1 - FEE);
    const pnlPct = ((mark - buyNet) / buyNet) * 100;
    trades.push({
      entryTime: position.entryTime,
      exitTime: null,
      entryPrice: position.entryPrice,
      exitPrice: last.close,
      pnlPct,
      pnlUsdt: (pnlPct / 100) * CAPITAL,
      open: true,
    });
  }
  return trades;
}

/**
 * Filtered 30m with pullback + MA50 1h + stop (same style as current bot, but 30m cross).
 */
function simulateFiltered30m(cMap, config, fromMs, toMs) {
  const scanIv = '30m';
  const candles = cMap[scanIv] ?? [];
  const trades = [];
  let position = null;
  let pending = null;
  const warmup = 25;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i];
    if (c.openTime > toMs) break;
    const slice = sliceCMap(cMap, c.openTime);

    if (position) {
      const peak = Math.max(position.peak, c.high ?? c.close, c.close);
      position.peak = peak;
      const buyNet = position.entryPrice * (1 + FEE);
      const exit = evaluateExit(config, slice, buyNet, { peakPrice: peak, closedOnly: true });
      if (exit.exit && c.openTime >= fromMs) {
        const sellNet = exit.close * (1 - FEE);
        const pnlPct = ((sellNet - buyNet) / buyNet) * 100;
        trades.push({
          entryTime: position.entryTime,
          exitTime: c.openTime,
          entryPrice: position.entryPrice,
          exitPrice: exit.close,
          pnlPct,
          pnlUsdt: (pnlPct / 100) * CAPITAL,
          reason: exit.reason,
          open: false,
        });
        position = null;
        pending = null;
      }
      continue;
    }

    if (c.openTime < fromMs) continue;

    const dips = computeAdaptiveDips(config, slice);
    if (pending) {
      const { evaluatePullbackReady } = require('./strategyEngine');
      const ready = evaluatePullbackReady(config, slice, dips, pending);
      if (ready.ready) {
        position = { entryTime: c.openTime, entryPrice: ready.close, peak: ready.close };
        pending = null;
      } else if (ready.reason === 'PENDING_EXPIRED' || ready.reason === 'CROSS_INVALIDATED') {
        pending = null;
      }
      continue;
    }

    const entry = evaluateEntry(config, slice, dips, { closedOnly: true });
    if (entry.allowed) {
      // immediate if no pullback required path — with pullback, evaluateEntry may still fire
      position = { entryTime: c.openTime, entryPrice: entry.close, peak: entry.close };
    } else if (entry.reason === 'PULLBACK_PENDING' || config.execution?.pullbackEntry?.enabled) {
      const cross = checkMaCrossover({
        candles1: slice['30m'], period1: 9, interval1: '30m',
        candles2: slice['30m'], period2: 21, interval2: '30m',
        direction: 'cross_up', tolerancePct: 0.1, closedOnly: true,
      });
      if (cross.crossed) {
        pending = {
          signalOpenTime: cross.openTime ?? c.openTime,
          signalClose: cross.close,
        };
      }
    }
  }

  if (position) {
    const last = candles[candles.length - 1];
    const buyNet = position.entryPrice * (1 + FEE);
    const mark = last.close * (1 - FEE);
    const pnlPct = ((mark - buyNet) / buyNet) * 100;
    trades.push({
      entryTime: position.entryTime,
      exitTime: null,
      entryPrice: position.entryPrice,
      exitPrice: last.close,
      pnlPct,
      pnlUsdt: (pnlPct / 100) * CAPITAL,
      open: true,
    });
  }
  return trades;
}

function summarize(label, trades) {
  const closed = trades.filter(t => !t.open);
  const open = trades.filter(t => t.open);
  const pnl = trades.reduce((s, t) => s + t.pnlUsdt, 0);
  const wins = trades.filter(t => t.pnlUsdt >= 0).length;
  return { label, n: trades.length, closed: closed.length, open: open.length, wins, losses: trades.length - wins, pnl };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const toMs = Date.now();
  const tradesQuery = FROM_MS > 0
    ? `?strategy_id=eq.ma-cross&entry_time=gte.${new Date(FROM_MS).toISOString()}&order=entry_time.asc`
    : '?strategy_id=eq.ma-cross&order=entry_time.asc';
  const trades = await sbGet('rsi_multi_bot_trades', tradesQuery);
  const closed = trades.filter(t => t.exit_time && t.pnl_usdt != null);
  const openReal = trades.filter(t => !t.exit_time);

  const realFirst = closed.length
    ? Math.min(...closed.map(t => new Date(t.entry_time).getTime()))
    : toMs;
  const simFrom = FROM_MS > 0 ? FROM_MS : realFirst;

  console.log(`Período: ${FROM_MS > 0 ? fmt(FROM_MS) : fmt(realFirst)} → agora (${fmt(toMs)})`);
  console.log(`Trades reais ma-cross: ${trades.length} (${closed.length} fechados, ${openReal.length} abertos)\n`);

  const bySym = new Map();
  for (const t of trades) {
    const k = `${t.exchange ?? 'binance'}:${t.symbol}`;
    if (!bySym.has(k)) bySym.set(k, []);
    bySym.get(k).push(t);
  }

  const pad = 12 * 86_400_000; // warmup MA21 30m + buffer
  const allPure = [];
  const allFiltered = [];
  const realRows = [];

  for (const [key, symTrades] of bySym) {
    const [exchange, symbol] = key.split(':');
    const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
    const times = symTrades.flatMap(t => [
      new Date(t.entry_time).getTime(),
      t.exit_time ? new Date(t.exit_time).getTime() : toMs,
    ]);
    const symStart = Math.min(simFrom, ...times);
    process.stderr.write(`  ${symbol}...`);
    const [c30, c1h] = await Promise.all([
      fetcher(symbol, '30m', symStart - pad, toMs),
      fetcher(symbol, '1h', symStart - pad, toMs),
    ]);
    const pure = simulatePure30m(c30, simFrom, toMs).map(t => ({ ...t, symbol, exchange }));
    const filtered = simulateFiltered30m({ '30m': c30, '1h': c1h }, CFG_30M_FILTERED, simFrom, toMs)
      .map(t => ({ ...t, symbol, exchange }));
    allPure.push(...pure);
    allFiltered.push(...filtered);

    const realClosed = symTrades.filter(t => t.exit_time && t.pnl_usdt != null);
    const realPnl = realClosed.reduce((s, t) => s + (+t.pnl_usdt), 0);
    realRows.push({
      symbol,
      realN: realClosed.length,
      realPnl,
      pureN: pure.length,
      purePnl: pure.reduce((s, t) => s + t.pnlUsdt, 0),
      filtN: filtered.length,
      filtPnl: filtered.reduce((s, t) => s + t.pnlUsdt, 0),
    });
    process.stderr.write(` puro=${pure.length} filt=${filtered.length} real=${realClosed.length}\n`);
  }

  const realPnl = closed.reduce((s, t) => s + (+t.pnl_usdt), 0);
  const sPure = summarize('MA9/21 30m puro (sem filtro)', allPure);
  const sFilt = summarize('MA9/21 30m + MA50 1h + pullback + stop', allFiltered);

  console.log('\n=== Comparativo (capital $40 / trade, fee 0.2% ida+volta) ===\n');
  console.log('Cenário'.padEnd(48), 'Trades', 'Wins', 'PnL USDT');
  console.log('-'.repeat(72));
  console.log(
    'Real 15m (histórico bot)'.padEnd(48),
    String(closed.length).padStart(6),
    String(closed.filter(t => +t.pnl_usdt >= 0).length).padStart(5),
    realPnl.toFixed(2).padStart(10),
  );
  console.log(
    sPure.label.padEnd(48),
    String(sPure.n).padStart(6),
    String(sPure.wins).padStart(5),
    sPure.pnl.toFixed(2).padStart(10),
  );
  console.log(
    sFilt.label.padEnd(48),
    String(sFilt.n).padStart(6),
    String(sFilt.wins).padStart(5),
    sFilt.pnl.toFixed(2).padStart(10),
  );

  console.log('\n=== Por símbolo ===');
  console.log('Symbol'.padEnd(12), 'Real n/PnL'.padEnd(16), '30m puro'.padEnd(16), '30m+filtros');
  for (const r of realRows.sort((a, b) => b.purePnl - a.purePnl)) {
    console.log(
      r.symbol.padEnd(12),
      `${r.realN}/${r.realPnl.toFixed(2)}`.padEnd(16),
      `${r.pureN}/${r.purePnl.toFixed(2)}`.padEnd(16),
      `${r.filtN}/${r.filtPnl.toFixed(2)}`,
    );
  }

  const showDetail = allPure.length <= 60;
  if (showDetail) {
    console.log('\n=== Trades simulados 30m PURO (detalhe) ===');
    for (const t of allPure.sort((a, b) => a.entryTime - b.entryTime)) {
      const pnl = `${t.pnlUsdt >= 0 ? '+' : ''}${t.pnlUsdt.toFixed(2)} (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%)`;
      const status = t.open ? 'ABERTO' : 'fechado';
      console.log(
        `  ${t.symbol.padEnd(12)} ${fmt(t.entryTime)} → ${t.exitTime ? fmt(t.exitTime) : 'agora'}  ${pnl.padStart(20)}  ${status}`,
      );
    }
  } else {
    const best = [...allPure].sort((a, b) => b.pnlUsdt - a.pnlUsdt).slice(0, 8);
    const worst = [...allPure].sort((a, b) => a.pnlUsdt - b.pnlUsdt).slice(0, 8);
    console.log('\n=== Top 8 melhores 30m PURO ===');
    for (const t of best) {
      console.log(`  ${t.symbol.padEnd(12)} ${fmt(t.entryTime)}  ${(t.pnlUsdt >= 0 ? '+' : '') + t.pnlUsdt.toFixed(2)} (${(t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(2)}%)${t.open ? ' ABERTO' : ''}`);
    }
    console.log('\n=== Top 8 piores 30m PURO ===');
    for (const t of worst) {
      console.log(`  ${t.symbol.padEnd(12)} ${fmt(t.entryTime)}  ${(t.pnlUsdt >= 0 ? '+' : '') + t.pnlUsdt.toFixed(2)} (${(t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(2)}%)${t.open ? ' ABERTO' : ''}`);
    }
  }

  if (allFiltered.length && allFiltered.length <= 60) {
    console.log('\n=== Trades simulados 30m + filtros (detalhe) ===');
    for (const t of allFiltered.sort((a, b) => a.entryTime - b.entryTime)) {
      const pnl = `${t.pnlUsdt >= 0 ? '+' : ''}${t.pnlUsdt.toFixed(2)} (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%)`;
      console.log(
        `  ${t.symbol.padEnd(12)} ${fmt(t.entryTime)} → ${t.exitTime ? fmt(t.exitTime) : 'agora'}  ${pnl.padStart(20)}  ${t.open ? 'ABERTO' : (t.reason || '')}`,
      );
    }
  }

  console.log('\n--- Delta vs real ---');
  console.log(`  30m puro vs real:     ${(sPure.pnl - realPnl >= 0 ? '+' : '')}${(sPure.pnl - realPnl).toFixed(2)} USDT`);
  console.log(`  30m+filtros vs real:  ${(sFilt.pnl - realPnl >= 0 ? '+' : '')}${(sFilt.pnl - realPnl).toFixed(2)} USDT`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
