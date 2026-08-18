'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const { computeRollingVwapWithBands } = require('../utils/vwapSession');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildVwapBandExpansionFilterName } = require('../utils/filterNames');
const cacheSettings = require('./cacheSettings');

const BATCH_SIZE = 20;
// Afastamento assimétrico: banda inferior -1σ até banda superior +2σ (mesmo cálculo do
// fetchVwapBandExpansionFilter.js).
const BAND_MULTIPLIERS = [1, 2];
const MIN_GAP_PCT = 0.05;
const WARMUP_BUFFER_CANDLES = 20;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'vwap-band-expansion-cache.json');

/** Preset pré-aquecido: combinação padrão do painel de indicadores (candle 15m, VWAP de 4h,
 *  squeeze nos últimos 10 candles). O `multiplier` fica fora do preset de propósito — cada
 *  símbolo já guarda seu ratio calculado, e o multiplier é só o corte aplicado em cima do
 *  snapshot completo na leitura (mesmo papel do `order` em vwapBandWidthCache). */
const CACHED_PRESETS = [
  { key: '15m|4h|10', interval: '15m', vwapInterval: '4h', lookback: 10 },
];

const REFRESH_TICK_MS = 5 * 60_000;

/** Map<"presetKey|symbol", { detail, computedAt }> — detail é null quando não há dados suficientes. */
const symbolStore = new Map();
/** Map<presetKey, snapshot> — snapshot.list sempre ordenado do maior ratio pro menor, sem filtrar por multiplier. */
const snapshots = new Map();
let refreshInFlight = null;
let dirty = false;

function presetTtlMs(preset) {
  return intervalMs(preset.interval);
}

function findPreset(key) {
  return CACHED_PRESETS.find(p => p.key === String(key)) ?? null;
}

function storeKey(presetKey, symbol) {
  return `${presetKey}|${symbol}`;
}

function paramsMatchPreset(params, preset) {
  return params.interval === preset.interval
    && params.vwapInterval === preset.vwapInterval
    && params.lookback === preset.lookback;
}

function matchesCachedPreset(params) {
  if (!cacheSettings.isEnabled('vwapBandExpansion')) return null;

  const interval = params.interval;
  const vwapInterval = params.vwapInterval;
  const lookback = parseInt(params.lookback, 10);

  for (const preset of CACHED_PRESETS) {
    if (paramsMatchPreset({ interval, vwapInterval, lookback }, preset)) {
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
    const windowMs = intervalMs(preset.vwapInterval);
    const windowCandles = Math.ceil(windowMs / intervalMs(preset.interval));
    const minCandles = Math.min(preset.lookback, 3);

    if (!candles?.length || candles.length < windowCandles + minCandles) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const points = computeRollingVwapWithBands(candles, { windowMs, bandMultipliers: BAND_MULTIPLIERS });
    if (!points.length) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const gaps = [];
    for (const p of points) {
      const upper = p.upper2;
      const lower = p.lower1;
      if (upper == null || lower == null || !(p.value > 0)) continue;
      gaps.push(((upper - lower) / p.value) * 100);
    }
    if (gaps.length < minCandles) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const window = gaps.slice(-Math.min(preset.lookback, gaps.length));
    let minGap = Infinity;
    let minIdx = 0;
    window.forEach((g, i) => {
      if (g < minGap) { minGap = g; minIdx = i; }
    });
    const lastGap = window[window.length - 1];

    if (!(minGap >= MIN_GAP_PCT)) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const ratio = lastGap / minGap;
    const lastCandle = candles[candles.length - 1];

    const detail = {
      symbol,
      ratio: Math.round(ratio * 100) / 100,
      minGapPct: Math.round(minGap * 100) / 100,
      lastGapPct: Math.round(lastGap * 100) / 100,
      candlesSinceMin: window.length - 1 - minIdx,
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

  matched.sort((a, b) => b.ratio - a.ratio);

  const snap = {
    list: matched.map(r => r.symbol),
    details,
    interval: preset.interval,
    vwapInterval: preset.vwapInterval,
    lookback: preset.lookback,
    bandMultipliers: BAND_MULTIPLIERS,
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

/** Existe ao menos 1 entrada em symbolStore pra ESTE preset específico (não só pra algum
 * outro preset do módulo) — evita que um preset novo, sem nenhuma entrada própria ainda,
 * vire snapshot vazio permanente por causa de outro preset já aquecido no mesmo store. */
function presetHasEntries(presetKey) {
  const prefix = `${presetKey}|`;
  for (const key of symbolStore.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
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

    const windowCandles = Math.ceil(intervalMs(preset.vwapInterval) / intervalMs(preset.interval));
    const limit = preset.lookback + windowCandles + WARMUP_BUFFER_CANDLES;

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

function applyMultiplier(snap, multiplier) {
  const list = snap.list.filter(sym => (snap.details[sym]?.ratio ?? 0) >= multiplier);
  return { ...snap, list };
}

async function getCachedResult(symbols, presetKey, { force = false, multiplier = 3 } = {}) {
  const key = String(presetKey);
  const preset = findPreset(key);
  if (!preset) return null;

  const age = snapshotAgeMs(key);
  const snap = snapshots.get(key);
  const hasSnapshot = snap && Array.isArray(snap.list);
  const staleMs = presetTtlMs(preset) * 2;

  if (!hasSnapshot && presetHasEntries(key)) {
    rebuildAllSnapshots();
    const rebuilt = snapshots.get(key);
    if (rebuilt) {
      return {
        ...applyMultiplier(rebuilt, multiplier),
        name: buildVwapBandExpansionFilterName(preset.interval, preset.vwapInterval, preset.lookback, multiplier),
        cache: { hit: true, ageMs: age, preset: key, rebuilt: true },
      };
    }
  }

  if (force || !hasSnapshot || age >= staleMs) {
    const stats = await ensureFresh(symbols, { force });
    const fresh = buildSnapshotForPreset(preset, Date.now());
    return {
      ...applyMultiplier(fresh, multiplier),
      name: buildVwapBandExpansionFilterName(preset.interval, preset.vwapInterval, preset.lookback, multiplier),
      cache: { ...stats, hit: false, ageMs: 0, preset: key },
    };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[vwapBandExpansionCache] refresh:', err.message));
  }

  return {
    ...applyMultiplier(snap, multiplier),
    name: buildVwapBandExpansionFilterName(preset.interval, preset.vwapInterval, preset.lookback, multiplier),
    cache: {
      hit: true,
      ageMs: age,
      preset: key,
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
    console.log(`[vwapBandExpansionCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[vwapBandExpansionCache] sem cache em disco');
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
    console.error('[vwapBandExpansionCache] saveToDisk:', err.message);
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
