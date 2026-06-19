'use strict';

const { suggestAdaptiveDip } = require('../bot/amap/strategyEngine');

const H = 3_600_000;

function candle(openTime, close, ma) {
  const open = close * 1.001;
  return { openTime, open, high: Math.max(open, close), low: close * 0.98, close };
}

describe('suggestAdaptiveDip', () => {
  test('sugere dip a partir de episódios abaixo da MA', () => {
    const candles = [];
    let price = 100;
    for (let i = 0; i < 120; i++) {
      if (i >= 20 && i < 25) price = 92;
      else if (i >= 50 && i < 54) price = 94;
      else if (i >= 80 && i < 83) price = 93;
      else price = 100 + (i % 5);
      candles.push(candle(i * H, price));
    }

    const r = suggestAdaptiveDip(candles, 20, '1h', { minEpisodes: 2, defaultPct: 3, maxPct: 10, minPct: 0.5 });
    expect(r.suggestedDipPct).toBeGreaterThan(0);
    expect(r.episodeCount).toBeGreaterThanOrEqual(2);
    expect(r.currentMa).not.toBeNull();
    expect(r).toHaveProperty('entryOk');
  });

  test('dados insuficientes → default', () => {
    const r = suggestAdaptiveDip([], 50, '1h');
    expect(r.usedDefault).toBe(true);
    expect(r.suggestedDipPct).toBe(3);
  });
});
