'use strict';

const ti = require('technicalindicators');
const {
  checkStopLossHits,
  getAdaptiveStopFloors,
  evaluateExit,
  maKey,
} = require('../bot/amap/strategyEngine');

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

function slMaSnapFromCandles(candles, period, interval) {
  const key = `sl_${maKey(period, interval)}`;
  const closes = candles.map(c => c.close);
  const maArr = ti.SMA.calculate({ values: closes, period });
  const ma = maArr[maArr.length - 1];
  return { [key]: { ma, candles, period, interval } };
}

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

  test('teto 5% sobre preço de entrada — MA fixa longe não permite perda >5%', () => {
    const entryPrice = 100;
    const hit = checkStopLossHits(94, 80, [], baseConfig, entryPrice);
    expect(hit.reason).toBe('stop_loss_ma');
    expect(hit.stopLossLevel).toBeCloseTo(95);
    const noHit = checkStopLossHits(96, 80, [], baseConfig, entryPrice);
    expect(noHit).toBeNull();
  });

  test('dip adaptativo acima de 5% é limitado a 5%', () => {
    const dips = { [maKey(50, '1h')]: 8 };
    const floors = getAdaptiveStopFloors(maSnap, dips, baseConfig);
    expect(floors[0].dipPct).toBe(5);
    expect(floors[0].floor).toBeCloseTo(95);
  });

  test('só limite −5% da entrada quando MA fixa e adaptativo desligados', () => {
    const cfg = {
      stopLoss: {
        enabled: true, fixedEnabled: false, adaptiveEnabled: false,
        pctCapEnabled: true, maxLossPct: 5,
      },
    };
    const entryPrice = 100;
    const hit = checkStopLossHits(94.5, null, [], cfg, entryPrice);
    expect(hit.reason).toBe('stop_loss_pct_cap');
    expect(hit.stopLossLevel).toBeCloseTo(95);
    const ok = checkStopLossHits(96, null, [], cfg, entryPrice);
    expect(ok).toBeNull();
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

  test('entrada MA: stop adaptativo só na MA do stop (4h), ignora MA50 1h', () => {
    const cfg = {
      ...baseConfig,
      maFilters: [
        { period: 50, interval: '4h', mode: 'adaptive' },
        { period: 50, interval: '1h', mode: 'adaptive' },
      ],
    };
    const snap = {
      [maKey(50, '4h')]: { ma: 100 },
      [maKey(50, '1h')]: { ma: 100 },
      [`sl_${maKey(50, '4h')}`]: { ma: 100 },
    };
    const dips = { [maKey(50, '4h')]: 3, [maKey(50, '1h')]: 3 };
    expect(getAdaptiveStopFloors(snap, dips, cfg)).toHaveLength(2);
    const maFloors = getAdaptiveStopFloors(snap, dips, cfg, { entryKind: 'ma' });
    expect(maFloors).toHaveLength(1);
    expect(maFloors[0].interval).toBe('4h');
    const hit = evaluateExit({
      close: 96,
      exitRsi: 75,
      stopLossMa: 90,
      maSnap: snap,
      adaptiveDips: dips,
      config: cfg,
      entryKind: 'ma',
    });
    expect(hit.reason).toBe('stop_loss_adaptive');
    expect(hit.adaptiveKey).toBe(maKey(50, '4h'));
  });

  test('MA fixa: bloqueia stop se N candles anteriores não fecharam acima da MA', () => {
    const closes = Array(65).fill(120);
    closes[55] = 95;
    const candles = makeCandles(closes);
    const snap = slMaSnapFromCandles(candles, 50, '4h');
    const cfg = {
      stopLoss: {
        enabled: true, fixedEnabled: true, adaptiveEnabled: false,
        period: 50, interval: '4h',
        fixedAboveMaEnabled: true, fixedAboveMaCandles: 10,
      },
    };
    const stopMa = snap[`sl_${maKey(50, '4h')}`].ma;
    const blocked = checkStopLossHits(89, stopMa, [], cfg, null, snap);
    expect(blocked).toBeNull();
  });

  test('MA fixa: dispara stop quando preço abaixo da MA e N candles acima ok', () => {
    const closes = Array.from({ length: 65 }, (_, i) => 100 + i);
    closes[63] = 90;
    closes[64] = 105;
    const candles = makeCandles(closes);
    const snap = slMaSnapFromCandles(candles, 50, '4h');
    const cfg = {
      stopLoss: {
        enabled: true, fixedEnabled: true, adaptiveEnabled: false,
        period: 50, interval: '4h',
        fixedAboveMaEnabled: true, fixedAboveMaCandles: 10,
      },
    };
    const stopMa = snap[`sl_${maKey(50, '4h')}`].ma;
    const hit = checkStopLossHits(89, stopMa, [], cfg, null, snap);
    expect(hit.reason).toBe('stop_loss_ma');
  });

  test('piso adaptativo: bloqueia stop se N candles anteriores não fecharam acima da MA', () => {
    const closes = Array(65).fill(120);
    closes[55] = 95;
    const candles = makeCandles(closes);
    const key = maKey(50, '1h');
    const snap = { [key]: slMaSnapFromCandles(candles, 50, '1h')[`sl_${key}`] };
    const cfg = {
      stopLoss: {
        enabled: true, fixedEnabled: false, adaptiveEnabled: true,
        adaptivePeriod: 50, adaptiveInterval: '1h',
        adaptiveAboveMaEnabled: true, adaptiveAboveMaCandles: 10,
      },
      maFilters: [{ period: 50, interval: '1h', mode: 'adaptive' }],
    };
    const floors = getAdaptiveStopFloors(snap, { [key]: 3 }, cfg);
    const blocked = checkStopLossHits(96, null, floors, cfg, null, snap);
    expect(blocked).toBeNull();
  });
});
