'use strict';
/**
 * Funil de entrada do ma-cross: para cada cruzamento real EMA9↑EMA21 em 15m
 * (histórico, não apenas trades já executados), verifica quantos passariam por
 * cada filtro de entrada — tendência HTF 4h, Bollinger 4h (%B) e a regra nova
 * de aproximação EMA9→EMA21 4h — isolados e combinados. Serve pra medir se
 * empilhar BB + aproximação deixa a entrada rara demais.
 *
 * Uso: node backend/bot/ma-cross/analyze-entry-funnel.js
 *      node backend/bot/ma-cross/analyze-entry-funnel.js --days 45
 *      node backend/bot/ma-cross/analyze-entry-funnel.js --approach 1.5 --bbmax 0.3
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { normalizeMaCrossConfig, toEngineConfig } = require('./tradeConfigSchema');
const { evaluateEntryTrendMa, evaluateEntryBbFilter, evaluateEntryEmaApproach } = require('./strategyEngine');
const { EMA } = require('technicalindicators');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DAYS_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--days');
const DAYS = DAYS_ARG ? Number(DAYS_ARG) : 45;
const APPROACH_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--approach');
const APPROACH_PCT = APPROACH_ARG ? Number(APPROACH_ARG) : 1.5;
const BBMAX_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--bbmax');
const BBMAX = BBMAX_ARG ? Number(BBMAX_ARG) : 0.3;

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
    await new Promise(r => setTimeout(r, 40));
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
    await new Promise(r => setTimeout(r, 40));
  }
  return out;
}

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function pct(n, d) {
  return d ? `${(n / d * 100).toFixed(0)}%` : '—';
}

/** Índices onde EMA9(15m) cruza acima da EMA21(15m) (candles fechados, consecutivos). */
function findCrossUps(candles) {
  const closes = candles.map(c => c.close);
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const off9 = candles.length - ema9.length;
  const off21 = candles.length - ema21.length;
  const events = [];
  for (let i = Math.max(off9, off21) + 1; i < candles.length; i++) {
    const g = ema9[i - off9], gp = ema9[i - 1 - off9];
    const l = ema21[i - off21], lp = ema21[i - 1 - off21];
    if (gp == null || lp == null || g == null || l == null) continue;
    if (gp <= lp && g > l) events.push(i);
  }
  return events;
}

async function analyzeSymbol(symbol, exchange, startMs, endMs, cfg) {
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const [c15, c4h] = await Promise.all([
    fetcher(symbol, '15m', startMs, endMs),
    fetcher(symbol, '4h', startMs - 10 * 86_400_000, endMs),
  ]);
  if (c15.length < 30 || c4h.length < 30) return [];

  const crossIdx = findCrossUps(c15);
  const results = [];
  for (const i of crossIdx) {
    const crossTime = c15[i].openTime;
    // candles 4h fechados antes do cruzamento + 1 "aberto" (o evaluate* dropa o último via closedCandlesOnly)
    const c4hSlice = c4h.filter(c => c.openTime <= crossTime);
    if (c4hSlice.length < 25) continue;
    const cMap = { '4h': c4hSlice };

    const trend = evaluateEntryTrendMa(cfg, cMap, { closedOnly: true });
    const bb = evaluateEntryBbFilter(cfg, cMap, { closedOnly: true });
    const approach = evaluateEntryEmaApproach(cfg, cMap, { closedOnly: true });

    results.push({
      symbol, crossTime,
      trendOk: trend.allowed, bbOk: bb.allowed, approachOk: approach.allowed,
    });
  }
  return results;
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const endMs = Date.now();
  const startMs = endMs - DAYS * 86_400_000;

  const cfg = toEngineConfig(normalizeMaCrossConfig({
    entryBbFilter:    { enabled: true, maxPctB: BBMAX },
    entryEmaApproach: { enabled: true, approachPct: APPROACH_PCT },
  }));

  const states = await sbGet('rsi_multi_bot_state', '?strategy_id=eq.ma-cross&select=symbol,exchange');
  console.log(`\n═══ Funil de entrada ma-cross — ${states.length} moedas, ${DAYS} dias ═══`);
  console.log(`Cruzamentos EMA9↑EMA21 (15m) → tendência 4h (tol ${cfg.entryTrendMa.tolerancePct}%) → BB 4h (%B<=${BBMAX}) → aproximação 4h (<=${APPROACH_PCT}%)\n`);

  const all = [];
  for (const s of states) {
    process.stderr.write(`  ${s.symbol}...`);
    try {
      const r = await analyzeSymbol(s.symbol, s.exchange, startMs, endMs, cfg);
      all.push(...r);
      process.stderr.write(` ${r.length} cruzamento(s)\n`);
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
    }
  }

  const total = all.length;
  const passTrend = all.filter(r => r.trendOk);
  const passTrendBb = passTrend.filter(r => r.bbOk);
  const passTrendApproach = passTrend.filter(r => r.approachOk);
  const passTrendBbApproach = passTrend.filter(r => r.bbOk && r.approachOk);

  console.log('── Funil (a partir dos cruzamentos que já passam na tendência 4h) ──');
  console.log(`Total de cruzamentos EMA9↑EMA21 (15m):        ${total}`);
  console.log(`  passam tendência 4h:                        ${passTrend.length} (${pct(passTrend.length, total)})`);
  console.log(`    + passam BB 4h também:                    ${passTrendBb.length} (${pct(passTrendBb.length, passTrend.length)} dos que passam tendência)`);
  console.log(`    + passam aproximação 4h também:           ${passTrendApproach.length} (${pct(passTrendApproach.length, passTrend.length)} dos que passam tendência)`);
  console.log(`    + passam BB *e* aproximação (funil atual + nova regra): ${passTrendBbApproach.length} (${pct(passTrendBbApproach.length, passTrend.length)} dos que passam tendência)`);

  console.log('\n── Sobreposição entre BB e aproximação (só nos que passam tendência) ──');
  const onlyBb = passTrend.filter(r => r.bbOk && !r.approachOk).length;
  const onlyApproach = passTrend.filter(r => !r.bbOk && r.approachOk).length;
  const both = passTrend.filter(r => r.bbOk && r.approachOk).length;
  const neither = passTrend.filter(r => !r.bbOk && !r.approachOk).length;
  console.log(`Só BB (aproximação bloquearia):      ${onlyBb}`);
  console.log(`Só aproximação (BB bloquearia):      ${onlyApproach}`);
  console.log(`Ambos passam:                        ${both}`);
  console.log(`Nenhum passa:                        ${neither}`);

  console.log(`\n── Taxa mensal aproximada (${DAYS} dias, ${states.length} moedas) ──`);
  const perMonth = n => (n / DAYS * 30).toFixed(1);
  console.log(`Entradas/mês só com tendência 4h:            ~${perMonth(passTrend.length)}`);
  console.log(`Entradas/mês com tendência + BB (atual):     ~${perMonth(passTrendBb.length)}`);
  console.log(`Entradas/mês com tendência + BB + aproximação: ~${perMonth(passTrendBbApproach.length)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
