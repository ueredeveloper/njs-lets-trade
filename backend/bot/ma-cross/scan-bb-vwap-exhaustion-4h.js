'use strict';
/**
 * Varre todos os pares USDT ativos na Binance e reporta quais estão em
 * exaustão (BB %B <= proximityPct E VWAP %V <= proximityPct, 4h, "near_bottom")
 * em algum dos candles de 4h fechados nas últimas `--hours` horas.
 *
 * Somente leitura — não grava nada, não usa o servidor Express nem o Supabase.
 *
 * Uso: node backend/bot/ma-cross/scan-bb-vwap-exhaustion-4h.js
 *      node backend/bot/ma-cross/scan-bb-vwap-exhaustion-4h.js --hours 8 --prox 20
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { BollingerBands } = require('technicalindicators');
const { computeRollingVwapWithBands, DAY_MS } = require('../../utils/vwapSession');
const { getActiveUsdtPairs } = require('../../binance/getActiveUsdtPairs');

const HOURS_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--hours');
const HOURS = HOURS_ARG ? Number(HOURS_ARG) : 8;
const PROX_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--prox');
const PROX = PROX_ARG ? Number(PROX_ARG) : 20;
const CONCURRENCY = 25;
const BB_PERIOD = 20, BB_STDDEV = 2, VWAP_BAND = 2;

async function fetchKlines4h(symbol, days = 6) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=${Math.ceil(days * 6) + 5}`;
  const raw = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) throw new Error(JSON.stringify(raw));
  return raw.map(c => ({
    openTime: Number(c[0]), open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5],
    closeTime: Number(c[6]),
  }));
}

function closedOnly(candles) {
  const now = Date.now();
  return candles.filter(c => c.closeTime <= now);
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) results.push(r.value); });
  }
  return results;
}

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function analyzeSymbol(symbol, sinceMs) {
  const raw = await fetchKlines4h(symbol);
  const candles = closedOnly(raw);
  if (candles.length < BB_PERIOD + 5) return null;

  const closes = candles.map(c => c.close);
  const bb = BollingerBands.calculate({ period: BB_PERIOD, values: closes, stdDev: BB_STDDEV });
  const bbOffset = candles.length - bb.length;
  const vwap = computeRollingVwapWithBands(candles, { windowMs: DAY_MS, bandMultipliers: [VWAP_BAND] });

  const hits = [];
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (c.closeTime < sinceMs) break;

    const bbi = i - bbOffset;
    if (bbi < 0) continue;
    const b = bb[bbi];
    const bWidth = b.upper - b.lower;
    if (!(bWidth > 0)) continue;
    const percentB = Math.min(100, Math.max(0, ((c.close - b.lower) / bWidth) * 100));

    const v = vwap[i];
    const vWidth = v[`upper${VWAP_BAND}`] - v[`lower${VWAP_BAND}`];
    if (!(vWidth > 0)) continue;
    const percentV = Math.min(100, Math.max(0, ((c.close - v[`lower${VWAP_BAND}`]) / vWidth) * 100));

    const bbHit = percentB <= PROX;
    const vwapHit = percentV <= PROX;
    if (bbHit && vwapHit) {
      hits.push({ closeTime: c.closeTime, percentB: +percentB.toFixed(1), percentV: +percentV.toFixed(1), close: c.close });
    }
  }

  if (!hits.length) return null;
  return { symbol, hits };
}

async function main() {
  const { list: symbols } = await getActiveUsdtPairs();
  const now = Date.now();
  const sinceMs = now - HOURS * 3_600_000;

  console.log(`\n═══ Exaustão BB + VWAP (4h, near_bottom, proximityPct<=${PROX}) — últimas ${HOURS}h ═══`);
  console.log(`Varrendo ${symbols.length} pares USDT na Binance...\n`);

  const results = await runWithConcurrency(symbols, s => analyzeSymbol(s, sinceMs).catch(() => null), CONCURRENCY);

  if (!results.length) {
    console.log('Nenhuma moeda em exaustão BB+VWAP (4h) nas últimas ' + HOURS + 'h.');
    return;
  }

  results.sort((a, b) => a.hits[0].percentB - b.hits[0].percentB);

  for (const r of results) {
    console.log(`${r.symbol}`);
    for (const h of r.hits) {
      console.log(`   candle ${fmtDt(h.closeTime)}   %B=${h.percentB}   %V=${h.percentV}   close=${h.close}`);
    }
  }
  console.log(`\nTotal: ${results.length} moeda(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
