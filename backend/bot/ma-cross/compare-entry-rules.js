'use strict';
/**
 * Compara regras de entrada MA-Cross nos trades históricos (Supabase).
 * Uso: node backend/bot/ma-cross/compare-entry-rules.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { normalizeMaCrossConfig, toEngineConfig } = require('./tradeConfigSchema');
const {
  checkMaCrossover, evaluateEntry, evaluateCrossSignal, evaluatePullbackReady,
  evaluateExit, computeAdaptiveDips, checkEntryMaxAboveMa2, getFinestPollInterval,
} = require('./strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FEE = 0.002;
const CAPITAL = 40;

const CONFIG = toEngineConfig(normalizeMaCrossConfig({
  entry: {
    ma1: { period: 9, interval: '15m' },
    ma2: { period: 21, interval: '15m' },
    direction: 'cross_up',
    tolerancePct: 0.1,
    maxAboveMaPct: 3,
  },
  maFiltersEnabled: true,
  maFilters: [{ id: 1, enabled: true, period: 50, interval: '1h', mode: 'adaptive', maxDipPct: 4 }],
  execution: { pullbackEntry: { enabled: true, waitCandles: 2, requirePullback: true } },
  exit: {
    logic: 'any',
    maCross: {
      enabled: true,
      ma1: { period: 9, interval: '15m' },
      ma2: { period: 21, interval: '15m' },
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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function sliceCMap(cMap, openTime) {
  const out = {};
  for (const [iv, arr] of Object.entries(cMap)) {
    out[iv] = arr.filter(c => c.openTime <= openTime);
  }
  return out;
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
    await new Promise(r => setTimeout(r, 80));
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

async function buildCMap(exchange, symbol, startMs, endMs) {
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const pad = 5 * 86_400_000;
  const [c15, c1h] = await Promise.all([
    fetcher(symbol, '15m', startMs - pad, endMs + pad),
    fetcher(symbol, '1h', startMs - pad, endMs + pad),
  ]);
  return { '15m': c15, '1h': c1h };
}

function simulateExit(cMap, config, entryTime, entryPrice) {
  const scanIv = getFinestPollInterval(config);
  const candles = cMap[scanIv] ?? [];
  const startIdx = candles.findIndex(c => c.openTime >= entryTime);
  if (startIdx < 0) return { pnlPct: null, reason: 'NO_DATA' };

  const buyNet = entryPrice * (1 + FEE);
  let peak = entryPrice;
  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    const slice = sliceCMap(cMap, c.openTime);
    peak = Math.max(peak, c.high ?? c.close, c.close);
    const exit = evaluateExit(config, slice, buyNet, { peakPrice: peak, closedOnly: true });
    if (exit.exit) {
      const sellNet = exit.close * (1 - FEE);
      const pnlPct = ((sellNet - buyNet) / buyNet) * 100;
      return { pnlPct, pnlUsdt: (pnlPct / 100) * CAPITAL, reason: exit.reason, exitTime: c.openTime };
    }
  }
  return { pnlPct: null, reason: 'OPEN' };
}

function sliceAtClosed(cMap, closedOpenTime) {
  const sliceEnd = closedOpenTime + 900_000;
  const out = {};
  for (const [iv, arr] of Object.entries(cMap)) {
    out[iv] = arr.filter(c => c.openTime <= sliceEnd);
  }
  return out;
}

function tryImmediate(config, cMap, dips, crossTime) {
  const slice = sliceAtClosed(cMap, crossTime);
  const dipsAt = computeAdaptiveDips(config, slice);
  const ev = evaluateEntry(config, slice, dipsAt, { closedOnly: true });
  if (!ev.allowed) return { blocked: true, reason: ev.reason };
  return { entryTime: crossTime, entryPrice: ev.close, mode: 'immediate' };
}

function tryPendingOldSignal(config, cMap, _dips, crossTime, crossClose) {
  const noPb = {
    ...config,
    execution: {
      ...config.execution,
      pullbackEntry: { ...config.execution?.pullbackEntry, requirePullback: false },
    },
  };
  const wait = config.execution?.pullbackEntry?.waitCandles ?? 2;
  const entryOpenTime = crossTime + wait * 900_000;
  const slice = sliceAtClosed(cMap, entryOpenTime);
  const ready = evaluatePullbackReady(noPb, slice, computeAdaptiveDips(config, slice), {
    signalOpenTime: crossTime, signalClose: crossClose,
  });
  if (!ready.ready) return { blocked: true, reason: ready.reason };
  if (ready.close >= crossClose) return { blocked: true, reason: 'NO_PULLBACK' };
  return { entryTime: entryOpenTime, entryPrice: ready.close, mode: 'pending-old' };
}

function tryPending(config, cMap, _dips, crossTime, crossClose) {
  const wait = config.execution?.pullbackEntry?.waitCandles ?? 2;
  const entryOpenTime = crossTime + wait * 900_000;
  const slice = sliceAtClosed(cMap, entryOpenTime);
  const dipsAtEntry = computeAdaptiveDips(config, slice);
  const pending = { signalOpenTime: crossTime, signalClose: crossClose };
  const ready = evaluatePullbackReady(config, slice, dipsAtEntry, pending);
  if (!ready.ready) return { blocked: true, reason: ready.reason };
  return { entryTime: entryOpenTime, entryPrice: ready.close, mode: 'pending' };
}

function tryHybrid(config, cMap, dips, crossTime, crossClose) {
  const imm = tryImmediate(config, cMap, dips, crossTime);
  if (imm && !imm.blocked) return imm;
  return tryPending(config, cMap, dips, crossTime, crossClose);
}

function tryLegacyNoCap(config, cMap, dips, crossTime) {
  const legacyConfig = { ...config, entry: { ...config.entry, maxAboveMaPct: 0 } };
  return tryImmediate(legacyConfig, cMap, dips, crossTime);
}

async function analyzeSymbol(exchange, symbol, trades, cMap) {
  const scanIv = '15m';
  const candles = cMap[scanIv] ?? [];
  const warmup = 35;
  const signals = [];

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i];
    const slice = sliceCMap(cMap, c.openTime);
    const dips = computeAdaptiveDips(CONFIG, slice);
    const cross = checkMaCrossover({
      candles1: slice['15m'], period1: 9, interval1: '15m',
      candles2: slice['15m'], period2: 21, interval2: '15m',
      direction: 'cross_up', tolerancePct: 0.1, closedOnly: true,
    });
    if (!cross.crossed) continue;

    const crossTime = cross.openTime ?? c.openTime;
    const matchedReal = trades.find(t => {
      const et = new Date(t.entry_time).getTime();
      return Math.abs(et - crossTime) <= 20 * 60_000;
    });

    const rules = {
      real: matchedReal ? {
        entryTime: new Date(matchedReal.entry_time).getTime(),
        entryPrice: +matchedReal.entry_price,
        pnlUsdt: +matchedReal.pnl_usdt,
        taken: true,
      } : { taken: false },
      legacy: tryLegacyNoCap(CONFIG, cMap, dips, crossTime),
      immediate3: tryImmediate(CONFIG, cMap, dips, crossTime),
      pendingOld: tryPendingOldSignal(CONFIG, cMap, dips, crossTime, cross.close),
      alwaysPending: tryPending(CONFIG, cMap, dips, crossTime, cross.close),
      hybrid: tryHybrid(CONFIG, cMap, dips, crossTime, cross.close),
    };

    for (const key of ['legacy', 'immediate3', 'pendingOld', 'alwaysPending', 'hybrid']) {
      const r = rules[key];
      if (!r || r.blocked) {
        rules[key] = { taken: false, blocked: true, reason: r?.reason };
        continue;
      }
      const ex = simulateExit(cMap, CONFIG, r.entryTime, r.entryPrice);
      rules[key] = { ...r, taken: true, ...ex };
    }

    signals.push({ crossTime, rules, crossClose: cross.close, aboveMa2: checkEntryMaxAboveMa2(cross.close, cross.ma2, 3) });
  }

  return signals;
}

function summarize(allSignals, realTrades) {
  const keys = ['real', 'legacy', 'immediate3', 'pendingOld', 'alwaysPending', 'hybrid'];
  const labels = {
    real: 'Real (histórico)',
    legacy: 'Sem teto nem pullback',
    immediate3: 'Sempre imediato + teto 3%',
    pendingOld: 'Pending: close < sinal (antiga)',
    alwaysPending: 'Sempre pending MA21',
    hybrid: 'Imediato ≤3% MA21 ou pending',
  };
  const out = {};
  const isSubset = allSignals.length > 0 && allSignals.every(s => s.rules.real?.taken);

  for (const key of keys) {
    if (key === 'real') {
      if (isSubset) {
        let pnl = 0, wins = 0;
        for (const sig of allSignals) {
          pnl += sig.rules.real.pnlUsdt;
          if (sig.rules.real.pnlUsdt >= 0) wins++;
        }
        out[key] = { label: labels[key], entries: allSignals.length, blocked: 0, wins, losses: allSignals.length - wins, pnlUsdt: pnl };
      } else {
        const closed = realTrades.filter(t => t.pnl_usdt != null);
        const pnl = closed.reduce((s, t) => s + (+t.pnl_usdt), 0);
        const wins = closed.filter(t => +t.pnl_usdt >= 0).length;
        out[key] = { label: labels[key], entries: closed.length, blocked: 0, wins, losses: closed.length - wins, pnlUsdt: pnl };
      }
      continue;
    }

    let entries = 0, blocked = 0, pnl = 0, wins = 0, losses = 0, open = 0;
    for (const sig of allSignals) {
      const r = sig.rules[key];
      if (!r?.taken) { blocked++; continue; }
      entries++;
      if (r.pnlPct == null) { open++; continue; }
      pnl += r.pnlUsdt ?? 0;
      if (r.pnlUsdt >= 0) wins++; else losses++;
    }
    out[key] = { label: labels[key], entries, blocked, wins, losses, open, pnlUsdt: pnl };
  }
  return out;
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const trades = await sbGet('rsi_multi_bot_trades', '?strategy_id=eq.ma-cross&order=entry_time.asc');
  const closed = trades.filter(t => t.exit_time && t.pnl_usdt != null);
  console.log(`Trades ma-cross: ${closed.length} fechados (${trades.length} total)\n`);

  const bySym = new Map();
  for (const t of closed) {
    const k = `${t.exchange ?? 'binance'}:${t.symbol}`;
    if (!bySym.has(k)) bySym.set(k, []);
    bySym.get(k).push(t);
  }

  const allSignals = [];
  for (const [key, symTrades] of bySym) {
    const [exchange, symbol] = key.split(':');
    const times = symTrades.flatMap(t => [new Date(t.entry_time).getTime(), new Date(t.exit_time).getTime()]);
    const start = Math.min(...times);
    const end = Math.max(...times);
    process.stderr.write(`  ${symbol} (${symTrades.length} trades)...`);
    const cMap = await buildCMap(exchange, symbol, start, end);
    const sigs = await analyzeSymbol(exchange, symbol, symTrades, cMap);
    allSignals.push(...sigs);
    process.stderr.write(` ${sigs.length} cruzamentos\n`);
  }

  const summary = summarize(allSignals, closed);
  const base = summary.real.pnlUsdt;

  console.log('┌────────────────────────────────────┬────────┬─────────┬──────┬────────┬──────────┐');
  console.log('│ Regra                              │ Entradas│ Bloqueios│ Vitórias│ PnL USDT │ vs Real  │');
  console.log('├────────────────────────────────────┼────────┼─────────┼──────┼────────┼──────────┤');
  for (const key of ['real', 'hybrid', 'pendingOld', 'alwaysPending', 'immediate3']) {
    const s = summary[key];
    const delta = s.pnlUsdt - base;
    const deltaStr = key === 'real' ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
    const wins = key === 'real' ? s.wins : `${s.wins}/${s.entries}`;
    console.log(
      `│ ${s.label.padEnd(34)} │ ${String(s.entries).padStart(6)} │ ${String(s.blocked).padStart(7)} │ ${String(wins).padStart(4)} │ ${s.pnlUsdt.toFixed(2).padStart(8)} │ ${deltaStr.padStart(8)} │`,
    );
  }
  console.log('└────────────────────────────────────┴────────┴─────────┴──────┴────────┴──────────┘');

  const hybridBetter = allSignals.filter(s => {
    const h = s.rules.hybrid;
    const a = s.rules.alwaysPending;
    return h?.taken && !a?.taken && s.rules.real?.taken;
  });
  const hybridWorse = allSignals.filter(s => {
    const h = s.rules.hybrid;
    const a = s.rules.alwaysPending;
    return !h?.taken && a?.taken && s.rules.real?.taken;
  });
  const cheapImmediate = allSignals.filter(s => s.aboveMa2?.allowed && s.rules.real?.taken);
  const expensive = allSignals.filter(s => !s.aboveMa2?.allowed && s.rules.real?.taken);

  console.log(`\nCruzamentos com trade real: ${allSignals.filter(s => s.rules.real?.taken).length}`);
  console.log(`  baratos (≤3% MA21 no cruzamento): ${cheapImmediate.length}`);
  console.log(`  caros (>3% MA21 no cruzamento): ${expensive.length}`);
  console.log(`  híbrido entra, pending atual não: ${hybridBetter.length}`);
  console.log(`  pending atual entra, híbrido não: ${hybridWorse.length}`);

  const matched = allSignals.filter(s => s.rules.real?.taken);
  const gained = allSignals.filter(s => s.rules.alwaysPending?.taken && !s.rules.pendingOld?.taken);
  const lost = allSignals.filter(s => !s.rules.alwaysPending?.taken && s.rules.pendingOld?.taken);

  console.log('\n── Só cruzamentos que viraram trade real ──');
  const sub = summarize(matched, closed);
  for (const key of ['real', 'hybrid', 'pendingOld', 'alwaysPending', 'immediate3']) {
    const s = sub[key];
    const delta = s.pnlUsdt - sub.real.pnlUsdt;
    console.log(`  ${s.label}: ${s.entries} entradas, PnL ${s.pnlUsdt.toFixed(2)} USDT (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} vs real)`);
  }

  console.log(`\n  Nova regra ganha entradas vs antiga: ${gained.length} cruzamentos`);
  console.log(`  Antiga entrava, nova bloqueia: ${lost.length} cruzamentos`);

  let oldWins = 0, newWins = 0, pendWins = 0;
  for (const s of matched) {
    const r = s.rules.real.pnlUsdt;
    if (s.rules.pendingOld?.pnlUsdt > r) oldWins++;
    if (s.rules.alwaysPending?.pnlUsdt > r) newWins++;
    if (s.rules.immediate3?.pnlUsdt > r) pendWins++;
  }
  console.log(`  Melhor que o real: pending antiga=${oldWins}, pending MA21=${newWins}, imediato 3%=${pendWins} de ${matched.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
