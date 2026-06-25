'use strict';

const ti = require('technicalindicators');
const { checkMaFilters, maKey } = require('../bot/amap/strategyEngine');

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
  const maArr = ti.SMA.calculate({ values: closes, period });
  const ma = maArr[maArr.length - 1];
  return { [key]: { ma, candles, period, interval } };
}

describe('checkMaFilters — N candles acima da MA', () => {
  test('bloqueia quando aboveMaEnabled e candle histórico abaixo da MA', () => {
    const closes = Array(65).fill(120);
    closes[55] = 95;
    const candles = makeCandles(closes);
    const snap = maSnapFromCandles(candles, 50, '1h');
    const signalTime = candles[candles.length - 1].openTime;

    const r = checkMaFilters({
      close: 125,
      maFilters: [{
        period: 50, interval: '1h', mode: 'strict_above',
        aboveMaEnabled: true, aboveMaCandles: 10,
      }],
      maSnap: snap,
      adaptiveDips: {},
      entryTimeMs: Date.now(),
      signalOpenTime: signalTime,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('ABOVE_MA_NOT_MET');
  });

  test('permite quando preço acima da MA e N candles anteriores ok', () => {
    const closes = Array.from({ length: 64 }, (_, i) => 80 + i * 0.5);
    closes.push(99, 125);
    const candles = makeCandles(closes);
    const snap = maSnapFromCandles(candles, 50, '1h');
    const signalTime = candles[candles.length - 1].openTime;

    const r = checkMaFilters({
      close: 125,
      maFilters: [{
        period: 50, interval: '1h', mode: 'strict_above',
        aboveMaEnabled: true, aboveMaCandles: 10,
      }],
      maSnap: snap,
      adaptiveDips: {},
      entryTimeMs: Date.now(),
      signalOpenTime: signalTime,
    });
    expect(r.allowed).toBe(true);
  });

  test('ignora N candles quando aboveMaEnabled=false', () => {
    const closes = Array(65).fill(120);
    closes[55] = 95;
    const candles = makeCandles(closes);
    const snap = maSnapFromCandles(candles, 50, '1h');

    const r = checkMaFilters({
      close: 125,
      maFilters: [{
        period: 50, interval: '1h', mode: 'strict_above',
        aboveMaEnabled: false, aboveMaCandles: 10,
      }],
      maSnap: snap,
      adaptiveDips: {},
    });
    expect(r.allowed).toBe(true);
  });
});
