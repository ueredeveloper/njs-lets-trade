'use strict';
/**
 * Avalia impacto de usar Bollinger Bands 4h como filtro de entrada no MA-Cross.
 * Critério base do usuário: low do candle 4h deve tocar a banda inferior
 *   no candle atual OU nos 2 anteriores ao momento de entrada.
 * Compara múltiplas variantes para encontrar o melhor critério.
 *
 * Uso: node backend/bot/ma-cross/analyze-bb-week.js
 *      node backend/bot/ma-cross/analyze-bb-week.js --from 2026-07-07
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { BollingerBands } = require('technicalindicators');
const { toGateSymbol }   = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const IV_4H_MS = 4 * 3_600_000;
const BB_PERIOD = 20;
const BB_WARMUP = BB_PERIOD + 5;

// ── Variantes a comparar ────────────────────────────────────────────────────
// lookback: quantos candles 4h anteriores (0 = só o atual)
// stdDev: largura das bandas
// touch: 'low' (mínima toca banda) | 'close' (fechamento abaixo da banda)
const VARIANTS = [
  { id: 'bb_touch_0',    label: 'BB(20,2)  low toca — só candle atual',          lookback: 0, stdDev: 2.0, touch: 'low'   },
  { id: 'bb_touch_1',    label: 'BB(20,2)  low toca — atual ou 1 anterior',       lookback: 1, stdDev: 2.0, touch: 'low'   },
  { id: 'bb_touch_2',    label: 'BB(20,2)  low toca — atual ou 2 anteriores ★',   lookback: 2, stdDev: 2.0, touch: 'low'   },
  { id: 'bb_touch_3',    label: 'BB(20,2)  low toca — atual ou 3 anteriores',     lookback: 3, stdDev: 2.0, touch: 'low'   },
  { id: 'bb_close_2',   label: 'BB(20,2)  close abaixo — atual ou 2 ant.',        lookback: 2, stdDev: 2.0, touch: 'close' },
  { id: 'bb_touch_2_25', label: 'BB(20,2.5) low toca — atual ou 2 anteriores',   lookback: 2, stdDev: 2.5, touch: 'low'   },
  { id: 'bb_touch_2_15', label: 'BB(20,1.5) low toca — atual ou 2 anteriores',   lookback: 2, stdDev: 1.5, touch: 'low'   },
];

// ── Supabase ────────────────────────────────────────────────────────────────
async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Candles ─────────────────────────────────────────────────────────────────
async function fetchBinanceRange(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${cursor}&limit=500`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      const t = Number(c[0]);
      if (t > endMs) break;
      out.push({ openTime: t, high: +c[2], low: +c[3], close: +c[4] });
    }
    const last = Number(raw[raw.length - 1][0]);
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

async function fetchGateRange(symbol, startMs, endMs) {
  const pair  = toGateSymbol(symbol);
  const from  = Math.floor(startMs / 1000);
  const to    = Math.floor(endMs   / 1000);
  const url   = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=4h&from=${from}&to=${to}&limit=500`;
  const raw   = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    openTime: Number(c[0]) * 1000,
    high: +c[3], low: +c[4], close: +c[2],
  }));
}

const candleCache = new Map();

async function get4hCandles(exchange, symbol, entryMs) {
  const key = `${exchange}:${symbol}`;
  if (!candleCache.has(key)) {
    const pad    = (BB_WARMUP + 5) * IV_4H_MS;
    const start  = entryMs - pad;
    const end    = Date.now() + IV_4H_MS;
    const fetch4 = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
    candleCache.set(key, await fetch4(symbol, start, end));
  }
  return candleCache.get(key);
}

// ── BB ───────────────────────────────────────────────────────────────────────
function computeBbAt(candles, entryMs, stdDev) {
  // Candle 4h que contém o momento de entrada
  const idx = candles.findLastIndex(c => c.openTime <= entryMs);
  if (idx < BB_WARMUP) return null;

  const slice  = candles.slice(0, idx + 1);
  const closes = slice.map(c => c.close);
  const bb     = BollingerBands.calculate({ period: BB_PERIOD, values: closes, stdDev });
  if (!bb.length) return null;

  // Retorna banda inferior para cada candle a partir de idx-(lookback máximo+1)
  const maxLookback = 3;
  const result = [];
  for (let back = 0; back <= maxLookback; back++) {
    const ci  = idx - back;
    const bbi = bb.length - 1 - back;
    if (bbi < 0 || ci < 0) break;
    result.push({
      candle:    candles[ci],
      lower:     bb[bbi].lower,
      middle:    bb[bbi].middle,
      distPct:   ((candles[ci].close - bb[bbi].lower) / bb[bbi].lower) * 100,
    });
  }
  return result; // [0]=atual, [1]=1 anterior, ...
}

function checkVariant(bbPoints, variant) {
  if (!bbPoints?.length) return { pass: false, reason: 'sem dados BB' };
  const pts = bbPoints.slice(0, variant.lookback + 1);
  for (const pt of pts) {
    const val = variant.touch === 'low' ? pt.candle.low : pt.candle.close;
    if (val <= pt.lower) return { pass: true, distPct: pt.distPct };
  }
  // Guarda distância mínima da banda (candle mais próximo)
  const minDist = Math.min(...pts.map(p => p.distPct));
  return { pass: false, minDistPct: minDist };
}

// ── Formatação ───────────────────────────────────────────────────────────────
function weekStartMs() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();
  const now = new Date();
  const diff = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - diff);
  return mon.getTime();
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

// ── Sumário de variante ──────────────────────────────────────────────────────
function summarizeVariant(results, variant) {
  const closed = results.filter(r => r.closed && !r.error);
  const pass   = closed.filter(r => r.variants[variant.id]?.pass);
  const block  = closed.filter(r => !r.variants[variant.id]?.pass);

  const pnlAll  = closed.reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const pnlPass = pass.reduce((s, r)  => s + (r.pnlUsdt ?? 0), 0);
  const pnlBlk  = block.reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const wPass   = pass.filter(r  => r.pnlUsdt >= 0).length;
  const wBlk    = block.filter(r => r.pnlUsdt >= 0).length;
  const wrPass  = pass.length  ? (wPass  / pass.length  * 100) : null;
  const wrBlk   = block.length ? (wBlk   / block.length * 100) : null;
  const wrAll   = closed.length ? (closed.filter(r => r.pnlUsdt >= 0).length / closed.length * 100) : null;

  return { pnlAll, pnlPass, pnlBlk, pass: pass.length, block: block.length, total: closed.length, wPass, wBlk, wrPass, wrBlk, wrAll };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_KEY) { console.error('SUPABASE_URL / KEY ausentes'); process.exit(1); }

  const fromMs  = weekStartMs();
  const fromIso = new Date(fromMs).toISOString();
  console.log(`\n═══ Bollinger Bands 4h — filtro de entrada MA-Cross ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)}\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&order=entry_time.asc`,
  );

  if (!trades.length) { console.log('Nenhum trade ma-cross neste período.'); return; }
  console.log(`${trades.length} trades encontrados\n`);

  // ── Avalia cada trade ──────────────────────────────────────────────────────
  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    const entryMs = new Date(t.entry_time).getTime();
    const exchange = t.exchange ?? 'binance';
    const pnl      = t.pnl_usdt != null ? +t.pnl_usdt : null;
    const closed   = t.exit_time != null && pnl != null;

    let variantResults = {};
    let bbPoints = null;
    let error = null;

    try {
      const candles = await get4hCandles(exchange, t.symbol, entryMs);
      // Tenta std=2.5 para cache de pontos (o maior lookback possível)
      bbPoints = computeBbAt(candles, entryMs, 2.5);

      for (const v of VARIANTS) {
        // Recalcula BB com o stdDev correto para cada variante
        const pts = computeBbAt(candles, entryMs, v.stdDev);
        variantResults[v.id] = checkVariant(pts, v);
      }
      process.stderr.write(' ok\n');
    } catch (err) {
      error = err.message;
      process.stderr.write(` erro: ${err.message}\n`);
      for (const v of VARIANTS) variantResults[v.id] = { pass: false, reason: 'erro' };
    }

    // Distância atual da banda inferior (stdDev=2, candle mais recente)
    const distNow = bbPoints?.[0]?.distPct ?? null;

    results.push({
      symbol: t.symbol,
      exchange,
      entryMs,
      pnlUsdt: pnl,
      closed,
      open: !closed,
      error,
      bbPoints,
      distNow,
      variants: variantResults,
    });
  }

  // ── Tabela comparativa de variantes ──────────────────────────────────────
  console.log('\n── Comparativo de critérios ──────────────────────────────────────────────────────');
  console.log('Variante                                         | Entram | Bloq | PnL entram  | PnL bloq   | WR% entram | WR% bloq | Δ vs sem filtro');
  console.log('-------------------------------------------------|--------|------|-------------|------------|------------|----------|----------------');

  const closed = results.filter(r => r.closed && !r.error);
  const pnlReal = closed.reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const wrReal  = closed.length ? closed.filter(r => r.pnlUsdt >= 0).length / closed.length * 100 : null;

  console.log(`${'(sem filtro — todos os trades)'.padEnd(48)} | ${String(closed.length).padStart(6)} |    — | ${fmtPnl(pnlReal)} |     —      | ${wrReal != null ? wrReal.toFixed(0)+'%' : '—'}        |    —     |       —`);

  for (const v of VARIANTS) {
    const s = summarizeVariant(results, v);
    const delta = s.pnlPass - s.pnlAll;
    const wrPassStr = s.wrPass != null ? `${s.wrPass.toFixed(0)}%` : '—';
    const wrBlkStr  = s.wrBlk  != null ? `${s.wrBlk.toFixed(0)}%`  : '—';
    const deltaStr  = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
    const star      = v.id === 'bb_touch_2' ? ' ★' : '';
    console.log(
      `${(v.label + star).padEnd(48)} | ${String(s.pass).padStart(6)} | ${String(s.block).padStart(4)} | ${fmtPnl(s.pnlPass)} | ${fmtPnl(s.pnlBlk)} | ${wrPassStr.padStart(10)} | ${wrBlkStr.padStart(8)} | ${deltaStr.padStart(15)}`,
    );
  }

  // ── Detalhe trade a trade (critério base do usuário: bb_touch_2) ──────────
  const BASE = 'bb_touch_2';
  console.log(`\n── Detalhe por trade — critério base (${VARIANTS.find(v => v.id === BASE).label}) ──`);
  console.log('Símbolo     | Entrada (BRT)       | PnL USDT | BB4h dist% | Passa BB? | Ação');
  console.log('------------|---------------------|----------|------------|-----------|------');
  for (const r of results) {
    if (r.error) {
      console.log(`${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${r.closed ? fmtPnl(r.pnlUsdt).trim() : 'aberto  '} | erro       | —         | ${r.error}`);
      continue;
    }
    const v   = r.variants[BASE];
    const dist = r.distNow != null ? `+${r.distNow.toFixed(1)}%` : '—';
    const pnlStr = r.open ? 'aberto  ' : `${pnlColor(r.pnlUsdt)}${fmtPnl(r.pnlUsdt).trim()}${RESET}`;
    const passStr = v?.pass ? '\x1b[32mSIM\x1b[0m' : '\x1b[31mNÃO\x1b[0m';
    const acao = v?.pass
      ? (r.closed ? (r.pnlUsdt >= 0 ? 'entrada OK → lucro' : 'entrada OK → perda') : 'entrada OK → aberto')
      : (r.closed
          ? (r.pnlUsdt >= 0 ? `EVITARIA lucro (dist ${r.distNow?.toFixed(1) ?? '?'}%)` : `EVITARIA perda (dist ${r.distNow?.toFixed(1) ?? '?'}%)`)
          : `não entraria (dist ${r.distNow?.toFixed(1) ?? '?'}%)`);
    console.log(`${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${pnlStr.padStart(8)} | ${dist.padStart(10)} | ${passStr.padStart(9)}  | ${acao}`);
  }

  // ── Diagnóstico dos trades bloqueados ────────────────────────────────────
  const blocked = results.filter(r => r.closed && !r.error && !r.variants[BASE]?.pass);
  if (blocked.length) {
    const lossesEvited = blocked.filter(r => r.pnlUsdt < 0);
    const gainsLost    = blocked.filter(r => r.pnlUsdt >= 0);
    console.log(`\n── Trades bloqueados pelo critério base (${blocked.length} total) ──`);
    console.log(`  Perdas evitadas: ${lossesEvited.length} (${lossesEvited.reduce((s,r)=>s+r.pnlUsdt,0).toFixed(2)} USDT)`);
    console.log(`  Ganhos perdidos: ${gainsLost.length} (${gainsLost.reduce((s,r)=>s+r.pnlUsdt,0).toFixed(2)} USDT)`);
  }

  // ── Distribuição de distância da banda ──────────────────────────────────
  const withDist = results.filter(r => r.distNow != null && r.closed);
  if (withDist.length) {
    const buckets = [
      { label: '≤0% (tocou/rompeu)',  min: -Infinity, max: 0 },
      { label: '0–2%',               min: 0,          max: 2 },
      { label: '2–5%',               min: 2,          max: 5 },
      { label: '5–10%',              min: 5,          max: 10 },
      { label: '>10%',               min: 10,         max: Infinity },
    ];
    console.log('\n── Distribuição: distância do close atual à banda inferior BB(20,2) 4h ──');
    console.log('Faixa              | Trades | Wins | PnL USDT');
    console.log('-------------------|--------|------|----------');
    for (const b of buckets) {
      const inBucket = withDist.filter(r => r.distNow > b.min && r.distNow <= b.max);
      const wins     = inBucket.filter(r => r.pnlUsdt >= 0).length;
      const pnl      = inBucket.reduce((s,r) => s + r.pnlUsdt, 0);
      if (!inBucket.length) continue;
      console.log(`${b.label.padEnd(18)} | ${String(inBucket.length).padStart(6)} | ${String(wins).padStart(4)} | ${fmtPnl(pnl).trim()}`);
    }
  }

  console.log('\n');
}

main().catch(err => { console.error(err); process.exit(1); });
