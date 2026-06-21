'use strict';

const { buildRsiCandidates, buildToleranceCandidates, scoreTrades } = require('../bot/amap/entrySuggestShared');
const { suggestEntryRsi } = require('../bot/amap/suggestEntryRsi');
const { suggestEntryMa } = require('../bot/amap/suggestEntryMa');
const { toEngineConfig, normalizeTradeConfig } = require('../bot/amap/tradeConfigSchema');

describe('sugestão de entradas RSI / MA', () => {
  test('buildRsiCandidates gera faixa em torno do âncora', () => {
    const c = buildRsiCandidates(30, '<', { step: 2, span: 4 });
    expect(c).toContain(30);
    expect(c).toContain(28);
    expect(c).toContain(34);
  });

  test('buildToleranceCandidates inclui âncora', () => {
    const c = buildToleranceCandidates(0.5, { step: 0.25, span: 0.5 });
    expect(c.some(v => Math.abs(v - 0.5) < 0.01)).toBe(true);
  });

  test('scoreTrades calcula métricas', () => {
    const s = scoreTrades([{ pnlPct: 2 }, { pnlPct: -1 }, { pnlPct: 3 }]);
    expect(s.tradeCount).toBe(3);
    expect(s.avgPnl).toBeCloseTo(1.33, 1);
    expect(s.winRate).toBeCloseTo(66.7, 0);
  });

  test('suggestEntryRsi retorna default sem candles', () => {
    const config = toEngineConfig(normalizeTradeConfig({
      entryRsi: { interval: '15m', period: 14, operator: '<', value: 30 },
      extension: { enabled: false },
    }));
    const r = suggestEntryRsi({}, config);
    expect(r.suggestedEntryRsi).toBe(30);
    expect(r.usedDefault).toBe(true);
    expect(r.sweep.length).toBeGreaterThan(0);
  });

  test('suggestEntryMa retorna default sem candles', () => {
    const config = toEngineConfig(normalizeTradeConfig({
      entryRsiPath: { enabled: false },
      entryMa: { enabled: true, period: 50, interval: '1h', trigger: 'touch', tolerancePct: 0.5 },
      extension: { enabled: false },
    }));
    const r = suggestEntryMa({}, config);
    expect(r.suggestedTolerancePct).toBe(0.5);
    expect(r.usedDefault).toBe(true);
  });
});
