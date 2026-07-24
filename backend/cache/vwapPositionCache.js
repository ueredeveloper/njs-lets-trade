'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const { computeVwapWithBands } = require('../utils/vwapSession');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildVwapPositionFilterName } = require('../utils/filterNames');

const CANDLES_LIMIT = 500;
const BATCH_SIZE = 20;
const MIN_CANDLES = 10;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'vwap-position-cache.json');

/** Presets: exaustão nas bandas de VWAP (sessão diária, ±2σ) — igual ao default do painel Analisar Indicadores. */
const CACHED_PRESETS = [
  {
    key: '1h|d|2|bot|20',
    interval: '1h',
    session: 'daily',
    bandMultiplier: 2,
    position: 'near_bottom',
    proximityPct: 20,
  },
  {
    key: '1h|d|2|top|20',
    interval: '1h',
    session: 'daily',
    bandMultiplier: 2,
    position: 'near_top',
    proximityPct: 20,
  },
];

const REFRESH_TICK_MS = 5 * 60_000;

/** Map<"presetKey|symbol", { matched, percentV, detail, computedAt }> */
const symbolStore = new Map();
/** Map<presetKey, snapshot> */
const snapshots = new Map();
let refreshInFlight = null;
let dirty = false;

function presetTtlMs(preset) {
  return intervalMs(preset.interval);
}

function presetFilterName(preset) {
  return buildVwapPositionFilterName(preset.interval, preset.session, preset.bandMultiplier, preset.position, preset.proximityPct);
}

function findPreset(key) {
  return CACHED_PRESETS.find(p => p.key === String(key)) ?? null;
}

function storeKey(presetKey, symbol) {
  return `${presetKey}|${symbol}`;
}

function paramsMatchPreset(params, preset) {
  return params.interval === preset.interval
    && params.session === preset.session
    && params.bandMultiplier === preset.bandMultiplier
    && params.position === preset.position
    && params.proximityPct === preset.proximityPct;
}

function matchesCachedPreset(params) {
  const interval = params.interval;
  const session = params.session === 'weekly' ? 'weekly' : 'daily';
  const bandMultiplier = parseInt(params.bandMultiplier, 10);
  const position = params.position === 'near_top' ? 'near_top' : 'near_bottom';
  const proximityPct = Math.round(parseFloat(params.proximityPct) * 10) / 10;

  for (const preset of CACHED_PRESETS) {
    if (paramsMatchPreset({ interval, session, bandMultiplier, position, proximityPct }, preset)) {
      return preset.key;
    }
  }
  return null;
}

function needsRefresh(presetKey, symbol) {
  const preset = findPreset(presetKey);
  if (!preset) return true;
  const entry = symbolStore.get(storeKey(presetKey, symbol));
  if (!entry?.computedAt) return true;
  return Date.now() - entry.computedAt >= presetTtlMs(preset);
}

function evaluateSymbolWithCandles(symbol, preset, rawCandles, now = Date.now()) {
  const key = storeKey(preset.key, symbol);

  try {
    const candles = closedCandlesOnly(rawCandles);
    if (!candles?.length || candles.length < MIN_CANDLES) {
      symbolStore.set(key, { matched: false, percentV: null, detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const points = computeVwapWithBands(candles, { session: preset.session, bandMultipliers: [preset.bandMultiplier] });
    if (!points.length) {
      symbolStore.set(key, { matched: false, percentV: null, detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const last = points[points.length - 1];
    const upper = last[`upper${preset.bandMultiplier}`];
    const lower = last[`lower${preset.bandMultiplier}`];
    const width = upper - lower;
    if (!(width > 0)) {
      symbolStore.set(key, { matched: false, percentV: null, detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const close = parseFloat(candles[candles.length - 1].close);
    const percentV = Math.round(Math.min(100, Math.max(0, ((close - lower) / width) * 100)) * 100) / 100;
    const matched = preset.position === 'near_bottom'
      ? percentV <= preset.proximityPct
      : percentV >= 100 - preset.proximityPct;

    const detail = matched
      ? { symbol, percentV, close, vwap: last.value, upper, lower }
      : null;

    symbolStore.set(key, { matched, percentV, detail, computedAt: now });
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

  matched.sort((a, b) => (
    preset.position === 'near_bottom' ? a.percentV - b.percentV : b.percentV - a.percentV
  ));

  const snap = {
    name: presetFilterName(preset),
    list: matched.map(r => r.symbol),
    details,
    interval: preset.interval,
    session: preset.session,
    bandMultiplier: preset.bandMultiplier,
    position: preset.position,
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

    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const { candles, source } = await loadCandlesForScreening(
            symbol, preset.interval, CANDLES_LIMIT, candleSession,
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
        name: presetFilterName(preset),
        cache: { hit: true, ageMs: age, preset: key, rebuilt: true },
      };
    }
  }

  if (force || !hasSnapshot || age >= staleMs) {
    const stats = await ensureFresh(symbols, { force: false });
    const fresh = buildSnapshotForPreset(preset, Date.now());
    return { ...fresh, cache: { ...stats, hit: false, ageMs: 0, preset: key } };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[vwapPositionCache] refresh:', err.message));
  }

  return {
    ...snap,
    name: presetFilterName(preset),
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
    console.log(`[vwapPositionCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[vwapPositionCache] sem cache em disco');
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
    console.error('[vwapPositionCache] saveToDisk:', err.message);
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
