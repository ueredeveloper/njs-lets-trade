'use strict';

const { assessDiskCandles, hasRecentCandleGaps, lastClosedCandleAge } = require('../utils/candleFreshness');

jest.mock('../bot/ma-cross/strategyEngine', () => ({
  intervalMs: (iv) => ({ '1m': 60_000, '5m': 300_000, '15m': 900_000 }[iv] ?? 3_600_000),
}));

describe('candleFreshness', () => {
  test('hasRecentCandleGaps detecta buraco no histórico 15m', () => {
    const now = Date.now();
    const candles = [
      { openTime: now - 45 * 60_000 },
      { openTime: now - 30 * 60_000 },
      { openTime: now - 15 * 60_000 },
    ];
    expect(hasRecentCandleGaps(candles, '15m')).toBe(false);
    candles.splice(1, 0, { openTime: now - 40 * 60_000 }); // quebra sequência
    expect(hasRecentCandleGaps(candles, '15m')).toBe(true);
  });

  test('assessDiskCandles: disco recente com gap → stale', () => {
    const now = Date.now();
    const candles = Array.from({ length: 210 }, (_, i) => ({
      openTime: now - (210 - i) * 900_000,
      close: 1,
    }));
    // Remove um candle no fim — simula BTTC 16:45→17:15
    candles.splice(-2, 1);
    expect(assessDiskCandles(candles, '15m', 200)).toBe('stale');
  });

  test('assessDiskCandles: 5m com último fechado velho → stale', () => {
    const now = Date.now();
    const period = 300_000;
    const candles = Array.from({ length: 210 }, (_, i) => ({
      openTime: now - (210 - i) * period,
      close: 1,
    }));
    // Candle corrente recente, mas penúltimo (último fechado) muito antigo
    candles[candles.length - 1].openTime = now - period;
    candles[candles.length - 2].openTime = now - 8 * period;
    expect(lastClosedCandleAge(candles)).toBeGreaterThan(period * 3);
    expect(assessDiskCandles(candles, '5m', 200)).toBe('stale');
  });

  test('assessDiskCandles: 1m fresco com candle corrente e último fechado ok', () => {
    const now = Date.now();
    const period = 60_000;
    const candles = Array.from({ length: 210 }, (_, i) => ({
      openTime: now - (210 - i) * period,
      close: 1,
    }));
    expect(assessDiskCandles(candles, '1m', 200)).toBe('fresh');
  });
});
