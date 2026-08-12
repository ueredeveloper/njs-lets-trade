'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { simulateBbMedianTrendTrades, DEFAULT_MEDIAN_LOOKBACK } = require('../utils/bbMedianTrendTrades');
const { buildBollingerMedianTrendFilterName } = require('../utils/filterNames');
const cacheSettings = require('./cacheSettings');

const BATCH_SIZE = 20;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'bb-median-trend-cache.json');
/** Abaixo disso a média não é confiável (1-2 trades podem ser puro outlier). */
const MIN_TRADES = 2;

/**
 * Presets pré-aquecidos: combinação padrão do filtro de trades BB c/ tendência da mediana —
 * 700 candles, período 20, desvio 2, nos dois intervalos mais usados pro mean-reversion
 * (15min e 5min). O snapshot guarda os stats "crus" (ganhos/perdas/todos) por símbolo, sem
 * `side` — a escolha de só ganhos/só perdas/todos é aplicada na leitura (getCachedResult),
 * não na varredura, pra não precisar re-varrer o mercado 3x pra cada side.
 */
const CACHED_PRESETS = [
  { key: '15m|20|2|700', interval: '15m', period: 20, stdDev: 2, lookback: 700, settingId: 'bbMedianTrend15m', ttlMs: 30 * 60_000 },
  { key: '5m|20|2|700', interval: '5m', period: 20, stdDev: 2, lookback: 700, settingId: 'bbMedianTrend5m', ttlMs: 20 * 60_000 },
];

const REFRESH_TICK_MS = 5 * 60_000;

/** Map<"presetKey|symbol", { detail, computedAt }> — detail é null quando não há dados suficientes. */
const symbolStore = new Map();
/** Map<presetKey, snapshot> — snapshot.details guarda os stats crus (sem side aplicado). */
const snapshots = new Map();
let refreshInFlight = null;
let dirty = false;

function presetTtlMs(preset) {
  return preset.ttlMs ?? intervalMs(preset.interval);
}

function presetFilterName(preset, side = 'pos') {
  return buildBollingerMedianTrendFilterName(preset.interval, preset.period, preset.stdDev, preset.lookback, side);
}

function findPreset(key) {
  return CACHED_PRESETS.find(p => p.key === String(key)) ?? null;
}

function storeKey(presetKey, symbol) {
  return `${presetKey}|${symbol}`;
}

function paramsMatchPreset(params, preset) {
  return params.interval === preset.interval
    && params.period === preset.period
    && params.stdDev === preset.stdDev
    && params.lookback === preset.lookback;
}

function matchesCachedPreset(params) {
  const interval = params.interval;
  const period = parseInt(params.period, 10);
  const stdDev = Math.round(parseFloat(params.stdDev) * 10) / 10;
  const lookback = parseInt(params.lookback, 10);

  for (const preset of CACHED_PRESETS) {
    if (paramsMatchPreset({ interval, period, stdDev, lookback }, preset)) {
      return cacheSettings.isEnabled(preset.settingId) ? preset.key : null;
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

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function avgPct(list) {
  if (!list.length) return null;
  return list.reduce((s, v) => s + v, 0) / list.length;
}

function evaluateSymbolWithCandles(symbol, preset, rawCandles, now = Date.now()) {
  const minCandles = preset.period + DEFAULT_MEDIAN_LOOKBACK + 5;
  const key = storeKey(preset.key, symbol);

  try {
    const candles = closedCandlesOnly(rawCandles);
    if (!candles?.length || candles.length < minCandles) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const trades = simulateBbMedianTrendTrades(candles, { period: preset.period, stdDev: preset.stdDev, tradeWindow: preset.lookback });
    if (!trades.length) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const pnls = trades.map(t => t.pnlPct);
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p <= 0);
    const last = candles[candles.length - 1];

    const detail = {
      symbol,
      avgWinPct: round2(avgPct(wins)),
      avgLossPct: round2(avgPct(losses)),
      avgAllPct: round2(avgPct(pnls)),
      totalTrades: trades.length,
      winTrades: wins.length,
      lossTrades: losses.length,
      winRatePct: round2((wins.length / trades.length) * 100),
      close: parseFloat(last.close),
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

/** Snapshot guarda TODOS os símbolos com detail (independente de side) — a filtragem por
 *  MIN_TRADES e a ordenação por avgPct do side escolhido acontecem em applySide/getCachedResult. */
function buildSnapshotForPreset(preset, now = Date.now()) {
  const details = {};
  const prefix = `${preset.key}|`;

  for (const [key, entry] of symbolStore) {
    if (!key.startsWith(prefix)) continue;
    if (!entry?.detail) continue;
    const { symbol: sym, ...meta } = entry.detail;
    details[sym] = meta;
  }

  const snap = {
    details,
    interval: preset.interval,
    period: preset.period,
    stdDev: preset.stdDev,
    lookback: preset.lookback,
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

/** Aplica o `side` escolhido sobre os stats crus do snapshot: monta list/details finais
 *  (avgPct = média do side), descarta símbolos sem trades suficientes desse side, ordena. */
function applySide(snap, side, order) {
  const field = side === 'pos' ? 'avgWinPct' : side === 'neg' ? 'avgLossPct' : 'avgAllPct';
  const countField = side === 'pos' ? 'winTrades' : side === 'neg' ? 'lossTrades' : 'totalTrades';

  const rows = [];
  for (const [symbol, meta] of Object.entries(snap.details)) {
    if ((meta[countField] ?? 0) < MIN_TRADES || meta[field] == null) continue;
    rows.push({ symbol, avgPct: meta[field], ...meta });
  }
  rows.sort((a, b) => (order === 'worst' ? a.avgPct - b.avgPct : b.avgPct - a.avgPct));

  const details = {};
  for (const row of rows) {
    const { symbol, ...meta } = row;
    details[symbol] = meta;
  }

  return {
    list: rows.map(r => r.symbol),
    details,
    interval: snap.interval,
    period: snap.period,
    stdDev: snap.stdDev,
    lookback: snap.lookback,
    side,
    order,
    scannedAt: snap.scannedAt,
  };
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
    if (!cacheSettings.isEnabled(preset.settingId)) continue;

    const stale = force
      ? symbols
      : symbols.filter(s => needsRefresh(preset.key, s));
    staleTotal += stale.length;

    const minCandles = preset.period + DEFAULT_MEDIAN_LOOKBACK + 5;
    const limit = preset.lookback + minCandles;
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

      buildSnapshotForPreset(preset, Date.now());
      if (computed > 0) await saveToDisk();
    }
  }

  const counts = {};
  for (const preset of CACHED_PRESETS) {
    counts[preset.key] = Object.keys(snapshots.get(preset.key)?.details ?? {}).length;
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

async function getCachedResult(symbols, presetKey, { force = false, side = 'pos', order = 'best' } = {}) {
  const key = String(presetKey);
  const preset = findPreset(key);
  if (!preset) return null;

  const age = snapshotAgeMs(key);
  const snap = snapshots.get(key);
  const hasSnapshot = snap && snap.details;
  const staleMs = presetTtlMs(preset) * 2;

  if (!hasSnapshot && symbolStore.size > 0) {
    rebuildAllSnapshots();
    const rebuilt = snapshots.get(key);
    if (rebuilt) {
      return {
        ...applySide(rebuilt, side, order),
        name: presetFilterName(preset, side),
        cache: { hit: true, ageMs: age, preset: key, rebuilt: true },
      };
    }
  }

  if (force || !hasSnapshot || age >= staleMs) {
    const stats = await ensureFresh(symbols, { force: false });
    const fresh = buildSnapshotForPreset(preset, Date.now());
    return { ...applySide(fresh, side, order), name: presetFilterName(preset, side), cache: { ...stats, hit: false, ageMs: 0, preset: key } };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[bbMedianTrendCache] refresh:', err.message));
  }

  const applied = applySide(snap, side, order);
  return {
    ...applied,
    name: presetFilterName(preset, side),
    cache: {
      hit: true,
      ageMs: age,
      preset: key,
      matched: applied.list.length,
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
      `${p.key}:${Object.keys(snapshots.get(p.key)?.details ?? {}).length}`,
    ).join(' ');
    console.log(`[bbMedianTrendCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[bbMedianTrendCache] sem cache em disco');
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
    console.error('[bbMedianTrendCache] saveToDisk:', err.message);
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
