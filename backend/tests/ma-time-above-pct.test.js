'use strict';

const { computeMaTimeAbovePct } = require('../utils/maTimeAbovePct');

function makeCandles(closes, periodMs = 3_600_000) {
  const base = Date.now() - closes.length * periodMs;
  return closes.map((close, i) => ({
    openTime: base + i * periodMs,
    close,
  }));
}

describe('computeMaTimeAbovePct', () => {
  test('100% em tendência de alta', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = computeMaTimeAbovePct(makeCandles(closes), 50);
    expect(r.pctAboveMa).toBe(100);
    expect(r.met).toBe(r.total);
  });

  test('0% em tendência de baixa', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 200 - i);
    const r = computeMaTimeAbovePct(makeCandles(closes), 50);
    expect(r.pctAboveMa).toBe(0);
  });

  test('null com histórico insuficiente', () => {
    expect(computeMaTimeAbovePct(makeCandles([100, 101]), 50)).toBeNull();
  });
});

describe('maTimeAboveCache key format', () => {
  test('nome do filtro segue convenção', () => {
    const { buildMaPctFilterName } = require('../utils/filterNames');
    expect(buildMaPctFilterName('1h', 50, 70)).toBe('1h|ma|50|pct|70');
  });
});
