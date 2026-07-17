'use strict';
/**
 * Avalia a posição do preço de entrada vs EMA21(4h) e EMA21(8h) nos trades
 * ma-cross da semana (informativo — não é um filtro configurado no bot).
 * Uso: node backend/bot/ma-cross/analyze-ema21-htf-week.js
 *      node backend/bot/ma-cross/analyze-ema21-htf-week.js --from 2026-07-07
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { computeMa } = require('../../utils/movingAverage');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMA_PERIOD = 21;

function weekStartMs() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();

  const now = new Date();
  const day = now.getDay(); // 0=dom
  const diff = day === 0 ? 6 : day - 1; // segunda
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - diff);
  return mon.getTime();
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

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const cMapCache = new Map();

async function loadCMap(exchange, symbol, entryMs) {
  const key = `${exchange}:${symbol}`;
  if (cMapCache.has(key)) return cMapCache.get(key);

  const pad = 30 * 86_400_000; // EMA21 em 8h precisa de ~7 dias so de candles fechados; folga extra
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const start = entryMs - pad;
  const end = Date.now() + 86_400_000;
  const [c4h, c8h] = await Promise.all([
    fetcher(symbol, '4h', start, end),
    fetcher(symbol, '8h', start, end),
  ]);
  const cMap = { '4h': c4h, '8h': c8h };
  cMapCache.set(key, cMap);
  return cMap;
}

const INTERVAL_MS = { '4h': 14_400_000, '8h': 28_800_000 };

/** Só candles fechados antes do momento de entrada. */
function candlesClosedBefore(candles, iv, entryMs) {
  const ms = INTERVAL_MS[iv];
  return (candles ?? []).filter(c => c.openTime + ms <= entryMs);
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;

  const cMap = await loadCMap(exchange, symbol, entryMs);
  const c4h = candlesClosedBefore(cMap['4h'], '4h', entryMs);
  const c8h = candlesClosedBefore(cMap['8h'], '8h', entryMs);

  const ema4h = computeMa(c4h, EMA_PERIOD);
  const ema8h = computeMa(c8h, EMA_PERIOD);

  const entryPrice = +trade.entry_price;
  const gap4h = ema4h != null ? ((entryPrice / ema4h) - 1) * 100 : null;
  const gap8h = ema8h != null ? ((entryPrice / ema8h) - 1) * 100 : null;

  const pnl = trade.pnl_usdt != null ? +trade.pnl_usdt : null;
  const closed = trade.exit_time != null && pnl != null;

  return {
    symbol,
    exchange,
    entryMs,
    entryTime: trade.entry_time,
    entryPrice,
    pnlUsdt: pnl,
    closed,
    open: !closed,
    ema4h,
    ema8h,
    gap4h,
    gap8h,
    above4h: gap4h != null ? gap4h > 0 : null,
    above8h: gap8h != null ? gap8h > 0 : null,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = weekStartMs();
  const fromIso = new Date(fromMs).toISOString();
  console.log(`\n═══ Posição da entrada vs EMA21(4h) e EMA21(8h) — trades ma-cross ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      results.push(await analyzeTrade(t));
      process.stderr.write(' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const valid = results.filter(r => !r.error);
  const below4h = valid.filter(r => r.above4h === false);
  const below8h = valid.filter(r => r.above8h === false);
  const belowBoth = valid.filter(r => r.above4h === false && r.above8h === false);

  const pnlAll = valid.filter(r => r.closed).reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const pnlBelow4h = below4h.filter(r => r.closed).reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const pnlBelow8h = below8h.filter(r => r.closed).reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const pnlBelowBoth = belowBoth.filter(r => r.closed).reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);

  console.log('── Resumo ──');
  console.log(`Trades no período: ${trades.length} (${valid.filter(r => r.closed).length} fechados, ${valid.filter(r => r.open).length} abertos)`);
  console.log(`Abaixo da EMA21(4h) na entrada: ${below4h.length}/${valid.length}`);
  console.log(`Abaixo da EMA21(8h) na entrada: ${below8h.length}/${valid.length}`);
  console.log(`Abaixo de ambas: ${belowBoth.length}/${valid.length}`);
  console.log('');
  console.log(`PnL real (todos fechados):            ${pnlAll >= 0 ? '+' : ''}${pnlAll.toFixed(2)} USDT`);
  console.log(`PnL dos abaixo EMA21(4h) (fechados):  ${pnlBelow4h >= 0 ? '+' : ''}${pnlBelow4h.toFixed(2)} USDT`);
  console.log(`PnL dos abaixo EMA21(8h) (fechados):  ${pnlBelow8h >= 0 ? '+' : ''}${pnlBelow8h.toFixed(2)} USDT`);
  console.log(`PnL dos abaixo de ambas (fechados):   ${pnlBelowBoth >= 0 ? '+' : ''}${pnlBelowBoth.toFixed(2)} USDT`);

  console.log('\n── Detalhe por trade ──');
  console.log('Símbolo     | Entrada (BRT)       | PnL USDT | vs EMA21(4h) | vs EMA21(8h)');
  console.log('------------|---------------------|----------|--------------|-------------');
  for (const r of valid) {
    const pnlStr = r.closed ? `${r.pnlUsdt >= 0 ? '+' : ''}${r.pnlUsdt.toFixed(2)}` : 'aberto';
    const g4 = r.above4h == null ? '—' : `${r.above4h ? 'acima' : 'ABAIXO'} ${fmtPct(r.gap4h)}`;
    const g8 = r.above8h == null ? '—' : `${r.above8h ? 'acima' : 'ABAIXO'} ${fmtPct(r.gap8h)}`;
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${pnlStr.padStart(8)} | ${g4.padEnd(12)} | ${g8}`,
    );
  }

  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: erro — ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
