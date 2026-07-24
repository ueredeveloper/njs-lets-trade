'use strict';

// Cache read-through das estatísticas de RSI / MA-Cross / Bollinger (StatisticsPanel) — só para
// símbolos que estão no favorito ma-cross (multitrade_favorites, strategy_id='ma-cross', "MC").
// Diferente dos outros caches em backend/cache/ (presets fixos, warmup em lote), aqui a chave e o
// TTL vêm dos parâmetros que a própria rota recebeu na query string — ou seja, os mesmos
// intervalos/parâmetros já selecionados no formulário do painel, sem preset hardcoded.

const fs = require('node:fs/promises');
const path = require('path');
const supabase = require('../supabase/client');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'mc-stats-cache.json');
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
      .eq('strategy_id', 'ma-cross');
    if (error) throw error;
    favoritesSet = new Set((data ?? []).map(r => String(r.symbol).toUpperCase()));
    favoritesLoadedAt = Date.now();
  } catch (err) {
    console.error('[mcFavoritesStatsCache] refresh favoritos:', err.message);
  }
}

async function ensureFavoritesFresh() {
  if (Date.now() - favoritesLoadedAt < FAVORITES_TTL_MS) return;
  if (favoritesRefreshInFlight) return favoritesRefreshInFlight;
  favoritesRefreshInFlight = refreshFavorites().finally(() => { favoritesRefreshInFlight = null; });
  return favoritesRefreshInFlight;
}

/**
 * Executa `computeFn` com cache, mas só se `symbol` estiver no favorito MC — fora dele, sempre
 * recalcula (sem cachear buscas exploratórias de símbolos aleatórios digitados no formulário).
 */
async function getOrCompute(symbol, cacheKey, ttlMs, computeFn) {
  await ensureFavoritesFresh();

  if (!favoritesSet.has(symbol)) {
    return { value: await computeFn(), cache: { hit: false, scope: 'out-of-mc' } };
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
    console.log(`[mcFavoritesStatsCache] disco → ${store.size} entradas`);
  } catch {
    console.log('[mcFavoritesStatsCache] sem cache em disco');
  }
}

async function saveToDisk() {
  if (!dirty) return false;
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify({ entries: Object.fromEntries(store) }));
    dirty = false;
    return true;
  } catch (err) {
    console.error('[mcFavoritesStatsCache] saveToDisk:', err.message);
    return false;
  }
}

module.exports = {
  getOrCompute,
  loadFromDisk,
  saveToDisk,
};
