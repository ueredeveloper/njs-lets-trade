'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const atomicWriteFile = require('../utils/atomicWriteFile');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const candleUpdateQueue = require('../utils/candleUpdateQueue');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildBollingerBandWidthFilterName } = require('../utils/filterNames');
const { bandWidthRobustMean } = require('../utils/removeOutliersIQR');
const { bollingerBandWidthSeries } = require('../utils/indicatorGrowthEngines');
const cacheSettings = require('./cacheSettings');

const BATCH_SIZE = 20;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'bb-band-width-cache.json');

/**
 * Presets pré-aquecidos: combinação padrão do painel de favoritos (4h, período 20, desvio 2,
 * 100 candles) e a combinação padrão do filtro de busca de indicadores (1h, 15min, 5min e 1min,
 * mesmo BB(20,2), 300 candles) — trade BB entra na banda inferior e sai na superior. Cada um
 * desses quatro intervalos também tem uma variante gêmea com 100 candles, sob o mesmo
 * settingId (liga/desliga junto com a de 300 — não é um toggle separado em Configurações),
 * pra quem escolher "100 candles" no formulário de indicadores também cair no cache em vez de
 * calcular ao vivo. O preset de 4h (favoritos) existe mas nasce desligado (ver DEFAULT_ON em
 * cacheSettings.js). O 1min nasce ligado por decisão explícita — cabe no orçamento da fila
 * global de candles (~24 req/min) porque os demais caches de mercado foram desligados por
 * padrão pra abrir espaço pra ele.
 */
/**
 * ttlMs é independente do intervalo do candle. 1min/5min ficam em 5min: o refresh em
 * background já roda nesse ritmo (REFRESH_TICK_MS) e não bloqueia clique nenhum — o
 * endpoint sempre devolve o snapshot em memória na hora, só dispara o recálculo assíncrono
 * quando o TTL vence (ver getCachedResult). O front também parou de mandar force:true pra
 * esses dois intervalos (IndicatorPanel.jsx) exatamente por isso: sem essa mudança, um clique
 * forçava reprocessar os ~484 pares na hora, o que nesses dois intervalos nunca é rápido (ver
 * orçamento da fila global em candleUpdateQueue.js). 15min continua mais folgado (30min) por
 * não ter sido pedido tão em cima.
 */
// Dentro do mesmo intervalo, o preset de lookback maior vem sempre antes do menor: o
// session cache de candles em refreshAll (loadCandlesForScreening) é indexado só por
// "symbol|interval" — se o de menor lookback rodasse primeiro, o de maior herdaria
// candles insuficientes pra sua janela em vez de refetchar.
const CACHED_PRESETS = [
  { key: '4h|20|2|100', interval: '4h', period: 20, stdDev: 2, lookback: 100, settingId: 'bbBandWidth4h' },
  { key: '1m|20|2|300', interval: '1m', period: 20, stdDev: 2, lookback: 300, settingId: 'bbBandWidth1m', ttlMs: 5 * 60_000 },
  { key: '1m|20|2|100', interval: '1m', period: 20, stdDev: 2, lookback: 100, settingId: 'bbBandWidth1m', ttlMs: 5 * 60_000 },
  { key: '1h|20|2|300', interval: '1h', period: 20, stdDev: 2, lookback: 300, settingId: 'bbBandWidth1h' },
  { key: '1h|20|2|100', interval: '1h', period: 20, stdDev: 2, lookback: 100, settingId: 'bbBandWidth1h' },
  { key: '15m|20|2|300', interval: '15m', period: 20, stdDev: 2, lookback: 300, settingId: 'bbBandWidth15m', ttlMs: 30 * 60_000 },
  { key: '15m|20|2|100', interval: '15m', period: 20, stdDev: 2, lookback: 100, settingId: 'bbBandWidth15m', ttlMs: 30 * 60_000 },
  { key: '5m|20|2|300', interval: '5m', period: 20, stdDev: 2, lookback: 300, settingId: 'bbBandWidth5m', ttlMs: 5 * 60_000 },
  { key: '5m|20|2|100', interval: '5m', period: 20, stdDev: 2, lookback: 100, settingId: 'bbBandWidth5m', ttlMs: 5 * 60_000 },
];

const REFRESH_TICK_MS = 5 * 60_000;

/** Map<"presetKey|symbol", { detail, computedAt }> — detail é null quando não há dados suficientes. */
const symbolStore = new Map();
/** Map<presetKey, snapshot> — snapshot.list sempre ordenado das bandas mais distantes pras mais próximas. */
const snapshots = new Map();
let refreshInFlight = null;
let dirty = false;

function presetTtlMs(preset) {
  return preset.ttlMs ?? intervalMs(preset.interval);
}

function presetFilterName(preset) {
  return buildBollingerBandWidthFilterName(preset.interval, preset.period, preset.stdDev, preset.lookback);
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

function evaluateSymbolWithCandles(symbol, preset, rawCandles, now = Date.now()) {
  const minCandles = preset.period + 5;
  const key = storeKey(preset.key, symbol);

  try {
    const candles = closedCandlesOnly(rawCandles);
    if (!candles?.length || candles.length < minCandles) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    // Largura de uma moeda = distância média entre as bandas, (upper-lower)/lower em %, candle a
    // candle na janela — SEM as altas expressivas que inflam a média (um pump/crash pontual
    // alarga as bandas por ~period candles). Ver bollingerBandWidthSeries + bandWidthRobustMean.
    const series = bollingerBandWidthSeries(candles, { period: preset.period, stdDev: preset.stdDev });
    if (!series?.length) {
      symbolStore.set(key, { detail: null, computedAt: now });
      dirty = true;
      return false;
    }

    const avgWidthPct = bandWidthRobustMean(series);
    const lastCandle = candles[candles.length - 1];

    const detail = {
      symbol,
      avgWidthPct: Math.round(avgWidthPct * 100) / 100,
      lastWidthPct: Math.round(series[series.length - 1] * 100) / 100,
      minWidthPct: Math.round(Math.min(...series) * 100) / 100,
      maxWidthPct: Math.round(Math.max(...series) * 100) / 100,
      samples: series.length,
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

/** Existe ao menos 1 entrada em symbolStore pra ESTE preset específico (não só pra algum
 * outro preset do módulo) — usado pra não confundir "cache do módulo já aquecido" com
 * "este preset específico já foi varrido alguma vez" (ver bug do bbPositionCache: um preset
 * novo sem nenhuma entrada própria caía nesse atalho e virava snapshot vazio permanente). */
function presetHasEntries(presetKey) {
  const prefix = `${presetKey}|`;
  for (const key of symbolStore.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/** presetKey: quando informado, restringe force/varredura a ESSE preset só — sem isso, um
 *  "recalcule agora" pedido pelo usuário pra 1 combinação (ex.: 1m/100 candles) forçaria os 9
 *  presets do módulo inteiro (~484 símbolos cada), muito além do que foi pedido e muito mais
 *  lento (ver conversa sobre "recalcule sempre que clicar"). */
async function refreshAll(symbols, { force = false, presetKey = null } = {}) {
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
    if (presetKey && preset.key !== presetKey) continue;

    const stale = force
      ? symbols
      : symbols.filter(s => needsRefresh(preset.key, s));
    staleTotal += stale.length;

    const minCandles = preset.period + 5;
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

      // Reconstrói o snapshot a cada lote — sem isso, uma varredura de ~500 símbolos
      // (minutos, dado o rate-limit da fila global) deixa o endpoint devolvendo lista vazia
      // o tempo todo, em vez de ir preenchendo aos poucos conforme cada lote termina.
      buildSnapshotForPreset(preset, Date.now());
      if (computed > 0) await saveToDisk();
    }
  }

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

async function ensureFresh(symbols, { force = false, presetKey = null } = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAll(symbols, { force, presetKey }).finally(() => {
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

  if (!hasSnapshot && presetHasEntries(key)) {
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

  // Só bloqueia esperando a revarredura completa quando não existe NENHUM dado ainda
  // (primeira vez que esse preset roda) ou quando force=true foi pedido explicitamente. Um
  // snapshot velho (mesmo bem além do TTL) sempre volta na hora — a atualização acontece em
  // segundo plano logo abaixo. Sem isso, um preset que o ciclo de 5min ainda não tocou (ex.:
  // logo após reiniciar o servidor) travava a resposta esperando a fila global de candles,
  // reintroduzindo a mesma demora que motivou tirar o force:true do 1m/5m no front.
  if (force || !hasSnapshot) {
    const stats = await ensureFresh(symbols, { force, presetKey: key });
    const fresh = buildSnapshotForPreset(preset, Date.now());
    return { ...applyOrder(fresh, order), cache: { ...stats, hit: false, ageMs: 0, preset: key } };
  }

  if (age >= presetTtlMs(preset)) {
    ensureFresh(symbols).catch(err => console.error('[bbBandWidthCache] refresh:', err.message));
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
    console.log(`[bbBandWidthCache] disco → ${symbolStore.size} entradas (${counts})`);
    return symbolStore.size;
  } catch {
    console.log('[bbBandWidthCache] sem cache em disco');
    return 0;
  }
}

async function saveToDisk() {
  if (!dirty) return false;
  try {
    await atomicWriteFile(CACHE_FILE, JSON.stringify({
      presets: CACHED_PRESETS,
      symbols: Object.fromEntries(symbolStore),
      snapshots: Object.fromEntries(snapshots),
    }));
    dirty = false;
    return true;
  } catch (err) {
    console.error('[bbBandWidthCache] saveToDisk:', err.message);
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
