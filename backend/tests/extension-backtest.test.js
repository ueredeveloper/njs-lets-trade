'use strict';

const { buildTradeConfig, checkRsi } = require('../bot/amap/strategyEngine');
const {
  analyzeExtensionHistory,
  simulateForwardTrade,
  classifyExtensionOutcome,
  computeRsiSeries,
} = require('../bot/amap/extensionBacktest');

describe('classifyExtensionOutcome', () => {
  test('entrada confirmada lucrativa', () => {
    expect(classifyExtensionOutcome(true, 5)).toBe('CONFIRMED_WIN');
  });
  test('entrada confirmada com prejuízo', () => {
    expect(classifyExtensionOutcome(true, -3)).toBe('CONFIRMED_LOSS');
  });
  test('bloqueio que salvou (entrada não realizada, teria perdido)', () => {
    expect(classifyExtensionOutcome(false, -4)).toBe('BLOCKED_SAVED');
  });
  test('bloqueio perdeu oportunidade', () => {
    expect(classifyExtensionOutcome(false, 2)).toBe('BLOCKED_MISSED');
  });
});

describe('simulateForwardTrade', () => {
  const config = buildTradeConfig({
    entryRsi: { interval: '15m', value: 99, period: 2 },
    exitRsi:  { interval: '15m', value: 50, period: 2 },
    maConditions: [],
    extension: { enabled: false },
    stopLoss: { enabled: false },
  });

  test('simula saída por RSI no histórico', () => {
    const entrySeries = [
      { openTime: 0, close: 100, rsi: 20 },
      { openTime: 1, close: 101, rsi: 40 },
      { openTime: 2, close: 102, rsi: 55 },
    ];
    const exitSeries = entrySeries;
    const cMap = { '15m': entrySeries.map(p => ({ ...p, open: p.close, high: p.close, low: p.close })) };

    const result = simulateForwardTrade(0, entrySeries, exitSeries, cMap, config, {});
    expect(result.closed).toBe(true);
    expect(result.exitReason).toBe('rsi');
    expect(result.pnlPct).toBeGreaterThan(0);
  });
});

describe('analyzeExtensionHistory — dados locais BTCUSDT', () => {
  const fs   = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '../data/candlestick/BTCUSDT-15m.json');

  const maybe = fs.existsSync(file) ? test : test.skip;

  maybe('roda no histórico local e retorna summary', () => {
    const raw  = JSON.parse(fs.readFileSync(file, 'utf8'));
    const arr  = Array.isArray(raw) ? raw : Object.values(raw)[0];
    const m15  = arr.map(c => ({
      openTime: Number(c.openTime ?? c[0]),
      open: parseFloat(c.open ?? c[1]),
      high: parseFloat(c.high ?? c[2]),
      low: parseFloat(c.low ?? c[3]),
      close: parseFloat(c.close ?? c[4]),
    }));

    const config = buildTradeConfig({
      entryRsi: { interval: '15m', value: 30 },
      exitRsi:  { interval: '15m', value: 70 },
      maConditions: [{ period: 50, interval: '1h', mode: 'strict_above' }],
      extension: {
        enabled: true, maPeriod: 50, maInterval: '1h',
        abovePct: 5, threeInterval: '1h', fourInterval: '1h',
        threeCandles: true, fourCandles: true,
      },
      stopLoss: { enabled: true, period: 50, interval: '1h' },
    });

    const cMap = { '15m': m15, '1h': m15.filter((_, i) => i % 4 === 0) };
    const { signals, summary } = analyzeExtensionHistory(cMap, config);

    expect(summary).toHaveProperty('totalExtendedSignals');
    expect(summary).toHaveProperty('blocked.saved');
    expect(summary).toHaveProperty('confirmed.wins');

    for (const s of signals) {
      expect(['CONFIRMED_WIN', 'CONFIRMED_LOSS', 'BLOCKED_SAVED', 'BLOCKED_MISSED']).toContain(s.outcome);
      if (s.outcome === 'BLOCKED_SAVED') expect(s.pnlPct).toBeLessThan(0);
      if (s.outcome === 'BLOCKED_MISSED') expect(s.pnlPct).toBeGreaterThanOrEqual(0);
    }
  });
});
