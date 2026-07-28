'use strict';
/**
 * Mesmo cálculo de analyze-chop-entry-2w.js (CHOP(14) e cruzamentos EMA9x21
 * no candle 1h da entrada, agrupados por faixa), mas usando como resultado
 * do trade a simulação "e se a saída fosse sempre um take-profit fixo de 5%
 * (Venda — Alvo % histórico BB)" em vez do exit real (MA cross / stop / etc),
 * igual analyze-1h-tp5.js: usa candles 5m entre entrada e saída real pra
 * achar o MFE e checar se bateu +5% antes da saída real ocorrer; se não
 * bateu, mantém o resultado real (o TP nunca teria disparado a tempo).
 *
 * Uso: node backend/bot/ma-cross/analyze-chop-entry-tp5-2w.js
 *      node backend/bot/ma-cross/analyze-chop-entry-tp5-2w.js --days 14
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HOUR_IV_MS = 3_600_000;
const FINE_IV = '5m';
const FINE_IV_MS = 300_000;
const CHOP_PERIOD = 14;
const CROSS_LOOKBACK = 30;
const HIST_PAD_MS = 50 * 86_400_000;
const TP_PCT = 5;

function fromMsArg() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();
  const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
  const days = daysArg ? Number(daysArg) : 14;
  return Date.now() - days * 86_400_000;
}

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
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
  const out = [];
  let cursor = startMs;
  const stepMs = interval === '1h' ? 3600 * 1000 : 300 * 1000;
  while (cursor < endMs) {
    const from = Math.floor(cursor / 1000);
    const to = Math.min(Math.floor(endMs / 1000), from + 1000 * (stepMs / 1000));
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      out.push({ openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2] });
    }
    const last = Number(raw[raw.length - 1][0]) * 1000;
    if (last <= cursor) break;
    cursor = last + stepMs;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

function trueRange(candles) {
  const tr = [null];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return tr;
}

function chopSeries(candles, n = CHOP_PERIOD) {
  const tr = trueRange(candles);
  const out = new Array(candles.length).fill(null);
  for (let i = n; i < candles.length; i++) {
    const trWindow = tr.slice(i - n + 1, i + 1);
    if (trWindow.some(v => v == null)) continue;
    const window = candles.slice(i - n + 1, i + 1);
    const sumTR = trWindow.reduce((a, b) => a + b, 0);
    const hh = Math.max(...window.map(c => c.high));
    const ll = Math.min(...window.map(c => c.low));
    if (hh - ll <= 0) continue;
    out[i] = 100 * Math.log10(sumTR / (hh - ll)) / Math.log10(n);
  }
  return out;
}

function emaDiffSeries(candles, fastP = 9, slowP = 21) {
  const closes = candles.map(c => c.close);
  const fast = ti.EMA.calculate({ period: fastP, values: closes });
  const slow = ti.EMA.calculate({ period: slowP, values: closes });
  const offFast = closes.length - fast.length;
  const offSlow = closes.length - slow.length;
  const diff = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const f = i - offFast >= 0 ? fast[i - offFast] : null;
    const s = i - offSlow >= 0 ? slow[i - offSlow] : null;
    if (f != null && s != null) diff[i] = f - s;
  }
  return diff;
}

function countCrosses(diff, uptoIdx, lookback = CROSS_LOOKBACK) {
  const start = Math.max(1, uptoIdx - lookback + 1);
  let n = 0;
  for (let i = start; i <= uptoIdx; i++) {
    if (diff[i - 1] == null || diff[i] == null) continue;
    if ((diff[i - 1] <= 0 && diff[i] > 0) || (diff[i - 1] >= 0 && diff[i] < 0)) n++;
  }
  return n;
}

function idxAtOrBefore(candles, ms) {
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].openTime <= ms) idx = i; else break;
  }
  return idx;
}

function classify(chop) {
  if (chop == null) return null;
  if (chop < 38.2) return 'tendência (<38.2)';
  if (chop > 61.8) return 'choppy (>61.8)';
  return 'neutro (38.2-61.8)';
}

function crossBucket(n) {
  if (n <= 1) return '0-1 (limpo)';
  if (n <= 3) return '2-3 (moderado)';
  return '4+ (choppy)';
}

function simulateTp5(fineCandles, entryPrice, realPnlPct) {
  const target = entryPrice * (1 + TP_PCT / 100);
  for (const c of fineCandles) {
    if (c.high >= target) return { pct: TP_PCT, hit: true };
  }
  return { pct: realPnlPct, hit: false };
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exitMs = new Date(trade.exit_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const entryPrice = +trade.entry_price;
  const realPnlPct = +trade.pnl_pct;
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;

  const candles1h = await fetcher(symbol, '1h', entryMs - HIST_PAD_MS, entryMs + HOUR_IV_MS);
  if (candles1h.length < CHOP_PERIOD + CROSS_LOOKBACK + 25) {
    return { symbol, error: 'candles 1h insuficientes' };
  }
  const idx = idxAtOrBefore(candles1h, entryMs);
  if (idx < 0) return { symbol, error: 'sem candle 1h na entrada' };

  const chop = chopSeries(candles1h, CHOP_PERIOD);
  const diff = emaDiffSeries(candles1h, 9, 21);
  const chopAtEntry = chop[idx];
  if (chopAtEntry == null) return { symbol, error: 'CHOP indisponível na entrada' };
  const crosses = countCrosses(diff, idx, CROSS_LOOKBACK);

  const fine = await fetcher(symbol, FINE_IV, entryMs - FINE_IV_MS, exitMs + FINE_IV_MS);
  const inTrade = fine.filter(c => c.openTime >= entryMs - FINE_IV_MS && c.openTime <= exitMs);
  if (!inTrade.length) return { symbol, error: 'sem candles 5m no período do trade' };

  const sim = simulateTp5(inTrade, entryPrice, realPnlPct);

  return {
    symbol,
    entryMs,
    chopAtEntry,
    crosses,
    realPnlPct,
    simPct: sim.pct,
    tpHit: sim.hit,
    win: sim.pct > 0,
    exitReason: trade.exit_reason,
  };
}

function summarizeBy(results, keyFn, label) {
  const groups = new Map();
  for (const r of results) {
    const key = keyFn(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  console.log(`\n── Por ${label} (PnL simulado 5% TP) ──`);
  console.log('Faixa                | N  | Vitórias | Taxa acerto | PnL médio | PnL total | Bateram 5%');
  console.log('----------------------|----|----------|-------------|-----------|-----------|----------');
  const order = [...groups.keys()].sort();
  for (const key of order) {
    const g = groups.get(key);
    const wins = g.filter(r => r.win).length;
    const hits = g.filter(r => r.tpHit).length;
    const avgPnl = g.reduce((s, r) => s + r.simPct, 0) / g.length;
    const totalPnl = g.reduce((s, r) => s + r.simPct, 0);
    console.log(
      `${key.padEnd(21)} | ${String(g.length).padStart(2)} | ${String(wins).padStart(8)} | `
      + `${(wins / g.length * 100).toFixed(0).padStart(10)}% | ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2).padStart(8)}% | `
      + `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2).padStart(8)}% | ${hits}/${g.length} (${(hits / g.length * 100).toFixed(0)}%)`,
    );
  }
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();

  console.log(`\n═══ ma-cross 1h — CHOP(14) e cruzamentos EMA9x21 na entrada vs "saída sempre 5% TP" ═══`);
  console.log(`Período: desde ${fromIso}\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&entry_time=not.is.null&exit_time=not.is.null&pnl_pct=not.is.null&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross fechado neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      const r = await analyzeTrade(t);
      results.push(r);
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const ok = results.filter(r => !r.error);
  const errors = results.filter(r => r.error);

  const realTotal = ok.reduce((s, r) => s + r.realPnlPct, 0);
  const simTotal = ok.reduce((s, r) => s + r.simPct, 0);
  const hitCount = ok.filter(r => r.tpHit).length;

  console.log(`\nTrades fechados no período: ${trades.length}`);
  console.log(`Analisados com sucesso: ${ok.length}`);
  console.log(`Erros / dados insuficientes: ${errors.length}`);
  if (ok.length) {
    console.log(`\nSoma PnL REAL (exit real): ${realTotal >= 0 ? '+' : ''}${realTotal.toFixed(2)}%`);
    console.log(`Soma PnL SIM (5% TP fixo): ${simTotal >= 0 ? '+' : ''}${simTotal.toFixed(2)}%  (Δ ${simTotal - realTotal >= 0 ? '+' : ''}${(simTotal - realTotal).toFixed(2)}pp)`);
    console.log(`Bateram +5% antes da saída real: ${hitCount}/${ok.length} (${(hitCount / ok.length * 100).toFixed(0)}%)`);
  }

  if (!ok.length) return;

  summarizeBy(ok, r => classify(r.chopAtEntry), 'faixa de CHOP(14) na entrada');
  summarizeBy(ok, r => crossBucket(r.crosses), 'nº de cruzamentos EMA9x21 (30c) antes da entrada');

  console.log('\n── Detalhe por trade ──');
  console.log('Símbolo     | Entrada             | CHOP entrada | Cruzamentos | PnL real | PnL sim 5% | Bateu 5% | Motivo saída real');
  console.log('------------|---------------------|--------------|-------------|----------|------------|----------|-------------------');
  for (const r of ok) {
    console.log(
      `${r.symbol.padEnd(11)} | ${new Date(r.entryMs).toISOString().slice(0, 16).replace('T', ' ').padEnd(19)} | `
      + `${r.chopAtEntry.toFixed(1).padStart(12)} | ${String(r.crosses).padStart(11)} | `
      + `${((r.realPnlPct >= 0 ? '+' : '') + r.realPnlPct.toFixed(2) + '%').padStart(8)} | `
      + `${((r.simPct >= 0 ? '+' : '') + r.simPct.toFixed(2) + '%').padStart(10)} | `
      + `${(r.tpHit ? 'sim' : 'não').padStart(8)} | ${r.exitReason ?? '—'}`,
    );
  }

  for (const r of errors) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
