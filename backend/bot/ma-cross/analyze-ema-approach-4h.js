'use strict';
/**
 * Para todas as moedas favoritadas do ma-cross, varre ~90 dias de candles 4h e
 * localiza "aproximacoes" da EMA9 até a EMA21 (fundo local do gap %) seguidas
 * de alta (gap voltando a subir). Reporta a distribuicao de quao perto o gap
 * chegou antes de subir, pra sugerir um valor de approachPct pra regra nova
 * entryEmaApproach. Também mede o retorno de preco nos candles seguintes por
 * faixa de gap, pra validar que "chegar perto e subir" antecipa alta real.
 *
 * Uso: node backend/bot/ma-cross/analyze-ema-approach-4h.js
 *      node backend/bot/ma-cross/analyze-ema-approach-4h.js --days 90
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { buildMaTimeSeries } = require('../../utils/movingAverage');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DAYS_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--days');
const DAYS = DAYS_ARG ? Number(DAYS_ARG) : 90;
const FORWARD_CANDLES = 3; // 3 * 4h = 12h de retorno futuro pra validar a alta

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
  const out = [];
  let cursor = from;
  while (cursor < to) {
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${cursor}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) out.push({ openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2] });
    const last = Number(raw[raw.length - 1][0]);
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

/** Acha fundos locais do gap% EMA9/EMA21 seguidos de pelo menos 2 candles de alta do gap. */
function findApproachBounces(candles, gapSeries) {
  const events = [];
  for (let i = 2; i < gapSeries.length - FORWARD_CANDLES; i++) {
    const g = gapSeries[i];
    if (g == null) continue;
    const prev1 = gapSeries[i - 1];
    const prev2 = gapSeries[i - 2];
    const next1 = gapSeries[i + 1];
    const next2 = gapSeries[i + 2];
    if ([prev1, prev2, next1, next2].some(v => v == null)) continue;

    // fundo local: caiu nos 2 candles anteriores, sobe nos 2 seguintes
    const wasFalling = g <= prev1 && prev1 <= prev2;
    const isRising = next1 > g && next2 > next1;
    if (!wasFalling || !isRising) continue;
    // só interessa aproximacao real (nao cruzamentos profundos): gap do fundo entre -6% e +3%
    if (g < -6 || g > 3) continue;

    const entryPrice = candles[i].close;
    const fwdPrice = candles[i + FORWARD_CANDLES]?.close;
    const fwdReturnPct = fwdPrice != null ? ((fwdPrice - entryPrice) / entryPrice) * 100 : null;

    events.push({ idx: i, openTime: candles[i].openTime, gapPct: g, fwdReturnPct });
  }
  return events;
}

function bucketLabel(g) {
  if (g < -4) return '< -4%';
  if (g < -2) return '-4% a -2%';
  if (g < -1) return '-2% a -1%';
  if (g < 0) return '-1% a 0%';
  if (g < 1) return '0% a 1%';
  if (g < 2) return '1% a 2%';
  return '2% a 3%';
}

async function analyzeSymbol(symbol, exchange, startMs, endMs) {
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const candles = await fetcher(symbol, '4h', startMs, endMs);
  if (candles.length < 40) return [];

  const closes = candles.map(c => c.close);
  const ema9Arr = require('technicalindicators').EMA.calculate({ values: closes, period: 9 });
  const ema21Arr = require('technicalindicators').EMA.calculate({ values: closes, period: 21 });
  const offset9 = candles.length - ema9Arr.length;
  const offset21 = candles.length - ema21Arr.length;

  const gapSeries = candles.map((c, i) => {
    const e9 = i - offset9 >= 0 ? ema9Arr[i - offset9] : null;
    const e21 = i - offset21 >= 0 ? ema21Arr[i - offset21] : null;
    if (e9 == null || e21 == null || e21 === 0) return null;
    return ((e9 / e21) - 1) * 100;
  });

  return findApproachBounces(candles, gapSeries).map(ev => ({ ...ev, symbol }));
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const endMs = Date.now();
  const startMs = endMs - DAYS * 86_400_000;

  const states = await sbGet('rsi_multi_bot_state', '?strategy_id=eq.ma-cross&select=symbol,exchange');
  console.log(`\n═══ Aproximação EMA9→EMA21 (4h) — ${states.length} moedas, ${DAYS} dias ═══\n`);

  const allEvents = [];
  for (const s of states) {
    process.stderr.write(`  ${s.symbol}...`);
    try {
      const events = await analyzeSymbol(s.symbol, s.exchange, startMs, endMs);
      allEvents.push(...events);
      process.stderr.write(` ${events.length} evento(s)\n`);
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
    }
  }

  if (!allEvents.length) {
    console.log('Nenhum evento de aproximação encontrado.');
    return;
  }

  const gaps = allEvents.map(e => e.gapPct).sort((a, b) => a - b);
  console.log(`Total de eventos (fundo local do gap seguido de alta): ${allEvents.length}\n`);
  console.log('── Percentis do gap % no fundo (quão perto EMA9 chegou da EMA21 antes de subir) ──');
  for (const p of [10, 25, 40, 50, 60, 75, 90]) {
    console.log(`  p${p}: ${fmtPct(percentile(gaps, p))}`);
  }

  console.log('\n── Retorno de preço nos próximos 3 candles (12h) por faixa de gap no fundo ──');
  const buckets = new Map();
  for (const e of allEvents) {
    const label = bucketLabel(e.gapPct);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(e);
  }
  const order = ['< -4%', '-4% a -2%', '-2% a -1%', '-1% a 0%', '0% a 1%', '1% a 2%', '2% a 3%'];
  console.log('Faixa do gap  | Eventos | Retorno médio 12h | Win rate (retorno > 0)');
  console.log('--------------|---------|--------------------|-----------------------');
  for (const label of order) {
    const list = buckets.get(label);
    if (!list || !list.length) continue;
    const valid = list.filter(e => e.fwdReturnPct != null);
    const avg = valid.reduce((s, e) => s + e.fwdReturnPct, 0) / valid.length;
    const wins = valid.filter(e => e.fwdReturnPct > 0).length;
    console.log(
      `${label.padEnd(13)} | ${String(list.length).padStart(7)} | ${fmtPct(avg).padStart(18)} | ${(wins / valid.length * 100).toFixed(0).padStart(4)}%`,
    );
  }

  console.log(`\n── Sugestão ──`);
  const p50 = percentile(gaps, 50);
  const p60 = percentile(gaps, 60);
  console.log(`Mediana do gap no fundo: ${fmtPct(p50)}  |  p60: ${fmtPct(p60)}`);
  console.log(`Sugestão de approachPct: ${Math.max(0, Math.ceil(Math.abs(Math.min(p60, 0)) * 10) / 10 || 1)}% (cobre a maioria dos fundos que antecederam alta)`);
}

main().catch(err => { console.error(err); process.exit(1); });
