'use strict';

const { analyzeExtension, checkExtension } = require('../bot/amap/strategyEngine');

const H = 3_600_000;

function candle(openTime, open, close) {
  return { openTime, open, high: Math.max(open, close), low: Math.min(open, close), close };
}

describe('analyzeExtension — regras 3/4 candles', () => {
  const extension = {
    enabled: true,
    abovePct: 5,
    threeInterval: '1h',
    fourInterval: '1h',
    threeCandles: true,
    fourCandles: true,
    confirmLogic: 'any',
  };

  const maValue = 100;
  const closeExtended = 106; // +6% acima da MA

  test('sem confirmação 3/4 → bloqueia (sem limiar % acima da MA)', () => {
    const r = analyzeExtension(103, maValue, [], extension, 10 * H);
    expect(r.extended).toBe(true);
    expect(r.allowed).toBe(false);
    expect(r.threeOk).toBe(false);
  });

  test('regra 3 confirma mesmo com preço só +3% acima da MA', () => {
    const candles = [
      candle(1 * H, 100, 101),
      candle(2 * H, 101, 102),
      candle(3 * H, 102, 103),
      candle(4 * H, 103, 104),
    ];
    const entryTime = 4 * H + H;
    const r = analyzeExtension(103, maValue, candles, extension, entryTime);
    expect(r.extended).toBe(true);
    expect(r.threeOk).toBe(true);
    expect(r.allowed).toBe(true);
  });

  test('regra 3: três candles verdes confirmam entrada', () => {
    const candles = [
      candle(1 * H, 100, 101),
      candle(2 * H, 101, 102),
      candle(3 * H, 102, 103),
      candle(4 * H, 103, 104),
    ];
    const entryTime = 4 * H + H; // candle 1h confirmInterval fechado
    const r = analyzeExtension(closeExtended, maValue, candles, extension, entryTime);
    expect(r.extended).toBe(true);
    expect(r.threeOk).toBe(true);
    expect(r.allowed).toBe(true);
  });

  test('regra 3 falha → bloqueia (entrada não realizada)', () => {
    const candles = [
      candle(1 * H, 100, 101),
      candle(2 * H, 101, 100), // vermelho
      candle(3 * H, 100, 101),
      candle(4 * H, 101, 102),
    ];
    const entryTime = 4 * H + H;
    const r = analyzeExtension(closeExtended, maValue, candles, extension, entryTime);
    expect(r.extended).toBe(true);
    expect(r.threeOk).toBe(false);
    expect(r.fourOk).toBe(false);
    expect(r.allowed).toBe(false);
    expect(checkExtension(closeExtended, maValue, candles, extension, entryTime).reason)
      .toBe('THREE_CANDLES_BLOCKED');
  });

  test('regra 4: 3 altas + 1 queda confirma', () => {
    const ext4only = { ...extension, threeCandles: false, fourCandles: true };
    const candles = [
      candle(1 * H, 100, 101),
      candle(2 * H, 101, 102),
      candle(3 * H, 102, 103),
      candle(4 * H, 103, 102), // queda
    ];
    const entryTime = 4 * H + H;
    const r = analyzeExtension(closeExtended, maValue, candles, ext4only, entryTime);
    expect(r.fourOk).toBe(true);
    expect(r.allowed).toBe(true);
  });

  test('confirmLogic all exige 3 E 4 — com ambas ativas não confirma (último candle conflita)', () => {
    const extAll = { ...extension, confirmLogic: 'all' };
    const candles = [
      candle(1 * H, 100, 101),
      candle(2 * H, 101, 102),
      candle(3 * H, 102, 103),
      candle(4 * H, 103, 102), // queda exigida pela regra 4
    ];
    const entryTime = 4 * H + H;
    const r = analyzeExtension(closeExtended, maValue, candles, extAll, entryTime);
    expect(r.threeOk).toBe(false);
    expect(r.fourOk).toBe(true);
    expect(r.allowed).toBe(false);
  });

  test('regra 3 e 4 podem usar intervalos diferentes', () => {
    const FOUR_H = 14_400_000;
    const ext = { ...extension, threeInterval: '4h', fourInterval: '1h' };
    const candles4h = [
      candle(1 * FOUR_H, 100, 101),
      candle(2 * FOUR_H, 101, 102),
      candle(3 * FOUR_H, 102, 103),
    ];
    const candles1h = [
      candle(1 * H, 100, 101),
      candle(2 * H, 101, 102),
      candle(3 * H, 102, 103),
      candle(4 * H, 103, 102),
    ];
    const entryTime = 3 * FOUR_H + FOUR_H + 1;
    const r = analyzeExtension(closeExtended, maValue, { three: candles4h, four: candles1h }, ext, entryTime);
    expect(r.threeOk).toBe(true);
    expect(r.fourOk).toBe(true);
    expect(r.threeInterval).toBe('4h');
    expect(r.fourInterval).toBe('1h');
  });
});
