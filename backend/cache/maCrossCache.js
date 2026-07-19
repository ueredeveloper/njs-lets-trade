'use strict';

const fs   = require('node:fs/promises');
const path = require('path');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { evaluateMaCrossSignal, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildMaCrossFilterName } = require('../utils/filterNames');

const CANDLES_LIMIT = 200;
const BATCH_SIZE    = 20;
const CACHE_FILE    = path.join(__dirname, '..', 'data', 'ma-cross-cache.json');

/** Preset cacheado (único): MA9×MA21 no 4h — cruzou ↑ (último candle) e próximo de cruzar ↑ (gap ≤0.5%). */
const CACHED_PRESETS = [
  {
    key: '4h|last',
    period1: 9, interval1: '4h',
    period2: 21, interval2: '4h',
    mode: 'cross_up',
    maxAgeMin: 'last',
    tolerancePct: 0.5,
    live: true,
  },
  {
    key: '4h|nearup',
    period1: 9, interval1: '4h',
    period2: 21, interval2: '4h',
    mode: 'near_up',
    maxAgeMin: 'last',
    tolerancePct: 0,
    proximityPct: 0.5,
    live: true,
  },
];

/** Tick do servidor — verifica o que venceu; TTL real é o intervalo do candle (5m/15m) */
const REFRESH_TICK_MS = 5 * 60_000;

/** @deprecated use REFRESH_TICK_MS */
const PRESET_TTL_MS = REFRESH_TICK_MS;

/** @deprecated */
const CACHED_PRESET_BASE = CACHED_PRESETS[0];
const CACHED_AGE_MIN = CACHED_PRESETS.map(p => p.key);
const DEFAULT_PRESET = { ...CACHED_PRESETS[0] };

/** Map<"presetKey|symbol", { matched, ageMin, detail, computedAt }> */
const symbolStore = new Map();
/** Map<presetKey, snapshot> */
const snapshots = new Map();
let refreshInFlight = null;
let dirty = false;

function finestInterval(iv1, iv2) {
  return intervalMs(iv1) <= intervalMs(iv2) ? iv1 : iv2;
}

function presetTtlMs(preset) {
  return intervalMs(preset.interval1);
}

function presetFilterName(preset) {
  const sig = finestInterval(preset.interval1, preset.interval2);
  const opts = preset.mode.startsWith('near')
    ? { proximityPct: preset.proximityPct ?? 0.5 }
    : { maxAgeMin: preset.maxAgeMin, tolerancePct: preset.tolerancePct };
  return buildMaCrossFilterName(sig, preset.period1, preset.interval1, preset.period2, preset.interval2, preset.mode, opts);
}

function findPreset(key) {
  return CACHED_PRESETS.find(p => p.key === String(key)) ?? null;
}

function storeKey(presetKey, symbol) {
  return `${presetKey}|${symbol}`;
}

function paramsMatchPreset(params, preset) {
  const liveOk = params.live === true || params.live === '1' || params.live === 'true' || params.live == null;
  const base = liveOk
    && params.period1 === preset.period1
    && params.period2 === preset.period2
    && params.interval1 === preset.interval1
    && params.interval2 === preset.interval2
    && params.mode === preset.mode;

  if (!base) return false;

  if (preset.mode.startsWith('near')) {
    const prox = Math.round(parseFloat(params.proximityPct ?? 1) * 10) / 10;
    const presetProx = Math.round(parseFloat(preset.proximityPct ?? 1) * 10) / 10;
    return prox === presetProx;
  }

  const tol = Math.round(parseFloat(params.tolerancePct ?? 0) * 10) / 10;
  return String(params.maxAgeMin) === preset.maxAgeMin && tol === preset.tolerancePct;
}

function matchesCachedPreset(params) {
  for (const preset of CACHED_PRESETS) {
    if (paramsMatchPreset(params, preset)) return preset.key;
  }
  return null;
}

function matchesDefaultPreset(params) {
  return matchesCachedPreset(params) != null;
}

function buildDetail(symbol, r, mode) {
  const dir = mode.includes('down') ? 'down' : 'up';
  const detail = { kind: r.kind ?? 'crossed', direction: dir };
  if (r.ageMin != null) detail.ageMin = Math.round(r.ageMin * 10) / 10;
  if (r.gapPct != null) detail.gapPct = Math.round(r.gapPct * 100) / 100;
  if (r.crossTime != null) detail.crossTime = r.crossTime;
  return { symbol, ...detail };
}

function needsRefresh(presetKey, symbol) {
  const preset = findPreset(presetKey);
  if (!preset) return true;
  const entry = symbolStore.get(storeKey(presetKey, symbol));
  if (!entry?.computedAt) return true;
  return Date.now() - entry.computedAt >= presetTtlMs(preset);
}

function evaluateSymbolWithCandles(symbol, preset, candles, now = Date.now()) {
  const minCandles = Math.max(preset.period1, preset.period2) + 5;
  const key = storeKey(preset.key, symbol);

  try {
    if (!candles?.length || candles.length < minCandles) {
      symbolStore.set(key, { matched: false, ageMin: null, detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const r = evaluateMaCrossSignal({
      candles1: candles, period1: preset.period1, interval1: preset.interval1,
      candles2: candles, period2: preset.period2, interval2: preset.interval2,
      mode: preset.mode,
      tolerancePct: preset.tolerancePct,
      proximityPct: preset.proximityPct ?? 1,
      maxAgeMin: preset.maxAgeMin,
      closedOnly: true,
      now,
    });

    const detail = r.matched ? buildDetail(symbol, r, preset.mode) : null;
    symbolStore.set(key, {
      matched: r.matched,
      ageMin: r.ageMin ?? null,
      detail,
      computedAt: now,
    });
    dirty = true;
    return r.matched;
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

function buildSnapshotForPreset(preset, now = Date.now()) {
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

  matched.sort((a, b) => {
    if (a.gapPct != null && b.gapPct != null) return a.gapPct - b.gapPct;
    if (a.ageMin != null && b.ageMin != null) return a.ageMin - b.ageMin;
    return 0;
  });

  const snap = {
    name: presetFilterName(preset),
    list: matched.map(r => r.symbol),
    details,
    mode: preset.mode,
    maxAgeMin: preset.maxAgeMin,
    live: preset.live,
    period1: preset.period1,
    interval1: preset.interval1,
    period2: preset.period2,
    interval2: preset.interval2,
    tolerancePct: preset.tolerancePct,
    proximityPct: preset.proximityPct,
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

  for (const preset of CACHED_PRESETS) {
    const stale = force
      ? symbols
      : symbols.filter(s => needsRefresh(preset.key, s));
    staleTotal += stale.length;

    const minCandles = Math.max(preset.period1, preset.period2) + 5;
    const limit = Math.max(CANDLES_LIMIT, minCandles + 10);

    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const { candles, source } = await loadCandlesForScreening(
            symbol, preset.interval1, limit, candleSession,
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

async function getCachedResult(symbols, presetKey, { force = false } = {}) {
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
        cache: { hit: true, ageMs: age, preset: key, rebuilt: true },
      };
    }
  }

  if (force || !hasSnapshot || age >= staleMs) {
    const stats = await ensureFresh(symbols, { force: false });
    const fresh = snapshots.get(key);
    return { ...fresh, cache: { ...stats, hit: false, ageMs: 0, preset: key } };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[maCrossCache] refresh:', err.message));
  }

  return {
    ...snap,
    cache: {
      hit: true,
      ageMs: age,
      preset: key,
      matched: snap.list.length,
      total: symbols.length,
    },
  };
}

async function getDefaultPresetResult(symbols, opts = {}) {
  return getCachedResult(symbols, '4h|last', opts);
}

async function refreshSymbols(symbols, opts = {}) {
  return refreshAll(symbols, opts);
}

function buildSnapshot(now = Date.now()) {
  return buildSnapshotForPreset(CACHED_PRESETS[0], now);
}

function buildSnapshotForAge(maxAgeMin, now = Date.now()) {
  const preset = findPreset(maxAgeMin);
  return preset ? buildSnapshotForPreset(preset, now) : null;
}

function migrateLegacyDiskData() {
  const validKeys = new Set(CACHED_PRESETS.map(p => p.key));
  let legacySymbols = false;

  for (const storeK of symbolStore.keys()) {
    const ok = [...validKeys].some(pk => storeK.startsWith(`${pk}|`));
    if (!ok) {
      legacySymbols = true;
      break;
    }
  }

  for (const snapKey of [...snapshots.keys()]) {
    if (!validKeys.has(snapKey)) snapshots.delete(snapKey);
  }

  if (legacySymbols) {
    symbolStore.clear();
    snapshots.clear();
    dirty = true;
    console.log('[maCrossCache] cache legado (presets antigos) descartado — será recalculado do disco');
  }
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

    migrateLegacyDiskData();

    dirty = false;
    const counts = CACHED_PRESETS.map(p => {
      const iv = p.interval1;
      return `${iv}≤${p.maxAgeMin}m:${snapshots.get(p.key)?.list?.length ?? 0}`;
    }).join(' ');
    console.log(`[maCrossCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[maCrossCache] sem cache em disco');
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
    console.error('[maCrossCache] saveToDisk:', err.message);
    return false;
  }
}

module.exports = {
  CACHED_PRESETS,
  CACHED_PRESET_BASE,
  CACHED_AGE_MIN,
  DEFAULT_PRESET,
  REFRESH_TICK_MS,
  PRESET_TTL_MS,
  matchesCachedPreset,
  matchesDefaultPreset,
  getCachedResult,
  getDefaultPresetResult,
  refreshAll,
  refreshSymbols,
  ensureFresh,
  loadFromDisk,
  saveToDisk,
  buildSnapshot,
  buildSnapshotForAge,
  buildSnapshotForPreset,
  evaluateSymbolWithCandles,
};
