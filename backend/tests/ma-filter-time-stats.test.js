'use strict';

const { computeMaFilterTimeStats, maKey } = require('../bot/amap/strategyEngine');

function makeCandles(closes, periodMs = 3_600_000) {
  const base = Date.now() - closes.length * periodMs;
  return closes.map((close, i) => ({
    openTime: base + i * periodMs,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
  }));
}

describe('computeMaFilterTimeStats', () => {
  test('100% close acima da MA quando tendência de alta (strict_above)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const cMap = { '1h': makeCandles(closes) };
    const config = {
      maFiltersEnabled: true,
      maFilters: [{ period: 50, interval: '1h', mode: 'strict_above' }],
    };

    const stats = computeMaFilterTimeStats(cMap, config, {});
    expect(stats).toHaveLength(1);
    expect(stats[0].pctAboveMa).toBe(100);
    expect(stats[0].pctFilterMet).toBe(100);
    expect(stats[0].pct).toBe(100);
  });

  test('0% close acima da MA em tendência de baixa', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 200 - i);
    const cMap = { '1h': makeCandles(closes) };
    const config = {
      maFiltersEnabled: true,
      maFilters: [{ period: 50, interval: '1h', mode: 'strict_above' }],
    };

    const stats = computeMaFilterTimeStats(cMap, config, {});
    expect(stats[0].pctAboveMa).toBe(0);
    expect(stats[0].pctFilterMet).toBe(0);
  });

  test('modo adaptativo: pctAboveMa < pctFilterMet', () => {
    const closes = Array(60).fill(100);
    const cMap = { '1h': makeCandles(closes) };
    const key = maKey(50, '1h');
    const config = {
      maFiltersEnabled: true,
      maFilters: [{ period: 50, interval: '1h', mode: 'adaptive' }],
    };

    const stats = computeMaFilterTimeStats(cMap, config, { [key]: 5 });
    expect(stats[0].mode).toBe('adaptive');
    expect(stats[0].pctAboveMa).toBeLessThanOrEqual(stats[0].pctFilterMet);
    expect(stats[0].dipPct).toBe(5);
  });

  test('stats separados por filtro (1h e 4h)', () => {
    const closes1h = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    const closes4h = Array.from({ length: 60 }, (_, i) => 100 + i);
    const cMap = {
      '1h': makeCandles(closes1h, 3_600_000),
      '4h': makeCandles(closes4h, 14_400_000),
    };
    const config = {
      maFiltersEnabled: true,
      maFilters: [
        { period: 50, interval: '1h', mode: 'strict_above' },
        { period: 50, interval: '4h', mode: 'strict_above' },
      ],
    };

    const stats = computeMaFilterTimeStats(cMap, config, {});
    expect(stats).toHaveLength(2);
    expect(stats.find(s => s.interval === '1h').pctAboveMa).toBeLessThan(100);
    expect(stats.find(s => s.interval === '4h').pctAboveMa).toBe(100);
  });

  test('inclui período do histórico completo quando sem janela', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 0.1);
    const cMap = { '1h': makeCandles(closes) };
    const config = {
      maFiltersEnabled: true,
      maFilters: [{ period: 50, interval: '1h', mode: 'strict_above' }],
    };

    const stats = computeMaFilterTimeStats(cMap, config, {});
    expect(stats[0].aboveMaTotal).toBe(71);
    expect(stats[0].periodDaysLbl).toMatch(/dias/);
  });

  test('recorta janela quando window explícita é passada', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + (i >= 80 ? 10 : -10));
    const candles = makeCandles(closes);
    const cMap = { '1h': candles };
    const config = {
      maFiltersEnabled: true,
      maFilters: [{ period: 50, interval: '1h', mode: 'strict_above' }],
    };
    const window = {
      fromMs: candles[80].openTime,
      toMs: candles[candles.length - 1].openTime,
    };

    const full = computeMaFilterTimeStats(cMap, config, {});
    const sliced = computeMaFilterTimeStats(cMap, config, {}, window);

    expect(sliced[0].aboveMaTotal).toBeLessThan(full[0].aboveMaTotal);
    expect(sliced[0].pctAboveMa).toBeGreaterThan(full[0].pctAboveMa);
  });

  test('retorna vazio quando filtros MA desligados', () => {
    const cMap = { '1h': makeCandles(Array(60).fill(100)) };
    const config = {
      maFiltersEnabled: false,
      maFilters: [{ period: 50, interval: '1h', mode: 'strict_above' }],
    };
    expect(computeMaFilterTimeStats(cMap, config, {})).toEqual([]);
  });
});
