'use strict';
/**
 * Avalia se RSI(14) do candle 5m no momento da entrada distingue trades vencedores de
 * perdedores no RSI Momentum (strategy_id: rsi-momentum), e simula o impacto de exigir
 * RSI 5m > threshold (70, 65, 60...) como filtro adicional de entrada (além do sinal
 * real: RSI(14) do entry.interval, tipicamente 15m, cruzando entry.rsiThreshold).
 *
 * Uso:
 *   node backend/bot/rsi-momentum/analyze-rsi5m-filter.js
 *   node backend/bot/rsi-momentum/analyze-rsi5m-filter.js --from 2026-07-01
 *
 * Por padrão só considera trades com entry_time >= 24/08/2026 10:15 BRT — commit 533900e
 * introduziu entry.priorRsiFilter (exige N valores de RSI anteriores <= threshold antes do
 * cruzamento) nesse horário; trades anteriores não refletem o comportamento atual do bot.
 * --from mais recente que isso sobrepõe o corte; --all remove o corte por completo.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { RSI } = require('technicalindicators');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const IV_5M_MS = 5 * 60_000;
const RSI_PERIOD = 14;
const WARMUP = RSI_PERIOD + 10;

const THRESHOLDS = [55, 60, 65, 70, 75, 80];

// ── Supabase ────────────────────────────────────────────────────────────────
async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Candles 5m ──────────────────────────────────────────────────────────────
async function fetchBinanceRange(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&startTime=${cursor}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      const t = Number(c[0]);
      if (t > endMs) break;
      out.push({ openTime: t, close: +c[4] });
    }
    const last = Number(raw[raw.length - 1][0]);
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

async function fetchGateRange(symbol, startMs, endMs) {
  const pair = toGateSymbol(symbol);
  const out = [];
  let cursor = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);
  while (cursor < end) {
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=5m&from=${cursor}&to=${end}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) out.push({ openTime: Number(c[0]) * 1000, close: +c[2] });
    const last = Number(raw[raw.length - 1][0]);
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

const candleCache = new Map();

async function get5mCandles(exchange, symbol, entryMs) {
  const key = `${exchange}:${symbol}`;
  if (!candleCache.has(key)) {
    const pad = (WARMUP + 10) * IV_5M_MS;
    const start = entryMs - pad;
    const end = entryMs + IV_5M_MS * 2;
    const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
    candleCache.set(key, await fetcher(symbol, start, end));
  }
  return candleCache.get(key);
}

// ── RSI 5m no momento da entrada ─────────────────────────────────────────────
function computeRsi5mAt(candles, entryMs) {
  // Último candle 5m FECHADO antes (ou no início) do momento de entrada.
  const idx = candles.findLastIndex(c => c.openTime + IV_5M_MS <= entryMs);
  if (idx < WARMUP) return null;

  const closes = candles.slice(0, idx + 1).map(c => c.close);
  const rsi = RSI.calculate({ values: closes, period: RSI_PERIOD });
  if (!rsi.length) return null;
  return rsi[rsi.length - 1];
}

// ── Formatação ───────────────────────────────────────────────────────────────
// Commit 533900e (24/08/2026 10:15 BRT) introduziu entry.priorRsiFilter — trades anteriores a
// esse horário entraram sem esse filtro e não representam a estratégia atual.
const PRIOR_RSI_FILTER_CUTOFF_MS = new Date('2026-08-24T10:15:00-03:00').getTime();

function fromArgMs() {
  if (process.argv.includes('--all')) return 0;
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();
  return PRIOR_RSI_FILTER_CUTOFF_MS;
}

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
}

function fmtPnl(n) {
  if (n == null) return '    —   ';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`.padStart(8);
}

function pnlColor(n) {
  if (n == null) return '';
  return n >= 0 ? '\x1b[32m' : '\x1b[31m';
}
const RESET = '\x1b[0m';

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes'); process.exit(1); }

  const fromMs = fromArgMs();
  const fromIso = new Date(fromMs).toISOString();

  console.log('\n═══ RSI(14) 5m no momento da entrada — RSI Momentum ═══');
  if (fromMs === PRIOR_RSI_FILTER_CUTOFF_MS) {
    console.log(`Período: desde ${fmtDt(fromMs)} (corte automático — entrada do priorRsiFilter, commit 533900e; use --all pra incluir trades anteriores)\n`);
  } else if (fromMs) {
    console.log(`Período: desde ${fmtDt(fromMs)}\n`);
  } else {
    console.log('Período: todo o histórico (--all)\n');
  }

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.rsi-momentum&entry_time=gte.${fromIso}&exit_time=not.is.null&order=entry_time.asc`,
  );

  if (!trades.length) { console.log('Nenhum trade fechado de rsi-momentum neste período.'); return; }
  console.log(`${trades.length} trades fechados encontrados\n`);

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    const entryMs = new Date(t.entry_time).getTime();
    const exchange = t.exchange ?? 'binance';
    const pnl = t.pnl_usdt != null ? +t.pnl_usdt : null;

    let rsi5m = null, error = null;
    try {
      const candles = await get5mCandles(exchange, t.symbol, entryMs);
      rsi5m = computeRsi5mAt(candles, entryMs);
      process.stderr.write(rsi5m != null ? ` rsi5m=${rsi5m.toFixed(1)}\n` : ' sem dados\n');
    } catch (err) {
      error = err.message;
      process.stderr.write(` erro: ${err.message}\n`);
    }

    results.push({
      symbol: t.symbol, exchange, entryMs, pnlUsdt: pnl,
      rsiEntry15m: t.rsi_entry != null ? +t.rsi_entry : null,
      rsi5m, error,
    });
  }

  const valid = results.filter(r => r.rsi5m != null && !r.error);

  // ── Detalhe trade a trade ──────────────────────────────────────────────────
  console.log('\n── Detalhe por trade ──────────────────────────────────────────────────────');
  console.log('Símbolo     | Entrada (BRT)       | PnL USDT | RSI 15m | RSI 5m');
  console.log('------------|---------------------|----------|---------|-------');
  for (const r of results) {
    const pnlStr = `${pnlColor(r.pnlUsdt)}${fmtPnl(r.pnlUsdt).trim()}${RESET}`;
    const rsi15 = r.rsiEntry15m != null ? r.rsiEntry15m.toFixed(1) : '—';
    const rsi5 = r.error ? `erro` : (r.rsi5m != null ? r.rsi5m.toFixed(1) : '—');
    console.log(`${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${pnlStr.padStart(8)} | ${rsi15.padStart(7)} | ${rsi5.padStart(6)}`);
  }

  // ── Estatística: RSI 5m médio em wins vs losses ─────────────────────────────
  const wins = valid.filter(r => r.pnlUsdt >= 0);
  const losses = valid.filter(r => r.pnlUsdt < 0);
  const avg = arr => arr.length ? arr.reduce((s, r) => s + r.rsi5m, 0) / arr.length : null;
  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].map(r => r.rsi5m).sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  console.log('\n── RSI 5m na entrada: vencedores vs perdedores ──────────────────────────────');
  console.log(`Vencedores (${wins.length}): média=${avg(wins)?.toFixed(1) ?? '—'}  mediana=${median(wins)?.toFixed(1) ?? '—'}`);
  console.log(`Perdedores (${losses.length}): média=${avg(losses)?.toFixed(1) ?? '—'}  mediana=${median(losses)?.toFixed(1) ?? '—'}`);

  // ── Simulação: exigir RSI 5m > threshold na entrada ─────────────────────────
  console.log('\n── Simulação: filtro adicional "RSI 5m > threshold" na entrada ─────────────────');
  console.log('Threshold | Passa | Bloq | PnL passa   | PnL bloq   | WR% passa | WR% bloq | Δ PnL vs sem filtro');
  console.log('----------|-------|------|-------------|------------|-----------|----------|--------------------');

  const pnlAll = valid.reduce((s, r) => s + r.pnlUsdt, 0);
  const wrAll = valid.length ? (wins.length / valid.length * 100) : null;
  console.log(`(sem filtro) | ${String(valid.length).padStart(5)} |    — | ${fmtPnl(pnlAll)} |     —      | ${wrAll != null ? wrAll.toFixed(0) + '%' : '—'}       |    —     |          —`);

  for (const th of THRESHOLDS) {
    const pass = valid.filter(r => r.rsi5m > th);
    const block = valid.filter(r => r.rsi5m <= th);
    const pnlPass = pass.reduce((s, r) => s + r.pnlUsdt, 0);
    const pnlBlock = block.reduce((s, r) => s + r.pnlUsdt, 0);
    const wrPass = pass.length ? (pass.filter(r => r.pnlUsdt >= 0).length / pass.length * 100) : null;
    const wrBlock = block.length ? (block.filter(r => r.pnlUsdt >= 0).length / block.length * 100) : null;
    const delta = pnlPass - pnlAll;
    console.log(
      `> ${String(th).padStart(6)} | ${String(pass.length).padStart(5)} | ${String(block.length).padStart(4)} | ${fmtPnl(pnlPass)} | ${fmtPnl(pnlBlock)} | ${(wrPass != null ? wrPass.toFixed(0) + '%' : '—').padStart(9)} | ${(wrBlock != null ? wrBlock.toFixed(0) + '%' : '—').padStart(8)} | ${(delta >= 0 ? '+' : '') + delta.toFixed(2)}`,
    );
  }

  // ── Distribuição por faixa ──────────────────────────────────────────────────
  const buckets = [
    { label: '<40',    min: -Infinity, max: 40 },
    { label: '40–50',  min: 40, max: 50 },
    { label: '50–60',  min: 50, max: 60 },
    { label: '60–70',  min: 60, max: 70 },
    { label: '70–80',  min: 70, max: 80 },
    { label: '>80',    min: 80, max: Infinity },
  ];
  console.log('\n── Distribuição: RSI 5m na entrada por faixa ─────────────────────────────────');
  console.log('Faixa   | Trades | Wins | WR%  | PnL USDT');
  console.log('--------|--------|------|------|----------');
  for (const b of buckets) {
    const inBucket = valid.filter(r => r.rsi5m > b.min && r.rsi5m <= b.max);
    if (!inBucket.length) continue;
    const w = inBucket.filter(r => r.pnlUsdt >= 0).length;
    const pnl = inBucket.reduce((s, r) => s + r.pnlUsdt, 0);
    const wr = (w / inBucket.length * 100).toFixed(0);
    console.log(`${b.label.padEnd(7)} | ${String(inBucket.length).padStart(6)} | ${String(w).padStart(4)} | ${wr.padStart(3)}% | ${fmtPnl(pnl).trim()}`);
  }

  console.log('\n');
}

main().catch(err => { console.error(err); process.exit(1); });
