const { RSI } = require('technicalindicators');
const getCandles = require('../binance/getCandles');
const fs   = require('node:fs/promises');
const path = require('path');

const CANDLES_LIMIT  = 200;
const BATCH_SIZE     = 10;
const CACHE_FILE     = path.join(__dirname, '..', 'data', 'rsi-cache.json');

// Map<"SYMBOL-INTERVAL", { rsi, values, lastCandle, computedAt }>
const store = new Map();

function calcRSI(candles) {
  return RSI.calculate({ values: candles.map(c => parseFloat(c.close)), period: 14 });
}

function buildEntry(candles) {
  const values = calcRSI(candles);
  if (!values || values.length === 0) return null;
  const last = candles[candles.length - 1];
  return {
    rsi: values[values.length - 1],
    values: values.slice(-20),
    lastCandle: { open: last.open, high: last.high, low: last.low, close: last.close },
    computedAt: Date.now(),
  };
}

async function compute(symbol, interval) {
  const candles = await getCandles(symbol, interval, CANDLES_LIMIT);
  if (!Array.isArray(candles) || candles.length < 15) return;

  const entry = buildEntry(candles);
  if (!entry) return;

  store.set(`${symbol}-${interval}`, entry);
}

function get(symbol, interval) {
  return store.get(`${symbol}-${interval}`) ?? null;
}

// Armazena a partir de candles já buscados (evita re-fetch no fallback)
function storeFromCandles(symbol, interval, candles) {
  if (!Array.isArray(candles) || candles.length < 15) return;
  const entry = buildEntry(candles);
  if (!entry) return;
  store.set(`${symbol}-${interval}`, entry);
}

function size() {
  return store.size;
}

// Carrega o arquivo consolidado salvo no disco e preenche o Map
async function loadFromDisk() {
  const t0 = Date.now();
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const snapshot = JSON.parse(raw);
    for (const [key, entry] of Object.entries(snapshot)) {
      store.set(key, entry);
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[rsiCache] disco → ${store.size} entradas em ${elapsed}s`);
    return store.size;
  } catch {
    console.log('[rsiCache] sem cache em disco — será gerado no primeiro warmup');
    return 0;
  }
}

// Grava o Map inteiro em um único arquivo JSON (chamado após warmup)
async function saveToDisk() {
  const t0 = Date.now();
  try {
    const snapshot = Object.fromEntries(store);
    await fs.writeFile(CACHE_FILE, JSON.stringify(snapshot));
    const kb = (Buffer.byteLength(JSON.stringify(snapshot)) / 1024).toFixed(0);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[rsiCache] salvo em disco — ${store.size} entradas, ${kb} KB, ${elapsed}s`);
  } catch (err) {
    console.error('[rsiCache] saveToDisk:', err.message);
  }
}

async function warmup(symbols, intervals) {
  const t0 = Date.now();
  const total = symbols.length * intervals.length;
  let done = 0;

  for (const interval of intervals) {
    const tInt = Date.now();
    let added = 0;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const before = store.size;
      await Promise.allSettled(
        batch.map(s => compute(s, interval).catch(() => {}))
      );
      added += store.size - before;
      done  += batch.length;
    }

    const pct     = ((done / total) * 100).toFixed(0);
    const elapsed = ((Date.now() - tInt) / 1000).toFixed(1);
    console.log(`[rsiCache] ${interval.padStart(3)} — ${added} novos | total ${store.size} | ${pct}% | ${elapsed}s`);
  }

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[rsiCache] warmup completo — ${store.size}/${total} entradas em ${totalElapsed}s`);
}

module.exports = { get, compute, storeFromCandles, loadFromDisk, saveToDisk, warmup, size };
