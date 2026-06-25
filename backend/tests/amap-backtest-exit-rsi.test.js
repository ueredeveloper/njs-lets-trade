'use strict';

const {
  computeRsiSeries, exitRsiAt, exitRsiAtClosed, loadLocalCandles,
} = require('../bot/amap/amapBacktest');

describe('amapBacktest exit RSI', () => {
  const c1h = loadLocalCandles('HEIUSDT', '1h');
  const series = computeRsiSeries(c1h, 14);

  test('exitRsiAtClosed evita RSI da vela 1h em formação', () => {
    const t = new Date('2026-05-29T07:00:00-03:00').getTime();
    const lookahead = exitRsiAt(series, t);
    const closed = exitRsiAtClosed(series, t, '1h');
    expect(lookahead).toBeGreaterThan(70);
    expect(closed).toBeLessThan(60);
    expect(closed).not.toEqual(lookahead);
  });
});
