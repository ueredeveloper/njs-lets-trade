'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { checkMaPosition, checkMaCrossNearProximity, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildMaCompareFilterName, parseCompareToken } = require('../utils/filterNames');

const CANDLES_LIMIT = 200;
const BATCH_SIZE = 20;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'ma-compare-cache.json');

/** Presets: posição EMA9 vs EMA21 em 4h (alinhado à regra entryTrendMa do bot). */
const CACHED_PRESETS = [
  {
    key: '4h|9|21|acim|0.5',
    interval: '4h',
    period1: 9,
    period2: 21,
    compare: 'above',
    tolerancePct: 0.5,
  },
  {
    key: '4h|9|21|abaix|0.5',
    interval: '4h',
    period1: 9,
    period2: 21,
    compare: 'below',
    tolerancePct: 0.5,
  },
  {
    key: '4h|9|21|nearup|0.5',
    interval: '4h',
    period1: 9,
    period2: 21,
    compare: 'near_up',
    proximityPct: 0.5,
  },
  {
    key: '4h|9|21|neardn|0.5',
    interval: '4h',
    period1: 9,
    period2: 21,
    compare: 'near_down',
    proximityPct: 0.5,
  },
];

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
  const opts = (preset.compare === 'near_up' || preset.compare === 'near_down')
    ? { proximityPct: preset.proximityPct }
    : { tolerancePct: preset.tolerancePct };
  return buildMaCompareFilterName(preset.interval, preset.period1, preset.period2, preset.compare, lang, opts);
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

function paramsMatchPreset(params, preset) {
  if (params.period1 !== preset.period1
    || params.period2 !== preset.period2
    || params.interval !== preset.interval) {
    return false;
  }
  if (preset.compare === 'near_up' || preset.compare === 'near_down') {
    const prox = Math.round(parseFloat(params.proximityPct ?? 0.5) * 10) / 10;
    return params.compare === preset.compare && prox === preset.proximityPct;
  }
  const compare = normalizeCompare(params.compare);
  const tol = Math.round(parseFloat(params.tolerancePct ?? 0) * 10) / 10;
  return compare === preset.compare && tol === preset.tolerancePct;
}

function matchesCachedPreset(params) {
  const interval = params.interval;
  const period1 = parseInt(params.period1, 10);
  const period2 = parseInt(params.period2, 10);
  const compare = (params.compare === 'near_up' || params.compare === 'near_down')
    ? params.compare
    : normalizeCompare(params.compare);
  const tolerancePct = Math.round(parseFloat(params.tolerancePct ?? 0) * 10) / 10;
  const proximityPct = Math.round(parseFloat(params.proximityPct ?? 0.5) * 10) / 10;

  for (const preset of CACHED_PRESETS) {
    if (paramsMatchPreset({
      interval, period1, period2, compare, tolerancePct, proximityPct,
    }, preset)) {
      return preset.key;
    }
  }
  return null;
}

function buildDetail(symbol, r, compare) {
  let direction = r.direction;
  if (!direction && (compare === 'near_up' || compare === 'near_down')) {
    direction = compare === 'near_down' ? 'down' : 'up';
  }
  return {
    symbol,
    gapPct: r.gapPct != null ? Math.round(r.gapPct * 100) / 100 : null,
    absGapPct: r.absGapPct != null ? Math.round(r.absGapPct * 100) / 100 : (
      r.gapPct != null ? Math.round(Math.abs(r.gapPct) * 100) / 100 : null
    ),
    ma1: r.ma1,
    ma2: r.ma2,
    direction,
    kind: r.kind,
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
  const minCandles = Math.max(preset.period1, preset.period2) + 5;
  const key = storeKey(preset.key, symbol);

  try {
    if (!candles?.length || candles.length < minCandles) {
      symbolStore.set(key, { matched: false, gapPct: null, detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const isNear = preset.compare === 'near_up' || preset.compare === 'near_down';
    const r = isNear
      ? checkMaCrossNearProximity({
        candles1: candles, period1: preset.period1, interval1: preset.interval,
        candles2: candles, period2: preset.period2, interval2: preset.interval,
        mode: preset.compare,
        proximityPct: preset.proximityPct,
        closedOnly: true,
      })
      : checkMaPosition({
        candles1: candles, period1: preset.period1, interval1: preset.interval,
        candles2: candles, period2: preset.period2, interval2: preset.interval,
        compare: preset.compare,
        tolerancePct: preset.tolerancePct,
        closedOnly: true,
      });

    const detail = r.matched ? buildDetail(symbol, r, preset.compare) : null;
    symbolStore.set(key, {
      matched: r.matched,
      gapPct: r.gapPct ?? null,
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

  matched.sort((a, b) => {
    const ga = a.gapPct ?? 0;
    const gb = b.gapPct ?? 0;
    if (preset.compare === 'near_up' || preset.compare === 'near_down') return ga - gb;
    return preset.compare === 'below' ? ga - gb : gb - ga;
  });

  const snap = {
    name: presetFilterName(preset, lang),
    list: matched.map(r => r.symbol),
    details,
    interval: preset.interval,
    period1: preset.period1,
    period2: preset.period2,
    compare: preset.compare,
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
    refreshPromise.catch(err => console.error('[maCompareCache] refresh:', err.message));

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
    ensureFresh(symbols).catch(err => console.error('[maCompareCache] refresh:', err.message));
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
    console.log(`[maCompareCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[maCompareCache] sem cache em disco');
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
    console.error('[maCompareCache] saveToDisk:', err.message);
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
