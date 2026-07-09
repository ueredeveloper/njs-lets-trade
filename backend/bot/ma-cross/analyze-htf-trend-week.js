'use strict';
/**
 * Avalia impacto da regra entryTrendMa (EMA9 > EMA21 em 1h) nos trades ma-cross da semana.
 * Uso: node backend/bot/ma-cross/analyze-htf-trend-week.js
 *      node backend/bot/ma-cross/analyze-htf-trend-week.js --from 2026-07-07
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { normalizeMaCrossConfig, toEngineConfig, configFromRow } = require('./tradeConfigSchema');
const { evaluateEntryTrendMa, evaluateEntry, evaluateCrossSignal } = require('./strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function sliceCMap(cMap, openTime) {
  const out = {};
  for (const [iv, arr] of Object.entries(cMap)) {
    out[iv] = arr.filter(c => c.openTime <= openTime);
  }
  return out;
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

  const pad = 8 * 86_400_000;
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const start = entryMs - pad;
  const end = Date.now() + 86_400_000;
  const [c15, c1h] = await Promise.all([
    fetcher(symbol, '15m', start, end),
    fetcher(symbol, '1h', start, end),
  ]);
  const cMap = { '15m': c15, '1h': c1h };
  cMapCache.set(key, cMap);
  return cMap;
}

function resolveConfig(trade, stateRow) {
  const fromState = configFromRow(stateRow);
  if (fromState) return toEngineConfig(normalizeMaCrossConfig({ ...fromState, entryTrendMa: { enabled: true } }));
  return toEngineConfig(normalizeMaCrossConfig({}));
}

async function analyzeTrade(trade, stateByKey) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const stateKey = `${symbol}:${trade.strategy_id ?? 'ma-cross'}`;
  const stateRow = stateByKey.get(stateKey);
  const config = resolveConfig(trade, stateRow);

  const cMap = await loadCMap(exchange, symbol, entryMs);
  const slice = sliceCMap(cMap, entryMs);

  const trend = evaluateEntryTrendMa(config, slice, { closedOnly: true });
  const entry = evaluateEntry(config, slice, {}, { closedOnly: true });
  const cross = evaluateCrossSignal(config, slice, {}, { closedOnly: true });

  const pnl = trade.pnl_usdt != null ? +trade.pnl_usdt : null;
  const closed = trade.exit_time != null && pnl != null;

  return {
    symbol,
    exchange,
    entryMs,
    entryTime: trade.entry_time,
    exitTime: trade.exit_time,
    entryPrice: +trade.entry_price,
    pnlUsdt: pnl,
    closed,
    open: !closed,
    trendAllowed: trend.allowed,
    trendReason: trend.reason,
    trendMa1: trend.trendMa1,
    trendMa2: trend.trendMa2,
    entryAllowed: entry.allowed,
    entryReason: entry.reason,
    crossAllowed: cross.allowed,
    crossReason: cross.reason,
    gapPct: trend.trendMa1 != null && trend.trendMa2 != null
      ? ((trend.trendMa1 / trend.trendMa2) - 1) * 100
      : null,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = weekStartMs();
  const fromIso = new Date(fromMs).toISOString();
  console.log(`\n═══ Avaliação entryTrendMa (EMA9 > EMA21 em 1h) ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross neste período.');
    return;
  }

  const states = await sbGet('rsi_multi_bot_state', '?strategy_id=eq.ma-cross&select=symbol,strategy_id,trade_config');
  const stateByKey = new Map(states.map(s => [`${s.symbol}:${s.strategy_id}`, s]));

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      results.push(await analyzeTrade(t, stateByKey));
      process.stderr.write(' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({
        symbol: t.symbol,
        error: err.message,
        pnlUsdt: t.pnl_usdt != null ? +t.pnl_usdt : null,
        closed: t.exit_time != null,
      });
    }
  }

  const valid = results.filter(r => !r.error);
  const allowed = valid.filter(r => r.trendAllowed);
  const blocked = valid.filter(r => !r.trendAllowed);
  const closedAllowed = allowed.filter(r => r.closed);
  const closedBlocked = blocked.filter(r => r.closed);
  const openBlocked = blocked.filter(r => r.open);

  const pnlReal = valid.filter(r => r.closed).reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const pnlAllowed = closedAllowed.reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const pnlBlocked = closedBlocked.reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const winsAllowed = closedAllowed.filter(r => r.pnlUsdt >= 0).length;
  const winsBlocked = closedBlocked.filter(r => r.pnlUsdt >= 0).length;

  console.log('── Resumo ──');
  console.log(`Trades no período: ${trades.length} (${valid.filter(r => r.closed).length} fechados, ${valid.filter(r => r.open).length} abertos)`);
  console.log(`Com regra HTF: ${allowed.length} permitidos, ${blocked.length} bloqueados`);
  console.log('');
  console.log(`PnL real (todos fechados):     ${pnlReal >= 0 ? '+' : ''}${pnlReal.toFixed(2)} USDT`);
  console.log(`PnL se só permitidos:          ${pnlAllowed >= 0 ? '+' : ''}${pnlAllowed.toFixed(2)} USDT (${winsAllowed}W/${closedAllowed.length - winsAllowed}L)`);
  console.log(`PnL evitado (bloqueados):      ${pnlBlocked >= 0 ? '+' : ''}${pnlBlocked.toFixed(2)} USDT (${winsBlocked}W/${closedBlocked.length - winsBlocked}L)`);
  console.log(`Diferença vs real:             ${(pnlAllowed - pnlReal) >= 0 ? '+' : ''}${(pnlAllowed - pnlReal).toFixed(2)} USDT`);
  if (openBlocked.length) {
    console.log(`Abertos que não teriam entrado: ${openBlocked.map(r => r.symbol).join(', ')}`);
  }

  console.log('\n── Detalhe por trade ──');
  console.log('Símbolo     | Entrada (BRT)       | PnL USDT | HTF 1h      | Gap EMA9/21 | Outras regras');
  console.log('------------|---------------------|----------|-------------|-------------|-------------');
  for (const r of valid) {
    const pnlStr = r.closed
      ? `${r.pnlUsdt >= 0 ? '+' : ''}${r.pnlUsdt.toFixed(2)}`
      : 'aberto';
    const htf = r.trendAllowed ? 'OK ↑' : (r.trendReason ?? 'BLOQ');
    const gap = r.gapPct != null ? fmtPct(r.gapPct) : '—';
    const other = r.trendAllowed && !r.entryAllowed ? (r.entryReason ?? '—') : '—';
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${pnlStr.padStart(8)} | ${htf.padEnd(11)} | ${gap.padStart(11)} | ${other}`,
    );
  }

  if (blocked.length) {
    console.log('\n── Bloqueados pela regra HTF ──');
    for (const r of blocked) {
      const verdict = r.closed
        ? (r.pnlUsdt >= 0 ? `teria PERDIDO ganho +${r.pnlUsdt.toFixed(2)}` : `teria EVITADO perda ${r.pnlUsdt.toFixed(2)}`)
        : 'não teria entrado (ainda aberto)';
      console.log(`  ${r.symbol} @ ${fmtDt(r.entryMs)} — EMA9=${r.trendMa1?.toFixed(6) ?? '?'} EMA21=${r.trendMa2?.toFixed(6) ?? '?'} (${fmtPct(r.gapPct)}) → ${verdict}`);
    }
  }

  if (allowed.length) {
    console.log('\n── Permitidos pela regra HTF ──');
    for (const r of allowed) {
      const pnlStr = r.closed ? `${r.pnlUsdt >= 0 ? '+' : ''}${r.pnlUsdt.toFixed(2)} USDT` : 'aberto';
      console.log(`  ${r.symbol} @ ${fmtDt(r.entryMs)} — gap ${fmtPct(r.gapPct)} → ${pnlStr}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
