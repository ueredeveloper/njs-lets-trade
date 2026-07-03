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

/** Último candle fechado (descarta o candle em formação no fim do array). */
function closedCandlesOnly(candles) {
  if (!candles?.length || candles.length < 3) return candles ?? [];
  return candles.slice(0, -1);
}

/** Idade do último candle fechado em ms (Infinity se indisponível). */
function lastClosedCandleAge(disk) {
  const closed = closedCandlesOnly(disk);
  if (!closed.length) return Infinity;
  const t = Number(closed[closed.length - 1]?.openTime ?? 0);
  if (t <= 0) return Infinity;
  return Date.now() - t;
}

/**
 * Avalia candles do disco para screening.
 * Exige candle corrente recente e último fechado utilizável (closedOnly no macross).
 * @returns {'fresh'|'stale'|'very-stale'|'insufficient'|'missing'}
 */
function assessDiskCandles(disk, interval, limit) {
  if (!disk?.length) return 'missing';
  if (disk.length < limit) return 'insufficient';

  const period = intervalMs(interval);
  const lastTime = Number(disk[disk.length - 1]?.openTime ?? 0);
  if (lastTime <= 0) return 'very-stale';

  const lastAge = Date.now() - lastTime;
  if (lastAge > period * 2) {
    if (lastAge <= period * 12) return 'stale';
    return 'very-stale';
  }

  const closedAge = lastClosedCandleAge(disk);
  if (closedAge > period * 3) {
    if (closedAge <= period * 12) return 'stale';
    return 'very-stale';
  }

  if (hasRecentCandleGaps(disk, interval)) return 'stale';
  return 'fresh';
}

module.exports = {
  assessDiskCandles,
  hasRecentCandleGaps,
  closedCandlesOnly,
  lastClosedCandleAge,
};
