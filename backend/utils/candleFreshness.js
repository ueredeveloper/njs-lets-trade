'use strict';

const { intervalMs } = require('../bot/ma-cross/strategyEngine');

/** Verifica buracos recentes no histórico (ex.: falta candle 17:00 no disco). */
function hasRecentCandleGaps(disk, interval, lookback = 24) {
  if (!disk?.length || disk.length < 2) return false;
  const period = intervalMs(interval);
  const start = Math.max(1, disk.length - lookback);
  for (let i = start; i < disk.length; i++) {
    const delta = Number(disk[i].openTime) - Number(disk[i - 1].openTime);
    if (delta !== period) return true;
  }
  return false;
}

/**
 * Avalia candles do disco para screening.
 * @returns {'fresh'|'stale'|'very-stale'|'insufficient'|'missing'}
 */
function assessDiskCandles(disk, interval, limit) {
  if (!disk?.length) return 'missing';
  if (disk.length < limit) return 'insufficient';

  const lastTime = disk[disk.length - 1]?.openTime ?? 0;
  if (lastTime <= 0) return 'very-stale';

  const age = Date.now() - lastTime;
  const period = intervalMs(interval);
  if (age <= period * 2) {
    if (hasRecentCandleGaps(disk, interval)) return 'stale';
    return 'fresh';
  }
  if (age <= period * 12) return 'stale';
  return 'very-stale';
}

module.exports = { assessDiskCandles, hasRecentCandleGaps };
