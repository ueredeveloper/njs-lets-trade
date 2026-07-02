'use strict';

const registry = require('../bot/multitradeRegistry');
const { configFingerprint } = require('../bot/multitradeWatch');

describe('multitradeRegistry', () => {
  afterEach(() => {
    for (const s of registry.list()) registry.unregister(s.rowId);
  });

  test('sessionKey normaliza símbolo', () => {
    expect(registry.sessionKey('btcusdt', 'ma-cross')).toBe('BTCUSDT:ma-cross');
  });

  test('register e list', () => {
    registry.register('id-1', { rowId: 'id-1', symbol: 'BTCUSDT', strategyId: 'ma-cross', key: registry.sessionKey('BTCUSDT', 'ma-cross') });
    expect(registry.has('id-1')).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });
});

describe('configFingerprint', () => {
  test('muda quando trade_config muda', () => {
    const a = configFingerprint({ updated_at: 't1', capital: 40, trade_config: { kind: 'ma_cross' } });
    const b = configFingerprint({ updated_at: 't1', capital: 40, trade_config: { kind: 'rsi' } });
    expect(a).not.toBe(b);
  });
});
