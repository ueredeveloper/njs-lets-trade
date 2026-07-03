const { RSI } = require('technicalindicators');
const { calculateMa } = require('../utils/movingAverage');
const getCandles = require('../binance/getCandles');
const fs   = require('node:fs/promises');
const path = require('path');

const CANDLES_LIMIT = 200;
const BATCH_SIZE    = 10;
const CACHE_FILE    = path.join(__dirname, '..', 'data', 'rsi-cache.json');

// TTL ≈ duração do candle — só refetch quando o RSI pode ter mudado
const REFRESH_TTL_MS = {
  '15m': 15 * 60_000,
  '1h':  60 * 60_000,
  '4h':  4 * 60 * 60_000,
};

// Map<"SYMBOL-INTERVAL", { rsi, values, lastCandle, computedAt }>
const store = new Map();
let dirty = false;

function cacheKey(symbol, interval) {
  return `${symbol}-${interval}`;
}

function calcRSI(candles) {
  return RSI.calculate({ values: candles.map(c => parseFloat(c.close)), period: 14 });
}

function buildEntry(candles) {
  const closes = candles.map(c => parseFloat(c.close));
  const values = calcRSI(candles);
  if (!values || values.length === 0) return null;
  const last = candles[candles.length - 1];

  let ma50 = null;
  if (closes.length >= 50) {
    const maArr = calculateMa(closes, 50);
    if (maArr.length) ma50 = maArr[maArr.length - 1];
  }

  return {
    rsi: values[values.length - 1],
    values: values.slice(-20),
    ma50,
    lastCandle: { open: last.open, high: last.high, low: last.low, close: last.close },
    computedAt: Date.now(),
  };
}

function needsRefresh(symbol, interval) {
  const entry = store.get(cacheKey(symbol, interval));
  if (!entry?.computedAt) return true;
  const ttl = REFRESH_TTL_MS[interval] ?? 60 * 60_000;
  return Date.now() - entry.computedAt >= ttl;
}

async function compute(symbol, interval) {
  const candles = await getCandles(symbol, interval, CANDLES_LIMIT);
  if (!Array.isArray(candles) || candles.length < 15) return false;

  const entry = buildEntry(candles);
  if (!entry) return false;

  store.set(cacheKey(symbol, interval), entry);
  dirty = true;
  return true;
}

function get(symbol, interval) {
  return store.get(cacheKey(symbol, interval)) ?? null;
}

function storeFromCandles(symbol, interval, candles) {
  if (!Array.isArray(candles) || candles.length < 15) return;
  const entry = buildEntry(candles);
  if (!entry) return;
  store.set(cacheKey(symbol, interval), entry);
  dirty = true;
}

function size() {
  return store.size;
}

function purgeStale(symbols, intervals) {
  const valid = new Set();
  for (const s of symbols) {
    for (const iv of intervals) valid.add(cacheKey(s, iv));
  }
  let removed = 0;
  for (const key of store.keys()) {
    if (!valid.has(key)) {
      store.delete(key);
      removed++;
    }
  }
  if (removed > 0) dirty = true;
  return removed;
}

async function loadFromDisk() {
  const t0 = Date.now();
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const snapshot = JSON.parse(raw);
    for (const [key, entry] of Object.entries(snapshot)) {
      store.set(key, entry);
    }
    dirty = false;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[rsiCache] disco → ${store.size} entradas em ${elapsed}s`);
    return store.size;
  } catch {
    console.log('[rsiCache] sem cache em disco — será gerado no primeiro warmup');
    return 0;
  }
}

async function saveToDisk() {
  if (!dirty) return false;
  const t0 = Date.now();
  try {
    const snapshot = Object.fromEntries(store);
    await fs.writeFile(CACHE_FILE, JSON.stringify(snapshot));
    const kb = (Buffer.byteLength(JSON.stringify(snapshot)) / 1024).toFixed(0);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[rsiCache] salvo em disco — ${store.size} entradas, ${kb} KB, ${elapsed}s`);
    dirty = false;
    return true;
  } catch (err) {
    console.error('[rsiCache] saveToDisk:', err.message);
    return false;
  }
}

async function warmup(symbols, intervals) {
  const t0 = Date.now();
  const purged = purgeStale(symbols, intervals);
  const expected = symbols.length * intervals.length;
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const interval of intervals) {
    const tInt = Date.now();
    let intRefreshed = 0;
    let intSkipped = 0;

    const stale = symbols.filter(s => needsRefresh(s, interval));
    intSkipped = symbols.length - stale.length;

    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(s => compute(s, interval)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) intRefreshed++;
        else if (r.status === 'rejected') failed++;
      }
    }

    refreshed += intRefreshed;
    skipped   += intSkipped;
    const elapsed = ((Date.now() - tInt) / 1000).toFixed(1);
    if (stale.length === 0) {
      console.log(`[rsiCache] ${interval.padStart(3)} — skip (fresco)`);
    } else {
      console.log(`[rsiCache] ${interval.padStart(3)} — ${intRefreshed} atualizados, ${intSkipped} skip | ${elapsed}s`);
    }
  }

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const purgeNote = purged > 0 ? `, ${purged} obsoletos removidos` : '';
  if (refreshed === 0) {
    console.log(`[rsiCache] nada a atualizar — ${store.size}/${expected} entradas frescas${purgeNote} (${totalElapsed}s)`);
  } else {
    console.log(`[rsiCache] warmup — ${refreshed} atualizados, ${skipped} skip, ${failed} falhas | ${store.size}/${expected} entradas${purgeNote} em ${totalElapsed}s`);
  }

  return { refreshed, skipped, failed, purged, size: store.size, expected };
}

module.exports = {
  get, compute, storeFromCandles, loadFromDisk, saveToDisk, warmup, size,
  REFRESH_TTL_MS,
};
