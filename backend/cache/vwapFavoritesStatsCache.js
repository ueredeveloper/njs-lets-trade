'use strict';

// Cache read-through das estatísticas simuladas do vwap-bands (StatisticsPanel, aba "VWAP
// Bands") — mesmo padrão de backend/cache/mcFavoritesStatsCache.js, mas com o gate de
// favoritos olhando strategy_id='vwap-bands' em vez de 'ma-cross'.

const fs = require('node:fs/promises');
const path = require('path');
const atomicWriteFile = require('../utils/atomicWriteFile');
const supabase = require('../supabase/client');
const cacheSettings = require('./cacheSettings');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'vwap-bands-stats-cache.json');
const FAVORITES_TTL_MS = 5 * 60_000;

let favoritesSet = new Set();
let favoritesLoadedAt = 0;
let favoritesRefreshInFlight = null;

/** Map<cacheKey, { value, computedAt }> */
const store = new Map();
let dirty = false;

async function refreshFavorites() {
  try {
    const { data, error } = await supabase
      .from('multitrade_favorites')
      .select('symbol')
      .eq('strategy_id', 'vwap-bands');
    if (error) throw error;
    favoritesSet = new Set((data ?? []).map(r => String(r.symbol).toUpperCase()));
    favoritesLoadedAt = Date.now();
  } catch (err) {
    console.error('[vwapFavoritesStatsCache] refresh favoritos:', err.message);
  }
}

async function ensureFavoritesFresh() {
  if (Date.now() - favoritesLoadedAt < FAVORITES_TTL_MS) return;
  if (favoritesRefreshInFlight) return favoritesRefreshInFlight;
  favoritesRefreshInFlight = refreshFavorites().finally(() => { favoritesRefreshInFlight = null; });
  return favoritesRefreshInFlight;
}

/**
 * Executa `computeFn` com cache, mas só se `symbol` estiver no favorito vwap-bands — fora
 * dele, sempre recalcula (sem cachear buscas exploratórias de símbolos aleatórios digitados
 * no formulário).
 */
async function getOrCompute(symbol, cacheKey, ttlMs, computeFn) {
  if (!cacheSettings.isEnabled('vwapFavoritesStats')) {
    return { value: await computeFn(), cache: { hit: false, scope: 'disabled' } };
  }

  await ensureFavoritesFresh();

  if (!favoritesSet.has(symbol)) {
    return { value: await computeFn(), cache: { hit: false, scope: 'out-of-vwap' } };
  }

  const now = Date.now();
  const entry = store.get(cacheKey);
  if (entry && now - entry.computedAt < ttlMs) {
    return { value: entry.value, cache: { hit: true, ageMs: now - entry.computedAt } };
  }

  const value = await computeFn();
  store.set(cacheKey, { value, computedAt: now });
  dirty = true;
  await saveToDisk();
  return { value, cache: { hit: false, ageMs: 0 } };
}

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    store.clear();
    for (const [k, v] of Object.entries(data.entries ?? {})) store.set(k, v);
    dirty = false;
    console.log(`[vwapFavoritesStatsCache] disco → ${store.size} entradas`);
  } catch {
    console.log('[vwapFavoritesStatsCache] sem cache em disco');
  }
}

async function saveToDisk() {
  if (!dirty) return false;
  try {
    await atomicWriteFile(CACHE_FILE, JSON.stringify({ entries: Object.fromEntries(store) }));
    dirty = false;
    return true;
  } catch (err) {
    console.error('[vwapFavoritesStatsCache] saveToDisk:', err.message);
    return false;
  }
}

module.exports = {
  getOrCompute,
  loadFromDisk,
  saveToDisk,
};
