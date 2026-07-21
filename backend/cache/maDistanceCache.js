'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { computeMa } = require('../utils/movingAverage');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildMaDistanceFilterName, parseCompareToken } = require('../utils/filterNames');

const CANDLES_LIMIT = 200;
const BATCH_SIZE = 20;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'ma-distance-cache.json');

const CACHED_INTERVAL = '4h';
const CACHED_PERIODS = [9, 21, 50, 200];
const CACHED_COMPARES = ['above', 'below'];

/** Presets: distância do preço vs EMA9/21/50/200 no 4h (acima e abaixo). */
const CACHED_PRESETS = CACHED_PERIODS.flatMap((period) => CACHED_COMPARES.map((compare) => ({
  key: `${CACHED_INTERVAL}|${period}|${compare === 'above' ? 'acim' : 'abaix'}`,
  interval: CACHED_INTERVAL,
  period,
  compare,
})));

const REFRESH_TICK_MS = 5 * 60_000;
/** Espera no máximo isso por um refresh síncrono antes de devolver algo parcial/stale — a fila
 *  de candles é global (1 fetch/2.5s) e compartilhada com os outros caches, então um backlog
 *  grande não pode travar a resposta HTTP indefinidamente. */
const BLOCKING_WAIT_MS = 8_000;

/** Map<"presetKey|symbol", { matched, gapPct, detail, computedAt }> */
const symbolStore = new Map();
/** Map<presetKey, snapshot> */
const snapshots = new Map();
let refreshInFlight = null;
let dirty = false;

function presetTtlMs(preset) {
  return intervalMs(preset.interval);
}

function presetFilterName(preset, lang = 'pt') {
  return buildMaDistanceFilterName(preset.interval, preset.period, preset.compare, lang);
}

function findPreset(key) {
  return CACHED_PRESETS.find(p => p.key === String(key)) ?? null;
}

function storeKey(presetKey, symbol) {
  return `${presetKey}|${symbol}`;
}

function normalizeCompare(compare) {
  return parseCompareToken(compare) ?? (compare === 'bellow' ? 'below' : 'above');
}

function matchesCachedPreset(params) {
  const interval = params.interval;
  const period = parseInt(params.period, 10);
  const compare = normalizeCompare(params.compare);

  for (const preset of CACHED_PRESETS) {
    if (preset.interval === interval && preset.period === period && preset.compare === compare) {
      return preset.key;
    }
  }
  return null;
}

function buildDetail(symbol, gapPct, ma, price) {
  return {
    symbol,
    gapPct,
    absGapPct: Math.abs(gapPct),
    ma,
    price,
    direction: gapPct >= 0 ? 'up' : 'down',
  };
}

function needsRefresh(presetKey, symbol) {
  const preset = findPreset(presetKey);
  if (!preset) return true;
  const entry = symbolStore.get(storeKey(presetKey, symbol));
  if (!entry?.computedAt) return true;
  return Date.now() - entry.computedAt >= presetTtlMs(preset);
}

function evaluateSymbolWithCandles(symbol, preset, candles, now = Date.now()) {
  const minCandles = preset.period + 5;
  const key = storeKey(preset.key, symbol);

  try {
    if (!candles?.length || candles.length < minCandles) {
      symbolStore.set(key, { matched: false, gapPct: null, detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const ma = computeMa(candles, preset.period);
    const close = parseFloat(candles[candles.length - 1].close);
    if (ma == null || ma <= 0 || !Number.isFinite(close)) {
      symbolStore.set(key, { matched: false, gapPct: null, detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const gapPct = Math.round(((close / ma) - 1) * 10000) / 100;
    const isAbove = gapPct >= 0;
    const matched = preset.compare === 'above' ? isAbove : !isAbove;
    const detail = matched ? buildDetail(symbol, gapPct, ma, close) : null;

    symbolStore.set(key, { matched, gapPct, detail, computedAt: now });
    dirty = true;
    return matched;
  } catch {
    return false;
  }
}

async function loadCandlesForScreening(symbol, interval, limit, sessionCache) {
  const cacheKey = `${symbol}|${interval}`;
  if (sessionCache.has(cacheKey)) return sessionCache.get(cacheKey);

  const result = await getCandlesForScreening(symbol, interval, limit);
  sessionCache.set(cacheKey, result);
  return result;
}

function buildSnapshotForPreset(preset, now = Date.now(), lang = 'pt') {
  const matched = [];
  const details = {};
  const prefix = `${preset.key}|`;

  for (const [key, entry] of symbolStore) {
    if (!key.startsWith(prefix)) continue;
    if (!entry?.matched || !entry.detail) continue;
    matched.push(entry.detail);
    const { symbol: sym, ...meta } = entry.detail;
    details[sym] = meta;
  }

  matched.sort((a, b) => b.absGapPct - a.absGapPct);

  const snap = {
    name: presetFilterName(preset, lang),
    list: matched.map(r => r.symbol),
    details,
    interval: preset.interval,
    period: preset.period,
    compare: preset.compare,
    scannedAt: now,
  };
  snapshots.set(preset.key, snap);
  return snap;
}

function rebuildAllSnapshots(now = Date.now()) {
  for (const preset of CACHED_PRESETS) {
    buildSnapshotForPreset(preset, now);
  }
}

function snapshotAgeMs(presetKey) {
  const snap = snapshots.get(String(presetKey));
  if (!snap?.scannedAt) return Infinity;
  return Date.now() - snap.scannedAt;
}

async function refreshAll(symbols, { force = false } = {}) {
  const now = Date.now();
  let computed = 0;
  let failed = 0;
  let staleTotal = 0;
  let diskHits = 0;
  let diskStale = 0;
  let apiFetches = 0;
  const candleSession = new Map();
  // Limite único (maior período + margem) — o cache de candles por sessão é chaveado só por
  // símbolo+intervalo (reaproveitado entre presets), então precisa cobrir o maior período de
  // todos os presets ou o preset de período maior fica sem candles suficientes.
  const maxPeriod = Math.max(...CACHED_PERIODS);
  const sharedLimit = Math.max(CANDLES_LIMIT, maxPeriod + 15);

  for (const preset of CACHED_PRESETS) {
    const stale = force
      ? symbols
      : symbols.filter(s => needsRefresh(preset.key, s));
    staleTotal += stale.length;

    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const { candles, source } = await loadCandlesForScreening(
            symbol, preset.interval, sharedLimit, candleSession,
          );
          if (source === 'disk') diskHits++;
          else if (source === 'disk-stale') diskStale++;
          else apiFetches++;
          return evaluateSymbolWithCandles(symbol, preset, candles, now);
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') computed++;
        else failed++;
      }
    }
  }

  rebuildAllSnapshots(now);
  if (computed > 0) await saveToDisk();

  const counts = {};
  for (const preset of CACHED_PRESETS) {
    counts[preset.key] = snapshots.get(preset.key)?.list?.length ?? 0;
  }

  return {
    total: symbols.length,
    cached: symbols.length * CACHED_PRESETS.length - staleTotal,
    computed,
    failed,
    stale: staleTotal,
    matched: counts,
    diskHits,
    diskStale,
    apiFetches,
    queuePending: candleUpdateQueue.getStats().pending,
  };
}

async function ensureFresh(symbols, { force = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAll(symbols, { force }).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function getCachedResult(symbols, presetKey, { force = false, lang = 'pt' } = {}) {
  const key = String(presetKey);
  const preset = findPreset(key);
  if (!preset) return null;

  const age = snapshotAgeMs(key);
  const snap = snapshots.get(key);
  const hasSnapshot = snap && Array.isArray(snap.list);
  const staleMs = presetTtlMs(preset) * 2;

  if (!hasSnapshot && symbolStore.size > 0) {
    rebuildAllSnapshots();
    const rebuilt = snapshots.get(key);
    if (rebuilt) {
      return {
        ...rebuilt,
        name: presetFilterName(preset, lang),
        cache: { hit: true, ageMs: age, preset: key, rebuilt: true },
      };
    }
  }

  if (force || !hasSnapshot || age >= staleMs) {
    const refreshPromise = ensureFresh(symbols, { force });
    const timedOut = await Promise.race([
      refreshPromise.then(() => false),
      new Promise(resolve => setTimeout(() => resolve(true), BLOCKING_WAIT_MS)),
    ]);
    refreshPromise.catch(err => console.error('[maDistanceCache] refresh:', err.message));

    if (!timedOut) {
      const stats = await refreshPromise;
      const fresh = buildSnapshotForPreset(preset, Date.now(), lang);
      return { ...fresh, cache: { ...stats, hit: false, ageMs: 0, preset: key } };
    }

    // Refresh ainda rodando (fila de candles com backlog/ban) — não trava a resposta.
    // Continua calculando em background; devolve o que já tiver, mesmo parcial/vazio.
    const partial = buildSnapshotForPreset(preset, Date.now(), lang);
    return {
      ...partial,
      name: presetFilterName(preset, lang),
      cache: { hit: false, ageMs: age, preset: key, pending: true },
    };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[maDistanceCache] refresh:', err.message));
  }

  return {
    ...snap,
    name: presetFilterName(preset, lang),
    cache: {
      hit: true,
      ageMs: age,
      preset: key,
      matched: snap.list.length,
      total: symbols.length,
    },
  };
}

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);

    symbolStore.clear();
    snapshots.clear();

    if (data.symbols) {
      for (const [k, entry] of Object.entries(data.symbols)) {
        symbolStore.set(k, entry);
      }
    }

    if (data.snapshots) {
      for (const [k, snap] of Object.entries(data.snapshots)) {
        snapshots.set(k, snap);
      }
    }

    dirty = false;
    const counts = CACHED_PRESETS.map(p =>
      `${p.key}:${snapshots.get(p.key)?.list?.length ?? 0}`,
    ).join(' ');
    console.log(`[maDistanceCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[maDistanceCache] sem cache em disco');
    return 0;
  }
}

async function saveToDisk() {
  if (!dirty) return false;
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify({
      presets: CACHED_PRESETS,
      symbols: Object.fromEntries(symbolStore),
      snapshots: Object.fromEntries(snapshots),
    }));
    dirty = false;
    return true;
  } catch (err) {
    console.error('[maDistanceCache] saveToDisk:', err.message);
    return false;
  }
}

module.exports = {
  CACHED_PRESETS,
  REFRESH_TICK_MS,
  matchesCachedPreset,
  getCachedResult,
  refreshAll,
  ensureFresh,
  loadFromDisk,
  saveToDisk,
  buildSnapshotForPreset,
  evaluateSymbolWithCandles,
};
