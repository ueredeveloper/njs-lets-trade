'use strict';

const { checkMaCrossover, checkPriceFilter } = require('../bot/ma-cross/strategyEngine');
const { normalizeMaCrossConfig } = require('../bot/ma-cross/tradeConfigSchema');

function makeCandles(closes) {
  return closes.map((close, i) => ({
    openTime: i * 900_000,
    open: close, high: close, low: close, close,
  }));
}

/** Gera série onde MA9 cruza acima de MA21 no último par de candles */
function buildCrossUpSeries() {
  const closes = [];
  for (let i = 0; i < 60; i++) {
    closes.push(100 - i * 0.05);
  }
  for (let i = 0; i < 5; i++) closes.push(closes.at(-1) + 0.3);
  closes.push(closes.at(-1) + 2);
  return makeCandles(closes);
}

describe('MA Cross — cruzamento', () => {
  test('cross_up MA9 vs MA21 no mesmo intervalo', () => {
    const candles = buildCrossUpSeries();
    const r = checkMaCrossover({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
    });
    expect(r.crossed).toBe(true);
    expect(r.ma1).toBeGreaterThan(r.ma2);
  });

  test('cross_down MA9 abaixo MA21 no candle fechado', () => {
    const closes = [];
    for (let i = 0; i < 55; i++) closes.push(100 + i * 0.1);
    for (let i = 0; i < 8; i++) closes.push(closes.at(-1) - 0.4);
    closes.push(closes.at(-1) - 2);
    const candles = makeCandles(closes);
    const r = checkMaCrossover({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_down',
      tolerancePct: 0.5,
    });
    expect(r.crossed).toBe(true);
    expect(r.ma1).toBeLessThan(r.ma2);
  });

  test('filtro strict_above bloqueia abaixo da MA', () => {
    const candles = makeCandles(Array(60).fill(100));
    const pf = checkPriceFilter(95, candles, { enabled: true, period: 50, mode: 'strict_above' });
    expect(pf.allowed).toBe(false);
    expect(pf.reason).toBe('NOT_ABOVE_MA');
  });

  test('filtro adaptive permite até maxDipPct', () => {
    const candles = makeCandles(Array(60).fill(100));
    const pf = checkPriceFilter(97, candles, { enabled: true, period: 50, mode: 'adaptive', maxDipPct: 4 }, 3);
    expect(pf.allowed).toBe(true);
  });

  test('config normaliza param1/param2 e período livre', () => {
    const c = normalizeMaCrossConfig({
      entry: { param1: { period: 34, interval: '1h' }, param2: { period: 89, interval: '4h' } },
    });
    expect(c.entry.ma1.period).toBe(34);
    expect(c.entry.ma2.period).toBe(89);
  });

  test('múltiplos maFilters', () => {
    const c = normalizeMaCrossConfig({
      maFilters: [
        { period: 50, interval: '1h', mode: 'adaptive' },
        { period: 200, interval: '4h', mode: 'strict_above' },
      ],
    });
    expect(c.maFilters).toHaveLength(2);
  });

  test('migra priceFilter legado para maFilters', () => {
    const c = normalizeMaCrossConfig({
      priceFilter: { enabled: true, period: 50, interval: '1h', mode: 'adaptive' },
    });
    expect(c.maFilters[0].period).toBe(50);
  });
});
