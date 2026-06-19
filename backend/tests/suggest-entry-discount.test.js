'use strict';

const { analyzeEntryDiscount, rsiCrossedInto } = require('../bot/amap/suggestEntryDiscount');

const H = 900_000; // 15m

function candle(openTime, open, close, low) {
  const lo = low ?? Math.min(open, close);
  return { openTime, open, high: Math.max(open, close), low: lo, close };
}

describe('rsiCrossedInto', () => {
  const rule = { operator: '<', value: 30 };
  test('entra na zona de sobrevenda', () => {
    expect(rsiCrossedInto(rule, 35, 28)).toBe(true);
    expect(rsiCrossedInto(rule, 28, 25)).toBe(false);
  });
});

describe('analyzeEntryDiscount', () => {
  const entryRsi = { interval: '15m', period: 2, operator: '<', value: 30 };
  const exitRsi  = { interval: '15m', period: 2, operator: '>', value: 70 };

  test('episódio com queda adicional de ~2% antes da saída', () => {
    // RSI(2): closes [100,99,98,97,96,95,94,93,92,91,90,89,88,87,86,85,84,83,82,81]
    // Simplificado: força RSI baixo e recuperação
    const candles = [];
    let price = 100;
    for (let i = 0; i < 30; i++) {
      const drop = i >= 3 && i <= 6 ? 0.5 : (i > 6 && i <= 10 ? 0.3 : -0.2);
      const open  = price;
      price       = Math.max(80, price - drop);
      const low   = price - (i >= 4 && i <= 7 ? 2 : 0); // dip extra no meio
      candles.push(candle(i * H, open, price, low));
    }
    // Últimos candles sobem para RSI > 70
    for (let i = 30; i < 40; i++) {
      const open = price;
      price += 3;
      candles.push(candle(i * H, open, price, price - 0.5));
    }

    const r = analyzeEntryDiscount(candles, entryRsi, exitRsi, {
      pendingTimeoutMs: 4 * H,
      pendingCancelPct: 0.002,
      minEpisodes: 1,
    });

    expect(r.episodeCount).toBeGreaterThanOrEqual(1);
    expect(r.suggestedDiscount).toBeGreaterThan(0);
    expect(r.suggestedDiscount).toBeLessThanOrEqual(0.05);
  });

  test('dados insuficientes → default 0,1%', () => {
    const r = analyzeEntryDiscount([], entryRsi, exitRsi);
    expect(r.usedDefault).toBe(true);
    expect(r.suggestedDiscount).toBe(0.001);
  });
});
