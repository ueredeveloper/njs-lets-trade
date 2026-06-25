'use strict';

const fs   = require('node:fs/promises');
const path = require('path');
const getCandles = require('../binance/getCandles');
const { computeMaTimeAbovePct } = require('../utils/maTimeAbovePct');

const CANDLES_LIMIT = 3000;
const BATCH_SIZE    = 15;
const CACHE_FILE    = path.join(__dirname, '..', 'data', 'ma-time-above-cache.json');

const REFRESH_TTL_MS = {
  '1m':   60_000,
  '3m':   180_000,
  '5m':   300_000,
  '15m':  900_000,
  '30m':  1_800_000,
  '1h':   3_600_000,
  '2h':   7_200_000,
  '4h':   14_400_000,
  '6h':   21_600_000,
  '8h':   28_800_000,
  '12h':  43_200_000,
  '1d':   86_400_000,
  '3d':   259_200_000,
  '1w':   604_800_000,
};

/** Map<"SYMBOL-interval-period", { pctAboveMa, met, total, computedAt }> */
const store = new Map();
let dirty = false;

function cacheKey(symbol, interval, period) {
  return `${symbol}-${interval}-${period}`;
}

function needsRefresh(symbol, interval, period) {
  const entry = store.get(cacheKey(symbol, interval, period));
  if (!entry?.computedAt) return true;
  const ttl = REFRESH_TTL_MS[interval] ?? 60 * 60_000;
  return Date.now() - entry.computedAt >= ttl;
}

async function compute(symbol, interval, period) {
  try {
    const candles = await getCandles(symbol, interval, CANDLES_LIMIT);
    const result  = computeMaTimeAbovePct(candles, period);
    if (!result) return false;

    store.set(cacheKey(symbol, interval, period), {
      ...result,
      computedAt: Date.now(),
    });
    dirty = true;
    return true;
  } catch {
    return false;
  }
}

function get(symbol, interval, period) {
  return store.get(cacheKey(symbol, interval, period)) ?? null;
}

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const snapshot = JSON.parse(raw);
    for (const [key, entry] of Object.entries(snapshot)) {
      store.set(key, entry);
    }
    dirty = false;
    console.log(`[maTimeAboveCache] disco → ${store.size} entradas`);
    return store.size;
  } catch {
    console.log('[maTimeAboveCache] sem cache em disco');
    return 0;
  }
}

async function saveToDisk() {
  if (!dirty) return false;
  try {
    const snapshot = Object.fromEntries(store);
    await fs.writeFile(CACHE_FILE, JSON.stringify(snapshot));
    dirty = false;
    return true;
  } catch (err) {
    console.error('[maTimeAboveCache] saveToDisk:', err.message);
    return false;
  }
}

/**
 * Garante pctAboveMa em cache para todos os símbolos (só recalcula expirados).
 */
async function ensureAll(symbols, interval, period, { force = false, concurrency = BATCH_SIZE } = {}) {
  const stale = force
    ? symbols
    : symbols.filter(s => needsRefresh(s, interval, period));

  let computed = 0;
  let failed   = 0;

  for (let i = 0; i < stale.length; i += concurrency) {
    const batch = stale.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(s => compute(s, interval, period)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) computed++;
      else failed++;
    }
  }

  if (computed > 0) await saveToDisk();

  return {
    total: symbols.length,
    cached: symbols.length - stale.length,
    computed,
    failed,
    stale: stale.length,
  };
}

module.exports = {
  get,
  compute,
  ensureAll,
  loadFromDisk,
  saveToDisk,
  needsRefresh,
  REFRESH_TTL_MS,
};
