'use strict';

const { assessDiskCandles, hasRecentCandleGaps } = require('../utils/candleFreshness');

jest.mock('../bot/ma-cross/strategyEngine', () => ({
  intervalMs: (iv) => ({ '5m': 300_000, '15m': 900_000 }[iv] ?? 3_600_000),
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
});
