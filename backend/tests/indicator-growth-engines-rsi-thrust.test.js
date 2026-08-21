'use strict';

jest.mock('technicalindicators', () => ({
  RSI: { calculate: jest.fn() },
  BollingerBands: { calculate: jest.fn() },
}));

const { RSI } = require('technicalindicators');
const { computeRsiThrust } = require('../utils/indicatorGrowthEngines');

function fakeCandles(n) {
  return Array.from({ length: n }, (_, i) => ({ close: String(100 + i) }));
}

describe('computeRsiThrust', () => {
  afterEach(() => jest.clearAllMocks());

  test('detecta arranques 50→70 e mede minutos/velocidade', () => {
    RSI.calculate.mockReturnValue([45, 48, 51, 55, 62, 71, 68, 47, 52, 58, 66, 72]);

    const result = computeRsiThrust(fakeCandles(20), { period: 14, from: 50, to: 70, interval: '15m' });

    expect(result.totalOccurrences).toBe(2);
    expect(result.avgMinutes).toBeCloseTo(45, 1);
    expect(result.avgVelocity).toBeCloseTo((70 - 50) / 45, 3);
    expect(result.current.inProgress).toBe(false);
    expect(result.current.currentRsi).toBeCloseTo(72, 2);
  });

  test('sinaliza arranque em andamento ("explosão" agora) quando ainda não chegou no alvo', () => {
    RSI.calculate.mockReturnValue([45, 48, 51, 55, 62]);

    const result = computeRsiThrust(fakeCandles(20), { period: 14, from: 50, to: 70, interval: '15m' });

    expect(result.totalOccurrences).toBe(0);
    expect(result.avgMinutes).toBeNull();
    expect(result.current).toEqual({ inProgress: true, minutesElapsed: 30, currentRsi: 62 });
  });

  test('reseta o ciclo se o RSI recuar abaixo de `from` antes de chegar no alvo', () => {
    RSI.calculate.mockReturnValue([45, 51, 55, 48, 52, 71]);

    const result = computeRsiThrust(fakeCandles(20), { period: 14, from: 50, to: 70, interval: '5m' });

    expect(result.totalOccurrences).toBe(1);
    expect(result.avgMinutes).toBeCloseTo(5, 1);
  });

  test('candles insuficientes retorna null', () => {
    const result = computeRsiThrust(fakeCandles(5), { period: 14, from: 50, to: 70, interval: '15m' });
    expect(result).toBeNull();
    expect(RSI.calculate).not.toHaveBeenCalled();
  });

  test('"to" menor ou igual a "from" lança erro', () => {
    expect(() => computeRsiThrust(fakeCandles(20), { from: 70, to: 50, interval: '15m' }))
      .toThrow('rsiThrust: "to" deve ser maior que "from"');
  });
});
