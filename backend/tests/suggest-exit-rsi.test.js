'use strict';

const { suggestExitRsi, hitRate } = require('../bot/amap/suggestExitRsi');
const { buildTradeConfig } = require('../bot/amap/strategyEngine');

const H = 900_000;

describe('suggestExitRsi', () => {
  function buildCMap() {
    const m15 = [];
    for (let i = 0; i < 400; i++) {
      const wave = Math.sin(i / 12) * 12;
      const price = 100 + wave + (i * 0.02);
      m15.push({
        openTime: i * H,
        open: price, high: price + 1, low: price - 1, close: price,
      });
    }
    return { '15m': m15 };
  }

  test('sugere RSI de saída com trades históricos', () => {
    const config = buildTradeConfig({
      entryRsi: { interval: '15m', period: 2, operator: '<', value: 45 },
      exitRsi:  { interval: '15m', period: 2, operator: '>', value: 70 },
      maConditions: [],
      extension: { enabled: false },
      stopLoss: { enabled: false },
    });
    const r = suggestExitRsi(buildCMap(), config, { minTrades: 2 });
    expect(r.suggestedExitRsi).toBeGreaterThanOrEqual(65);
    expect(r.suggestedExitRsi).toBeLessThanOrEqual(85);
    expect(r.tradeCount).toBeGreaterThan(0);
    expect(r.hitRate70).toBeDefined();
  });

  test('sem trades → default 70', () => {
    const config = buildTradeConfig({
      entryRsi: { interval: '15m', period: 14, operator: '<', value: 1 },
      exitRsi:  { interval: '15m', period: 14, operator: '>', value: 99 },
      maConditions: [],
      extension: { enabled: false },
      stopLoss: { enabled: false },
    });
    const r = suggestExitRsi({ '15m': [] }, config);
    expect(r.usedDefault).toBe(true);
    expect(r.suggestedExitRsi).toBe(70);
  });
});

describe('hitRate', () => {
  test('calcula % que atinge limiar', () => {
    expect(hitRate([72, 68, 80, 71], 70)).toBe(0.75);
  });
});
