'use strict';

const readCandles = require('./read-candles');
const { assessDiskCandles } = require('./candleFreshness');
const candleUpdateQueue = require('./candleUpdateQueue');

const LIMIT = 200;
const BATCH_SIZE = 15;

/** Intervalos usados no screening de cruzamento de MAs (1m/5m). */
const WARMUP_INTERVALS = ['1m', '5m'];

/** Símbolos atualizados por ciclo — respeita ~24 req/min da fila. */
const MAX_REFRESH_PER_TICK = {
  '1m': 20,
  '5m': 40,
};

/** Onde retomar a varredura circular por intervalo. */
const cursor = { '1m': 0, '5m': 0 };

let refreshInFlight = null;

async function isStale(symbol, interval) {
  try {
    const disk = await readCandles(symbol, interval);
    return assessDiskCandles(disk, interval, LIMIT) !== 'fresh';
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

/**
 * Varre símbolos em ordem circular e atualiza os stale via fila (grava em disco).
 */
async function refreshTick(symbols, interval, maxCount) {
  const stale = [];
  const n = symbols.length;
  if (!n || maxCount <= 0) return { refreshed: 0, failed: 0, checked: 0, staleFound: 0 };

  let checked = 0;
  let i = cursor[interval] % n;

  while (stale.length < maxCount && checked < n) {
    const sym = symbols[i % n];
    // eslint-disable-next-line no-await-in-loop
    if (await isStale(sym, interval)) stale.push(sym);
    i += 1;
    checked += 1;
  }
  cursor[interval] = i % n;

  let refreshed = 0;
  let failed = 0;

  for (let b = 0; b < stale.length; b += BATCH_SIZE) {
    const batch = stale.slice(b, b + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.allSettled(
      batch.map(s => candleUpdateQueue.fetch(s, interval, LIMIT, { priority: 1, timeoutMs: 30_000 })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') refreshed += 1;
      else failed += 1;
    }
  }

  return { refreshed, failed, checked, staleFound: stale.length };
}

async function runWarmupCycle(symbols) {
  let totalRefreshed = 0;
  let totalFailed = 0;
  const byInterval = {};

  for (const interval of WARMUP_INTERVALS) {
    const max = MAX_REFRESH_PER_TICK[interval] ?? 20;
    // eslint-disable-next-line no-await-in-loop
    const stats = await refreshTick(symbols, interval, max);
    byInterval[interval] = stats;
    totalRefreshed += stats.refreshed;
    totalFailed += stats.failed;
  }

  return { refreshed: totalRefreshed, failed: totalFailed, byInterval };
}

async function ensureWarm(symbols) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runWarmupCycle(symbols).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

module.exports = {
  WARMUP_INTERVALS,
  MAX_REFRESH_PER_TICK,
  ensureWarm,
  runWarmupCycle,
  isStale,
};
