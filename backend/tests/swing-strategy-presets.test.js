'use strict';

const { isSwingStrategy } = require('../bot/swing/strategyPresets');
const { isMaCrossStrategy, buildTradeConfig: buildMaCrossTradeConfig } = require('../bot/ma-cross/strategyPresets');
const { buildTradeConfig: buildSwingTradeConfig } = require('../bot/swing/strategyPresets');

describe('swing strategyPresets', () => {
  test('ma-cross não é swing', () => {
    expect(isSwingStrategy('ma-cross')).toBe(false);
    expect(isMaCrossStrategy('ma-cross')).toBe(true);
  });

  test('payload ma_cross não vira kind rsi no builder swing', () => {
    const payload = {
      strategyId: 'ma-cross',
      kind: 'ma_cross',
      label: 'MA Cross',
      entry: {
        ma1: { period: 9, interval: '15m' },
        ma2: { period: 21, interval: '15m' },
        direction: 'cross_up',
      },
      exit: {
        maCross: {
          ma1: { period: 9, interval: '15m' },
          ma2: { period: 21, interval: '15m' },
          direction: 'cross_down',
        },
      },
    };
    expect(buildMaCrossTradeConfig(payload).kind).toBe('ma_cross');
    expect(buildSwingTradeConfig(payload).kind).toBe('rsi');
    expect(isSwingStrategy('ma-cross')).toBe(false);
  });
});
