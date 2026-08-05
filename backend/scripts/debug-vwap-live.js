'use strict';

/**
 * Debug: imprime preço ao vivo + níveis VWAP (lower2/lower1/vwap/upper1/upper2) calculados
 * com o mesmo código de produção (strategyEngine.js), com timestamp — pra comparar direto
 * com o que o gráfico mostra no hover, no mesmo instante.
 *
 * Uso:
 *   node backend/scripts/debug-vwap-live.js BANKUSDT gate weekly 4h
 *   node backend/scripts/debug-vwap-live.js BANKUSDT gate daily 4h
 */

require('dotenv').config();
const { gateRequest } = require('../gate/getGateClient');
const { fetchBinanceCandles, fetchBinanceCurrentPrice } = require('../bot/prices');
const { toGateSymbol } = require('../utils/toGateSymbol');
const { computeVwapSeries, vwapPointAt, levelsAt } = require('../bot/vwap-bands/strategyEngine');

function closedCandlesOnly(candles) {
  return candles?.length >= 2 ? candles.slice(0, -1) : candles ?? [];
}

function normalizeGate(raw) {
  return raw
    .map(c => ({
      openTime: Number(c[0]) * 1000,
      open: parseFloat(c[5]), high: parseFloat(c[3]), low: parseFloat(c[4]),
      close: parseFloat(c[2]), volume: parseFloat(c[1]),
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

async function fetchGate4h(symbol) {
  const pair = toGateSymbol(symbol);
  const [ticker, raw4h] = await Promise.all([
    gateRequest('GET', '/spot/tickers', { currency_pair: pair }),
    gateRequest('GET', '/spot/candlesticks', { currency_pair: pair, interval: '4h', limit: '200' }),
  ]);
  return { price: parseFloat(ticker[0].last), candles4h: normalizeGate(raw4h) };
}

async function fetchBinance4h(symbol) {
  const [price, candles4h] = await Promise.all([
    fetchBinanceCurrentPrice(symbol),
    fetchBinanceCandles(symbol, 200, '4h'),
  ]);
  return { price, candles4h };
}

function fmt(n) {
  return n == null || Number.isNaN(n) ? '-' : n.toFixed(6);
}

async function main() {
  const symbol   = process.argv[2] || 'BANKUSDT';
  const exchange = (process.argv[3] || 'gate').toLowerCase();
  const sessions = process.argv[4] ? [process.argv[4]] : ['weekly', 'daily'];

  const { price, candles4h } = exchange === 'binance'
    ? await fetchBinance4h(symbol)
    : await fetchGate4h(symbol);

  const closed4h = closedCandlesOnly(candles4h);
  const last = closed4h[closed4h.length - 1];
  const now = new Date().toISOString();

  console.log('========================================');
  console.log(`[${now}] ${symbol} (${exchange})`);
  console.log(`PREÇO AO VIVO: ${price}`);
  console.log(`último candle 4h fechado: ${new Date(last.openTime).toISOString()} close=${last.close}`);
  console.log('========================================');

  for (const session of sessions) {
    const series = computeVwapSeries(closed4h, session);
    const pt = vwapPointAt(series, last.openTime);
    const lv = levelsAt(pt);
    const pctToVwap = lv.vwap !== lv.lower1 ? (((price - lv.lower1) / (lv.vwap - lv.lower1)) * 100).toFixed(1) : '-';
    console.log('');
    console.log(`[${now}] session=${session}`);
    console.log(`  lower2 : ${fmt(lv.lower2)}`);
    console.log(`  lower1 : ${fmt(lv.lower1)}`);
    console.log(`  vwap   : ${fmt(lv.vwap)}`);
    console.log(`  upper1 : ${fmt(lv.upper1)}`);
    console.log(`  upper2 : ${fmt(lv.upper2)}`);
    console.log(`  preço está a ${pctToVwap}% do caminho entre lower1 e vwap`);
  }
  console.log('========================================');
}

main().catch(err => { console.error('ERR', err.message); process.exit(1); });
