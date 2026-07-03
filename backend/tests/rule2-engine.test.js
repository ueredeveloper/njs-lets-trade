'use strict';

const { calculateMa } = require('../utils/movingAverage');
const {
  checkCandlesAboveMa,
  evaluateRule2Entry,
  evaluateRule2Exit,
  checkRule2ExitRsiConditions,
  getRule2MaEntryFilters,
} = require('../bot/amap/rule2Engine');
const { maKey } = require('../bot/amap/strategyEngine');

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

function maSnapFromCandles(candles, period, interval) {
  const key = maKey(period, interval);
  const closes = candles.map(c => c.close);
  const maArr = calculateMa(closes, period);
  const ma = maArr[maArr.length - 1];
  return { [key]: { ma, candles, period, interval } };
}

describe('rule2Engine — candles acima da MA', () => {
  test('bloqueia se candle no período estava abaixo da MA', () => {
    const closes = Array(65).fill(120);
    closes[55] = 95;
    const candles = makeCandles(closes);
    const signalTime = candles[candles.length - 1].openTime;

    const r = checkCandlesAboveMa(candles, 50, '1h', Date.now(), 10, signalTime);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('ABOVE_MA_NOT_MET');
  });

  test('permite quando 10 candles antes do gatilho fecharam acima da MA', () => {
    const closes = Array.from({ length: 65 }, (_, i) => 100 + i);
    closes[63] = 90;
    closes[64] = 105;
    const candles = makeCandles(closes);
    const signalTime = candles[candles.length - 1].openTime;

    const r = checkCandlesAboveMa(candles, 50, '1h', Date.now(), 10, signalTime);
    expect(r.allowed).toBe(true);
  });
});

describe('rule2Engine — entrada com filtro + gatilho', () => {
  const rule2 = {
    enabled: true,
    entryMa: {
      period: 50, interval: '1h', trigger: 'cross_up', tolerancePct: 0.5,
      aboveMaEnabled: true, aboveMaCandles: 10,
    },
  };

  test('cross_up após 10 candles acima', () => {
    const closes = Array.from({ length: 64 }, (_, i) => 80 + i * 0.5);
    closes.push(99, 108);
    const candles = makeCandles(closes);
    const snap = maSnapFromCandles(candles, 50, '1h');
    const len = candles.length;

    const r = evaluateRule2Entry({
      close: candles[len - 1].close,
      low: candles[len - 1].low,
      prevClose: candles[len - 2].close,
      entryTimeMs: Date.now(),
      signalOpenTime: candles[len - 1].openTime,
      rule2,
      maSnap: snap,
    });
    expect(r.allowed).toBe(true);
    expect(r.entryKind).toBe('rule2');
  });

  test('bloqueia se preço abaixo da MA50 4h (mesmo filtro da regra 1)', () => {
    const closes = Array.from({ length: 64 }, (_, i) => 80 + i * 0.5);
    closes.push(99, 108);
    const candles = makeCandles(closes);
    const snap1h = maSnapFromCandles(candles, 50, '1h');
    const snap4h = { [maKey(50, '4h')]: { ma: 200, period: 50, interval: '4h' } };
    const len = candles.length;

    const r = evaluateRule2Entry({
      close: candles[len - 1].close,
      low: candles[len - 1].low,
      prevClose: candles[len - 2].close,
      entryTimeMs: Date.now(),
      signalOpenTime: candles[len - 1].openTime,
      rule2,
      maSnap: snap1h,
      maSnapFilters: { ...snap1h, ...snap4h },
      maEntryFilters: [{ period: 50, interval: '4h', mode: 'strict_above' }],
      filterClose: 108,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('MA_BLOCKED');
    expect(r.filter).toBe(maKey(50, '4h'));
  });

  test('getRule2MaEntryFilters vazio quando maFiltersEnabled=false', () => {
    const config = {
      rule1: {
        maFiltersEnabled: false,
        maFilters: [{ period: 50, interval: '4h', mode: 'strict_above' }],
      },
    };
    expect(getRule2MaEntryFilters(config)).toEqual([]);
  });

  test('ignora filtros MA quando maEntryFilters vazio', () => {
    const closes = Array.from({ length: 64 }, (_, i) => 80 + i * 0.5);
    closes.push(99, 108);
    const candles = makeCandles(closes);
    const snap1h = maSnapFromCandles(candles, 50, '1h');
    const snap4h = { [maKey(50, '4h')]: { ma: 200, period: 50, interval: '4h' } };
    const len = candles.length;

    const r = evaluateRule2Entry({
      close: candles[len - 1].close,
      low: candles[len - 1].low,
      prevClose: candles[len - 2].close,
      entryTimeMs: Date.now(),
      signalOpenTime: candles[len - 1].openTime,
      rule2,
      maSnap: snap1h,
      maSnapFilters: { ...snap1h, ...snap4h },
      maEntryFilters: [],
      filterClose: 108,
    });
    expect(r.allowed).toBe(true);
  });

  test('bloqueia se preço abaixo do piso adaptativo da MA50 4h', () => {
    const closes = Array.from({ length: 64 }, (_, i) => 80 + i * 0.5);
    closes.push(99, 108);
    const candles = makeCandles(closes);
    const snap1h = maSnapFromCandles(candles, 50, '1h');
    const key4h = maKey(50, '4h');
    const snap4h = { [key4h]: { ma: 110, period: 50, interval: '4h' } };
    const len = candles.length;

    const r = evaluateRule2Entry({
      close: candles[len - 1].close,
      low: candles[len - 1].low,
      prevClose: candles[len - 2].close,
      entryTimeMs: Date.now(),
      signalOpenTime: candles[len - 1].openTime,
      rule2,
      maSnap: snap1h,
      maSnapFilters: { ...snap1h, ...snap4h },
      maEntryFilters: [{ period: 50, interval: '4h', mode: 'adaptive' }],
      adaptiveDips: { [key4h]: 5 },
      filterClose: 100,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('MA_ADAPTIVE_BLOCKED');
    expect(r.filter).toBe(key4h);
  });

  test('bloqueia filtro MA se N candles anteriores não fecharam acima', () => {
    const closes = Array.from({ length: 64 }, (_, i) => 80 + i * 0.5);
    closes[55] = 70;
    closes.push(99, 108);
    const candles = makeCandles(closes);
    const snap4h = maSnapFromCandles(candles, 50, '4h');
    const len = candles.length;

    const r = evaluateRule2Entry({
      close: candles[len - 1].close,
      low: candles[len - 1].low,
      prevClose: candles[len - 2].close,
      entryTimeMs: Date.now(),
      signalOpenTime: candles[len - 1].openTime,
      rule2: { ...rule2, entryMa: { ...rule2.entryMa, aboveMaEnabled: false } },
      maSnap: snap4h,
      maSnapFilters: snap4h,
      maEntryFilters: [{
        period: 50, interval: '4h', mode: 'strict_above',
        aboveMaEnabled: true, aboveMaCandles: 10,
      }],
      filterClose: 108,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('ABOVE_MA_NOT_MET');
  });
});

describe('rule2Engine — saída RSI múltipla', () => {
  const rule2 = {
    exitRsiConditions: [
      { enabled: true, interval: '1h', period: 14, operator: '>', value: 70 },
      { enabled: true, interval: '15m', period: 14, operator: '>', value: 80 },
    ],
    exitRsiLogic: 'any',
    stopLoss: { adaptiveEnabled: false },
  };

  test('OR — vende se 15m > 80', () => {
    const hit = checkRule2ExitRsiConditions({ '1h': 65, '15m': 82 }, rule2);
    expect(hit).not.toBeNull();
    expect(hit.interval).toBe('15m');

    const exit = evaluateRule2Exit({
      close: 100,
      exitRsiMap: { '1h': 65, '15m': 82 },
      maSnap: {},
      rule2,
    });
    expect(exit.exit).toBe(true);
    expect(exit.reason).toBe('rsi');
  });

  test('AND — exige ambas', () => {
    const strict = { ...rule2, exitRsiLogic: 'all' };
    expect(checkRule2ExitRsiConditions({ '1h': 72, '15m': 75 }, strict)).toBeNull();
    expect(checkRule2ExitRsiConditions({ '1h': 72, '15m': 81 }, strict)).not.toBeNull();
  });
});

describe('rule2Engine — stop com N candles acima da MA', () => {
  test('bloqueia stop adaptativo se N candles anteriores não fecharam acima', () => {
    const closes = Array(65).fill(120);
    closes[55] = 95;
    const candles = makeCandles(closes);
    const snap = maSnapFromCandles(candles, 50, '1h');
    const rule2 = {
      entryMa: { period: 50, interval: '1h' },
      stopLoss: { adaptiveEnabled: true, adaptiveAboveMaEnabled: true, adaptiveAboveMaCandles: 10 },
    };
    const exit = evaluateRule2Exit({
      close: 96,
      maSnap: snap,
      adaptiveDip: 3,
      rule2,
    });
    expect(exit.exit).toBe(false);
  });

  test('dispara stop quando preço abaixo do piso e N candles acima ok', () => {
    const closes = Array.from({ length: 65 }, (_, i) => 100 + i);
    closes[63] = 90;
    closes[64] = 105;
    const candles = makeCandles(closes);
    const snap = maSnapFromCandles(candles, 50, '1h');
    const rule2 = {
      entryMa: { period: 50, interval: '1h' },
      stopLoss: { adaptiveEnabled: true, adaptiveAboveMaEnabled: true, adaptiveAboveMaCandles: 10 },
    };
    const exit = evaluateRule2Exit({
      close: 96,
      maSnap: snap,
      adaptiveDip: 3,
      rule2,
    });
    expect(exit.exit).toBe(true);
    expect(exit.reason).toBe('stop_loss_adaptive');
  });
});
