'use strict';

// Cache dos filtros de "crescimento por ciclo" (fundo→topo) — Bollinger Bands, RSI e
// cruzamento de EMAs. Usa getCandlesForScreening (disco-primeiro, com fallback pela fila de
// API) — igual a bbPositionCache/maDistanceCache — em vez de ler o arquivo de candles cru:
// para muitos símbolos o histórico salvo em disco é bem menor que o usado em Estatísticas
// (ex.: 100 velas em vez de 1000), o que gera 1-2 ciclos e uma média dominada por outlier.
// A porcentagem mínima (thresholdPct) não faz parte da chave do preset — é aplicada em
// memória sobre o snapshot já calculado, já que o usuário escolhe esse valor livremente.

const fs = require('node:fs/promises');
const path = require('path');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');
const { computeIndicatorGrowth } = require('../utils/indicatorGrowthEngines');
const { buildIndicatorGrowthFilterName } = require('../utils/filterNames');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'indicator-growth-cache.json');
const CANDLES_LIMIT = 1000;
const BATCH_SIZE = 20;
/** Abaixo disso a média não é confiável (1-2 ciclos podem ser puro outlier). */
const MIN_OCCURRENCES = 3;
/** Espera no máximo isso por um refresh síncrono antes de devolver algo parcial/stale — a fila
 *  de candles é global e compartilhada com os outros caches, então um backlog grande (símbolos
 *  com pouco histórico em disco) não pode travar a resposta HTTP indefinidamente. */
const BLOCKING_WAIT_MS = 8_000;

/** Presets padrão (interval 4h, mesmos defaults do painel Analisar Indicadores). */
const CACHED_PRESETS = [
  { key: '4h|growth|bb|20|2', engine: 'bollinger', interval: '4h', params: { period: 20, stdDev: 2 } },
  { key: '4h|growth|rsi|30|70', engine: 'rsi', interval: '4h', params: { period: 14, oversold: 30, overbought: 70 } },
  { key: '4h|growth|macross|9|21', engine: 'maCross', interval: '4h', params: { period1: 9, period2: 21, interval: '4h' } },
];

const REFRESH_TICK_MS = 5 * 60_000;

/** Map<"presetKey|symbol", { avgAppreciationPercent, totalOccurrences, computedAt }> */
const symbolStore = new Map();
let dirty = false;
let refreshInFlight = null;

function findPreset(key) {
  return CACHED_PRESETS.find(p => p.key === String(key)) ?? null;
}

function storeKey(presetKey, symbol) {
  return `${presetKey}|${symbol}`;
}

function presetTtlMs(preset) {
  return intervalMs(preset.interval);
}

function paramsMatch(a, b, engine) {
  if (engine === 'bollinger') return a.period === b.period && a.stdDev === b.stdDev;
  if (engine === 'rsi') return a.oversold === b.oversold && a.overbought === b.overbought;
  if (engine === 'maCross') return a.period1 === b.period1 && a.period2 === b.period2;
  return false;
}

function matchesCachedPreset({ engine, interval, params }) {
  for (const preset of CACHED_PRESETS) {
    if (preset.engine === engine && preset.interval === interval && paramsMatch(preset.params, params, engine)) {
      return preset.key;
    }
  }
  return null;
}

async function loadCandlesForScreening(symbol, interval, limit, sessionCache) {
  const cacheKey = `${symbol}|${interval}`;
  if (sessionCache.has(cacheKey)) return sessionCache.get(cacheKey);

  const result = await getCandlesForScreening(symbol, interval, limit);
  sessionCache.set(cacheKey, result);
  return result;
}

function evaluateSymbolWithCandles(symbol, preset, candles, now = Date.now()) {
  const key = storeKey(preset.key, symbol);
  try {
    const result = computeIndicatorGrowth(preset.engine, candles, preset.params);
    symbolStore.set(key, result
      ? { ...result, computedAt: now }
      : { avgAppreciationPercent: null, totalOccurrences: 0, computedAt: now });
  } catch (err) {
    console.error(`[indicatorGrowthCache] ${symbol}:`, err.message);
    symbolStore.set(key, { avgAppreciationPercent: null, totalOccurrences: 0, computedAt: now });
  }
  dirty = true;
}

function needsRefresh(presetKey, symbol) {
  const preset = findPreset(presetKey);
  if (!preset) return true;
  const entry = symbolStore.get(storeKey(presetKey, symbol));
  if (!entry?.computedAt) return true;
  return Date.now() - entry.computedAt >= presetTtlMs(preset);
}

async function refreshAll(symbols, { force = false } = {}) {
  const now = Date.now();
  let computed = 0;
  let failed = 0;
  let diskHits = 0;
  let diskStale = 0;
  let apiFetches = 0;
  const candleSession = new Map();

  for (const preset of CACHED_PRESETS) {
    const stale = force ? symbols : symbols.filter(s => needsRefresh(preset.key, s));

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
          evaluateSymbolWithCandles(symbol, preset, candles, now);
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') computed++;
        else failed++;
      }
    }
  }

  if (computed > 0) await saveToDisk();

  const counts = {};
  for (const preset of CACHED_PRESETS) {
    let n = 0;
    for (const symbol of symbols) {
      const entry = symbolStore.get(storeKey(preset.key, symbol));
      if (entry?.totalOccurrences >= MIN_OCCURRENCES) n++;
    }
    counts[preset.key] = n;
  }

  return {
    total: symbols.length,
    computed,
    failed,
    withCycles: counts,
    diskHits,
    diskStale,
    apiFetches,
    queuePending: candleUpdateQueue.getStats().pending,
  };
}

async function ensureFresh(symbols, { force = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAll(symbols, { force }).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function oldestComputedAt(presetKey, symbols) {
  let oldest = null;
  for (const symbol of symbols) {
    const entry = symbolStore.get(storeKey(presetKey, symbol));
    if (!entry?.computedAt) return 0;
    if (oldest == null || entry.computedAt < oldest) oldest = entry.computedAt;
  }
  return oldest ?? 0;
}

function buildSnapshotForPreset(preset, symbols, thresholdPct) {
  const matched = [];

  for (const symbol of symbols) {
    const entry = symbolStore.get(storeKey(preset.key, symbol));
    if (!entry || entry.avgAppreciationPercent == null) continue;
    if (entry.totalOccurrences < MIN_OCCURRENCES) continue;
    if (entry.avgAppreciationPercent < thresholdPct) continue;
    matched.push({ symbol, ...entry });
  }

  matched.sort((a, b) => b.avgAppreciationPercent - a.avgAppreciationPercent);

  const details = {};
  for (const row of matched) {
    const { symbol, computedAt, ...meta } = row;
    details[symbol] = meta;
  }

  return {
    name: buildIndicatorGrowthFilterName(preset.engine, preset.interval, preset.params, thresholdPct),
    list: matched.map(r => r.symbol),
    details,
    engine: preset.engine,
    interval: preset.interval,
    params: preset.params,
    thresholdPct,
    minOccurrences: MIN_OCCURRENCES,
    scannedAt: Date.now(),
  };
}

async function getCachedResult(symbols, presetKey, thresholdPct, { force = false } = {}) {
  const preset = findPreset(presetKey);
  if (!preset) return null;

  const oldest = oldestComputedAt(preset.key, symbols);
  const age = oldest ? Date.now() - oldest : Infinity;
  const staleMs = presetTtlMs(preset) * 2;

  if (force || age >= staleMs) {
    const refreshPromise = ensureFresh(symbols, { force });
    const timedOut = await Promise.race([
      refreshPromise.then(() => false),
      new Promise(resolve => setTimeout(() => resolve(true), BLOCKING_WAIT_MS)),
    ]);
    refreshPromise.catch(err => console.error('[indicatorGrowthCache] refresh:', err.message));

    if (!timedOut) {
      const stats = await refreshPromise;
      return { ...buildSnapshotForPreset(preset, symbols, thresholdPct), cache: { ...stats, hit: false } };
    }

    // Refresh ainda rodando (fila de candles com backlog) — não trava a resposta.
    // Continua calculando em background; devolve o que já tiver, mesmo parcial/vazio.
    return {
      ...buildSnapshotForPreset(preset, symbols, thresholdPct),
      cache: { hit: false, ageMs: age, pending: true },
    };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[indicatorGrowthCache] refresh:', err.message));
  }

  return { ...buildSnapshotForPreset(preset, symbols, thresholdPct), cache: { hit: true, ageMs: age } };
}

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);

    symbolStore.clear();
    if (data.symbols) {
      for (const [k, entry] of Object.entries(data.symbols)) symbolStore.set(k, entry);
    }

    dirty = false;
    console.log(`[indicatorGrowthCache] disco → ${symbolStore.size} entradas`);
    return symbolStore.size;
  } catch {
    console.log('[indicatorGrowthCache] sem cache em disco');
    return 0;
  }
}

async function saveToDisk() {
  if (!dirty) return false;
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify({
      presets: CACHED_PRESETS,
      symbols: Object.fromEntries(symbolStore),
    }));
    dirty = false;
    return true;
  } catch (err) {
    console.error('[indicatorGrowthCache] saveToDisk:', err.message);
    return false;
  }
}

module.exports = {
  CACHED_PRESETS,
  REFRESH_TICK_MS,
  MIN_OCCURRENCES,
  matchesCachedPreset,
  getCachedResult,
  refreshAll,
  ensureFresh,
  loadFromDisk,
  saveToDisk,
};
