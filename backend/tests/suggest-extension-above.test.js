'use strict';

const { suggestExtensionAbovePct, netBenefitAtThreshold } = require('../bot/amap/suggestExtensionAbovePct');
const { buildTradeConfig } = require('../bot/amap/strategyEngine');

describe('suggestExtensionAbovePct', () => {
  const H = 900_000;
  const H1 = 3_600_000;

  function buildCMap() {
    const m15 = [];
    const m1h = [];
    for (let i = 0; i < 300; i++) {
      const price = 100 + Math.sin(i / 8) * 8 + (i > 200 ? 4 : 0);
      m15.push({
        openTime: i * H,
        open: price, high: price * 1.005, low: price * 0.995, close: price,
      });
      if (i % 4 === 0) {
        m1h.push({
          openTime: i * H,
          open: price, high: price * 1.005, low: price * 0.995, close: price,
        });
      }
    }
    return { '15m': m15, '1h': m1h };
  }

  test('retorna sugestão com sinais históricos', () => {
    const config = buildTradeConfig({
      entryRsi: { interval: '15m', period: 2, operator: '<', value: 70 },
      exitRsi:  { interval: '15m', period: 2, operator: '>', value: 50 },
      maConditions: [],
      extension: {
        enabled: true, maPeriod: 20, maInterval: '1h', abovePct: 5,
        threeInterval: '1h', fourInterval: '1h',
        threeCandles: true, fourCandles: true, confirmLogic: 'any',
      },
      stopLoss: { enabled: false },
    });

    const r = suggestExtensionAbovePct(buildCMap(), config, { minSignalsInZone: 1 });
    expect(r.suggestedAbovePct).toBeGreaterThanOrEqual(2);
    expect(r.suggestedAbovePct).toBeLessThanOrEqual(15);
    expect(r.signalCount).toBeGreaterThan(0);
  });

  test('sem sinais → default 5%', () => {
    const config = buildTradeConfig({
      entryRsi: { interval: '15m', period: 14, operator: '<', value: 1 },
      exitRsi:  { interval: '15m', period: 14, operator: '>', value: 99 },
      maConditions: [],
      extension: { enabled: true, maPeriod: 50, maInterval: '1h' },
      stopLoss: { enabled: false },
    });
    const r = suggestExtensionAbovePct({ '15m': [], '1h': [] }, config);
    expect(r.usedDefault).toBe(true);
    expect(r.suggestedAbovePct).toBe(5);
  });

  test('netBenefitAtThreshold', () => {
    const signals = [
      { aboveMaPct: 6, confirmed: false, pnlPct: -5 },
      { aboveMaPct: 7, confirmed: true, pnlPct: 3 },
    ];
    const r = netBenefitAtThreshold(signals, 5);
    expect(r.netBenefit).toBe(5);
    expect(r.inZone).toBe(2);
  });
});
