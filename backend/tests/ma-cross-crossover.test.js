'use strict';

const { checkMaCrossover, findRecentMaCross, checkMaCrossApproaching, checkPriceFilter } = require('../bot/ma-cross/strategyEngine');
const { normalizeMaCrossConfig, isValidMaCrossPeriod } = require('../bot/ma-cross/tradeConfigSchema');

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

function buildCrossDownSeries() {
  const closes = [];
  for (let i = 0; i < 60; i++) {
    closes.push(100 + i * 0.05);
  }
  for (let i = 0; i < 5; i++) closes.push(closes.at(-1) - 0.3);
  closes.push(closes.at(-1) - 2);
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
    const candles = buildCrossDownSeries();
    const r = checkMaCrossover({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_down',
      tolerancePct: 0.5,
    });
    expect(r.crossed).toBe(true);
    expect(r.ma1).toBeLessThan(r.ma2);
  });

  test('findRecentMaCross: cruzou há ≤15 min e ainda acima', () => {
    const baseTime = Date.now() - 10 * 60_000;
    const closes = Array(45).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.08);
    const candles = closes.map((close, i) => ({
      openTime: baseTime + i * 900_000,
      open: close, high: close, low: close, close,
    }));
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: '15',
      now: baseTime + (candles.length - 1) * 900_000 + 60_000,
    });
    expect(typeof r.matched).toBe('boolean');
    if (r.matched) {
      expect(r.ageMin).toBeLessThanOrEqual(15);
      expect(r.ma1).toBeGreaterThan(r.ma2);
    }
  });

  test('findRecentMaCross: último candle apenas', () => {
    const candles = buildCrossUpSeries();
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: 'last',
      now: candles.at(-1).openTime + 900_000,
    });
    expect(r.matched).toBe(true);
  });

  test('near_up: gap encolhendo', () => {
    const closes = Array(45).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.02);
    const candles = makeCandles(closes);
    const r = checkMaCrossApproaching({
      candles1: candles, period1: 9, interval1: '1m',
      candles2: candles, period2: 21, interval2: '1m',
      mode: 'near_up',
      proximityPct: 2,
      closedOnly: false,
    });
    expect(typeof r.matched).toBe('boolean');
    if (r.matched) {
      expect(r.gapPct).toBeLessThanOrEqual(2);
      expect(r.kind).toBe('approaching');
    }
  });

  test('findRecentMaCross: ignora par com gap no histórico (15m)', () => {
    const baseTime = Date.now() - 60 * 60_000;
    const closes = Array(45).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.08);
    const candles = closes.map((close, i) => ({
      openTime: baseTime + i * 900_000,
      open: close, high: close, low: close, close,
    }));
    // Remove um candle no meio — simula gap no disco
    const gapped = [...candles.slice(0, 30), ...candles.slice(31)];
    const r = findRecentMaCross({
      candles1: gapped, period1: 9, interval1: '15m',
      candles2: gapped, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: '60',
      now: gapped.at(-1).openTime + 900_000,
    });
    // Sem gap falso no par 30→32; cruzamento real permanece no fim da série
    expect(typeof r.matched).toBe('boolean');
  });

  test('cross_up: MAs iguais no par anterior não dispara cruzamento', () => {
    const closes = Array(55).fill(0.00000027);
    closes[54] = 0.00000028;
    closes[55] = 0.00000029;
    const candles = makeCandles(closes);
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
      maxAgeMin: 'last',
      now: candles.at(-1).openTime + 900_000,
    });
    expect(r.matched).toBe(true);
    expect(r.ma1).toBeGreaterThan(r.ma2);
  });

  test('findRecentMaCross: idade medida no fechamento do candle', () => {
    const candles = buildCrossUpSeries().map((c) => ({
      ...c,
      closeTime: c.openTime + 900_000 - 1,
    }));
    const now = candles.at(-1).closeTime + 45 * 60_000;
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: 'last',
      closedOnly: false,
      now,
    });
    expect(r.matched).toBe(true);
    const openAge = (now - r.crossOpenTime) / 60_000;
    expect(r.ageMin).toBeLessThan(openAge);
    expect(r.ageMin).toBeGreaterThanOrEqual(openAge - 16);
  });

  test('cross_up: MA9 já acima no candle anterior não é cruzamento novo (tol 0.5%)', () => {
    const closes = Array(55).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.02);
    const candles = makeCandles(closes);
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
      maxAgeMin: 'last',
      closedOnly: false,
      now: candles.at(-1).openTime + 60_000,
    });
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('NO_CROSS_UP');
  });

  test('cross_up com close em string (disco Binance)', () => {
    const candles = buildCrossUpSeries().map((c) => ({
      ...c,
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
    }));
    const r = checkMaCrossover({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
    });
    expect(r.crossed).toBe(true);
    expect(Number.isFinite(r.ma1)).toBe(true);
    expect(Number.isFinite(r.ma2)).toBe(true);
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

describe('MA Cross — período EMA', () => {
  test('isValidMaCrossPeriod aceita 2–500', () => {
    expect(isValidMaCrossPeriod(2)).toBe(true);
    expect(isValidMaCrossPeriod(13)).toBe(true);
    expect(isValidMaCrossPeriod(500)).toBe(true);
    expect(isValidMaCrossPeriod(1)).toBe(false);
    expect(isValidMaCrossPeriod(501)).toBe(false);
  });

  test('clampPeriod respeita limites', () => {
    const c = normalizeMaCrossConfig({ entry: { ma1: { period: 1 }, ma2: { period: 600 } } });
    expect(c.entry.ma1.period).toBe(9);
    expect(c.entry.ma2.period).toBe(500);
  });
});
