'use strict';
/**
 * Simula entrada MA9/21 15m + saída MA9/21 30m desde uma data,
 * nas moedas com trades ma-cross reais no período.
 *
 * Uso: node backend/bot/ma-cross/analyze-15m-exit-30m.js
 *      node backend/bot/ma-cross/analyze-15m-exit-30m.js 2026-07-06
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { normalizeMaCrossConfig, toEngineConfig } = require('./tradeConfigSchema');
const {
  checkMaCrossover,
  evaluateExit,
  evaluateEntry,
  evaluatePullbackReady,
  computeAdaptiveDips,
  getFinestPollInterval,
} = require('./strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM_ARG = process.argv[2] ?? '2026-07-06';
const FROM_MS = FROM_ARG === 'all'
  ? 0
  : Date.parse(FROM_ARG.includes('T') ? FROM_ARG : `${FROM_ARG}T00:00:00-03:00`);
const FEE = 0.002;
const CAPITAL = 40;

function buildConfig(exitInterval) {
  return toEngineConfig(normalizeMaCrossConfig({
    entry: {
      ma1: { period: 9, interval: '15m' },
      ma2: { period: 21, interval: '15m' },
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
        ma1: { period: 9, interval: exitInterval },
        ma2: { period: 21, interval: exitInterval },
        direction: 'cross_down',
        tolerancePct: 0.1,
      },
      rsi: { enabled: false, conditions: [] },
    },
    stopLoss: { enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5 },
  }));
}

const CFG_15_30 = buildConfig('30m');
const CFG_15_15 = buildConfig('15m');

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
 * Entrada 15m (pullback + filtros) + saída conforme config (15m ou 30m).
 * Scan no intervalo mais fino (15m).
 */
function simulateHybrid(cMap, config, fromMs, toMs) {
  const scanIv = getFinestPollInterval(config);
  const candles = cMap[scanIv] ?? [];
  const trades = [];
  let position = null;
  let pending = null;
  const warmup = 30;

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
      position = { entryTime: c.openTime, entryPrice: entry.close, peak: entry.close };
    } else if (entry.reason === 'PULLBACK_PENDING' || config.execution?.pullbackEntry?.enabled) {
      const cross = checkMaCrossover({
        candles1: slice['15m'], period1: 9, interval1: '15m',
        candles2: slice['15m'], period2: 21, interval2: '15m',
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
  const pnl = trades.reduce((s, t) => s + t.pnlUsdt, 0);
  const wins = trades.filter(t => t.pnlUsdt >= 0).length;
  const closed = trades.filter(t => !t.open);
  return { label, n: trades.length, closed: closed.length, open: trades.length - closed.length, wins, losses: trades.length - wins, pnl };
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

  console.log(`\n🔬 MA Cross — entrada 15m / saída 30m`);
  console.log(`Período: ${FROM_MS > 0 ? fmt(FROM_MS) : fmt(realFirst)} → agora (${fmt(toMs)})`);
  console.log(`Regras: pullback + MA50(1h) adaptativo + stop trailing 5%`);
  console.log(`Trades reais ma-cross: ${trades.length} (${closed.length} fechados, ${openReal.length} abertos)\n`);

  const bySym = new Map();
  for (const t of trades) {
    const k = `${t.exchange ?? 'binance'}:${t.symbol}`;
    if (!bySym.has(k)) bySym.set(k, []);
    bySym.get(k).push(t);
  }

  const pad = 12 * 86_400_000;
  const all1530 = [];
  const all1515 = [];
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
    const [c15, c30, c1h] = await Promise.all([
      fetcher(symbol, '15m', symStart - pad, toMs),
      fetcher(symbol, '30m', symStart - pad, toMs),
      fetcher(symbol, '1h', symStart - pad, toMs),
    ]);
    const cMap = { '15m': c15, '30m': c30, '1h': c1h };
    const sim1530 = simulateHybrid(cMap, CFG_15_30, simFrom, toMs).map(t => ({ ...t, symbol, exchange }));
    const sim1515 = simulateHybrid(cMap, CFG_15_15, simFrom, toMs).map(t => ({ ...t, symbol, exchange }));
    all1530.push(...sim1530);
    all1515.push(...sim1515);

    const realClosed = symTrades.filter(t => t.exit_time && t.pnl_usdt != null);
    const realPnl = realClosed.reduce((s, t) => s + (+t.pnl_usdt), 0);
    realRows.push({
      symbol,
      realN: realClosed.length,
      realPnl,
      sim1530N: sim1530.length,
      sim1530Pnl: sim1530.reduce((s, t) => s + t.pnlUsdt, 0),
      sim1515N: sim1515.length,
      sim1515Pnl: sim1515.reduce((s, t) => s + t.pnlUsdt, 0),
    });
    process.stderr.write(` 15→30=${sim1530.length} 15→15=${sim1515.length} real=${realClosed.length}\n`);
  }

  const realPnl = closed.reduce((s, t) => s + (+t.pnl_usdt), 0);
  const s1530 = summarize('Sim 15m entrada → 30m saída', all1530);
  const s1515 = summarize('Sim 15m entrada → 15m saída (baseline)', all1515);

  console.log('\n=== Comparativo (capital $40 / trade, fee 0.2% ida+volta) ===\n');
  console.log('Cenário'.padEnd(48), 'Trades', 'Wins', 'PnL USDT');
  console.log('-'.repeat(72));
  console.log(
    'Real 15m→15m (histórico bot)'.padEnd(48),
    String(closed.length).padStart(6),
    String(closed.filter(t => +t.pnl_usdt >= 0).length).padStart(5),
    realPnl.toFixed(2).padStart(10),
  );
  console.log(
    s1515.label.padEnd(48),
    String(s1515.n).padStart(6),
    String(s1515.wins).padStart(5),
    s1515.pnl.toFixed(2).padStart(10),
  );
  console.log(
    s1530.label.padEnd(48),
    String(s1530.n).padStart(6),
    String(s1530.wins).padStart(5),
    s1530.pnl.toFixed(2).padStart(10),
  );

  console.log('\n=== Por símbolo ===');
  console.log('Symbol'.padEnd(12), 'Real n/PnL'.padEnd(16), 'Sim 15→15'.padEnd(16), 'Sim 15→30');
  for (const r of realRows.sort((a, b) => b.sim1530Pnl - a.sim1530Pnl)) {
    console.log(
      r.symbol.padEnd(12),
      `${r.realN}/${r.realPnl.toFixed(2)}`.padEnd(16),
      `${r.sim1515N}/${r.sim1515Pnl.toFixed(2)}`.padEnd(16),
      `${r.sim1530N}/${r.sim1530Pnl.toFixed(2)}`,
    );
  }

  const showDetail = all1530.length <= 80;
  if (showDetail && all1530.length) {
    console.log('\n=== Trades simulados 15m → 30m (detalhe) ===');
    for (const t of all1530.sort((a, b) => a.entryTime - b.entryTime)) {
      const pnl = `${t.pnlUsdt >= 0 ? '+' : ''}${t.pnlUsdt.toFixed(2)} (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%)`;
      console.log(
        `  ${t.symbol.padEnd(12)} ${fmt(t.entryTime)} → ${t.exitTime ? fmt(t.exitTime) : 'agora'}  ${pnl.padStart(20)}  ${t.open ? 'ABERTO' : (t.reason || '')}`,
      );
    }
  } else if (all1530.length) {
    const best = [...all1530].sort((a, b) => b.pnlUsdt - a.pnlUsdt).slice(0, 10);
    const worst = [...all1530].sort((a, b) => a.pnlUsdt - b.pnlUsdt).slice(0, 10);
    console.log('\n=== Top 10 melhores 15m → 30m ===');
    for (const t of best) {
      console.log(`  ${t.symbol.padEnd(12)} ${fmt(t.entryTime)}  ${(t.pnlUsdt >= 0 ? '+' : '') + t.pnlUsdt.toFixed(2)} (${(t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(2)}%)${t.open ? ' ABERTO' : ''}`);
    }
    console.log('\n=== Top 10 piores 15m → 30m ===');
    for (const t of worst) {
      console.log(`  ${t.symbol.padEnd(12)} ${fmt(t.entryTime)}  ${(t.pnlUsdt >= 0 ? '+' : '') + t.pnlUsdt.toFixed(2)} (${(t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(2)}%)${t.open ? ' ABERTO' : ''}`);
    }
  }

  console.log('\n--- Delta vs real ---');
  console.log(`  Sim 15→15 vs real:  ${(s1515.pnl - realPnl >= 0 ? '+' : '')}${(s1515.pnl - realPnl).toFixed(2)} USDT`);
  console.log(`  Sim 15→30 vs real:  ${(s1530.pnl - realPnl >= 0 ? '+' : '')}${(s1530.pnl - realPnl).toFixed(2)} USDT`);
  console.log(`  Sim 15→30 vs 15→15: ${(s1530.pnl - s1515.pnl >= 0 ? '+' : '')}${(s1530.pnl - s1515.pnl).toFixed(2)} USDT\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
