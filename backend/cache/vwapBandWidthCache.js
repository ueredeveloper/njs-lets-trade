'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const { computeRollingVwapWithBands, DAY_MS } = require('../utils/vwapSession');

const WEEK_MS = 7 * DAY_MS;
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildVwapBandWidthFilterName } = require('../utils/filterNames');
const cacheSettings = require('./cacheSettings');

const BATCH_SIZE = 20;
const MIN_CANDLES = 10;
const BAND_MULTIPLIER = 2;
// Histórico extra além do lookback, pra VWAP ter ancoragem de sessão completa já nos
// primeiros candles da janela (ver mesmo comentário em fetchVwapBandWidthFilter.js).
const EXTRA_HISTORY_CANDLES = 200;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'vwap-band-width-cache.json');

/** Presets pré-aquecidos: combinação padrão do painel (4h, sessão semanal) nos dois
 *  tamanhos de janela mais usados (100 e 200 candles). */
const CACHED_PRESETS = [
  { key: '4h|w|100', interval: '4h', session: 'weekly', lookback: 100 },
  { key: '4h|w|200', interval: '4h', session: 'weekly', lookback: 200 },
];

const REFRESH_TICK_MS = 5 * 60_000;

/** Map<"presetKey|symbol", { detail, computedAt }> — detail é null quando não há dados suficientes. */
const symbolStore = new Map();
/** Map<presetKey, snapshot> — snapshot.list sempre ordenado das bandas mais distantes pras mais próximas. */
const snapshots = new Map();
let refreshInFlight = null;
let dirty = false;

function presetTtlMs(preset) {
  return intervalMs(preset.interval);
}

function presetFilterName(preset) {
  return buildVwapBandWidthFilterName(preset.interval, preset.session, preset.lookback);
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
    && params.lookback === preset.lookback;
}

function matchesCachedPreset(params) {
  if (!cacheSettings.isEnabled('vwapBandWidth')) return null;
  const interval = params.interval;
  const session = params.session === 'daily' ? 'daily' : 'weekly';
  const lookback = parseInt(params.lookback, 10);

  for (const preset of CACHED_PRESETS) {
    if (paramsMatchPreset({ interval, session, lookback }, preset)) {
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
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const points = computeRollingVwapWithBands(candles, { windowMs: preset.session === 'weekly' ? WEEK_MS : DAY_MS, bandMultipliers: [BAND_MULTIPLIER] });
    if (!points.length) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const window = points.slice(-Math.min(preset.lookback, points.length));
    const widths = [];
    for (const p of window) {
      const upper = p[`upper${BAND_MULTIPLIER}`];
      const lower = p[`lower${BAND_MULTIPLIER}`];
      if (upper == null || lower == null || !(p.value > 0)) continue;
      widths.push(((upper - lower) / p.value) * 100);
    }
    if (!widths.length) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const avgWidthPct = widths.reduce((s, v) => s + v, 0) / widths.length;
    const lastCandle = candles[candles.length - 1];

    const detail = {
      symbol,
      avgWidthPct: Math.round(avgWidthPct * 100) / 100,
      lastWidthPct: Math.round(widths[widths.length - 1] * 100) / 100,
      minWidthPct: Math.round(Math.min(...widths) * 100) / 100,
      maxWidthPct: Math.round(Math.max(...widths) * 100) / 100,
      samples: widths.length,
      close: parseFloat(lastCandle.close),
    };

    symbolStore.set(key, { detail, computedAt: now });
    dirty = true;
    return true;
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
    if (!entry?.detail) continue;
    matched.push(entry.detail);
    const { symbol: sym, ...meta } = entry.detail;
    details[sym] = meta;
  }

  matched.sort((a, b) => b.avgWidthPct - a.avgWidthPct);

  const snap = {
    name: presetFilterName(preset),
    list: matched.map(r => r.symbol),
    details,
    interval: preset.interval,
    session: preset.session,
    lookback: preset.lookback,
    bandMultiplier: BAND_MULTIPLIER,
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

    const limit = preset.lookback + EXTRA_HISTORY_CANDLES;
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const { candles, source } = await loadCandlesForScreening(
            symbol, preset.interval, limit, candleSession,
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

/** @param {'far'|'near'} order */
function applyOrder(snap, order) {
  if (order !== 'near') return snap;
  return { ...snap, list: snap.list.slice().reverse() };
}

async function getCachedResult(symbols, presetKey, { force = false, order = 'far' } = {}) {
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
        ...applyOrder(rebuilt, order),
        name: presetFilterName(preset),
        cache: { hit: true, ageMs: age, preset: key, rebuilt: true },
      };
    }
  }

  if (force || !hasSnapshot || age >= staleMs) {
    const stats = await ensureFresh(symbols, { force: false });
    const fresh = buildSnapshotForPreset(preset, Date.now());
    return { ...applyOrder(fresh, order), cache: { ...stats, hit: false, ageMs: 0, preset: key } };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[vwapBandWidthCache] refresh:', err.message));
  }

  return {
    ...applyOrder(snap, order),
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
    console.log(`[vwapBandWidthCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[vwapBandWidthCache] sem cache em disco');
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
    console.error('[vwapBandWidthCache] saveToDisk:', err.message);
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
