'use strict';

const {
  checkStopLossHits,
  getAdaptiveStopFloors,
  evaluateExit,
  maKey,
} = require('../bot/amap/strategyEngine');

const baseConfig = {
  stopLoss: { enabled: true, fixedEnabled: true, adaptiveEnabled: true, period: 50, interval: '4h' },
  maFilters: [
    { period: 50, interval: '4h', mode: 'strict_above' },
    { period: 50, interval: '1h', mode: 'adaptive' },
  ],
  exitRsi: { interval: '15m', period: 14, operator: '>', value: 70 },
};

describe('stop loss dual (MA fixa + piso adaptativo)', () => {
  const maSnap = {
    [maKey(50, '1h')]: { ma: 100 },
    [`sl_${maKey(50, '4h')}`]: { ma: 90 },
  };
  const adaptiveDips = { [maKey(50, '1h')]: 3 };

  test('getAdaptiveStopFloors usa dip% abaixo da MA adaptativa', () => {
    const floors = getAdaptiveStopFloors(maSnap, adaptiveDips, baseConfig);
    expect(floors).toHaveLength(1);
    expect(floors[0].floor).toBeCloseTo(97);
    expect(floors[0].dipPct).toBe(3);
  });

  test('dispara stop adaptativo quando preço cai abaixo do piso mas acima da MA 4h', () => {
    const floors = getAdaptiveStopFloors(maSnap, adaptiveDips, baseConfig);
    const hit = checkStopLossHits(96, 90, floors, baseConfig);
    expect(hit.reason).toBe('stop_loss_adaptive');
    expect(hit.stopLossLevel).toBeCloseTo(97);
  });

  test('dispara stop MA 4h quando preço está abaixo da MA 4h mas acima do piso adaptativo', () => {
    const snap = {
      [maKey(50, '1h')]: { ma: 92 },
      [`sl_${maKey(50, '4h')}`]: { ma: 90 },
    };
    const dips = { [maKey(50, '1h')]: 3 };
    const floors = getAdaptiveStopFloors(snap, dips, baseConfig);
    const hit = checkStopLossHits(89.5, 90, floors, baseConfig);
    expect(hit.reason).toBe('stop_loss_ma');
  });

  test('no mesmo candle, reporta o nível mais alto violado (primeiro na queda)', () => {
    const floors = getAdaptiveStopFloors(maSnap, adaptiveDips, baseConfig);
    const hit = checkStopLossHits(85, 90, floors, baseConfig);
    expect(hit.reason).toBe('stop_loss_adaptive');
    expect(hit.stopLossLevel).toBeCloseTo(97);
  });

  test('evaluateExit prioriza stop antes do RSI', () => {
    const result = evaluateExit({
      close: 96,
      exitRsi: 75,
      stopLossMa: 90,
      maSnap,
      adaptiveDips,
      config: baseConfig,
    });
    expect(result.exit).toBe(true);
    expect(result.reason).toBe('stop_loss_adaptive');
  });

  test('só MA fixa quando adaptiveEnabled=false', () => {
    const cfg = { ...baseConfig, stopLoss: { ...baseConfig.stopLoss, adaptiveEnabled: false } };
    const floors = getAdaptiveStopFloors(maSnap, adaptiveDips, cfg);
    expect(floors).toHaveLength(0);
    const hit = checkStopLossHits(89, 90, floors, cfg);
    expect(hit.reason).toBe('stop_loss_ma');
  });

  test('só adaptativo quando fixedEnabled=false', () => {
    const cfg = { ...baseConfig, stopLoss: { ...baseConfig.stopLoss, fixedEnabled: false } };
    const hit = checkStopLossHits(96, 90, getAdaptiveStopFloors(maSnap, adaptiveDips, cfg), cfg);
    expect(hit.reason).toBe('stop_loss_adaptive');
    const hitMa = checkStopLossHits(100, 90, getAdaptiveStopFloors(maSnap, adaptiveDips, cfg), cfg);
    expect(hitMa).toBeNull();
  });
});
