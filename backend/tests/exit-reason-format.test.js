'use strict';

const { buildExitReasonDetail, displayExitReason, packExitReasonForDb } = require('../bot/amap/exitReasonFormat');

describe('exitReasonFormat', () => {
  test('stop MA fixa regra 1', () => {
    const d = buildExitReasonDetail({
      ruleId: 'rule1',
      exitEval: { reason: 'stop_loss_ma', period: 50, interval: '4h' },
      ruleConfig: { stopLoss: { period: 50, interval: '4h' } },
    });
    expect(d.label).toContain('Regra 1');
    expect(d.label).toContain('MA50 4h');
    expect(d.label).toContain('fixa');
  });

  test('stop adaptativo regra 2 na MA de entrada', () => {
    const d = buildExitReasonDetail({
      ruleId: 'rule2',
      exitEval: { reason: 'stop_loss_adaptive', period: 50, interval: '1h', dipPct: 3.2 },
      ruleConfig: { entryMa: { period: 50, interval: '1h' } },
    });
    expect(d.label).toContain('Regra 2');
    expect(d.label).toContain('MA50 1h');
    expect(d.label).toContain('adapt.');
  });

  test('RSI saída regra 1', () => {
    const d = buildExitReasonDetail({
      ruleId: 'rule1',
      exitEval: { reason: 'rsi' },
      ruleConfig: { exitRsi: { interval: '15m', value: 70 } },
    });
    expect(d.label).toBe('[Regra 1] RSI 15m > 70');
  });

  test('pack/unpack para DB', () => {
    const d = buildExitReasonDetail({
      ruleId: 'rule1',
      exitEval: { reason: 'stop_loss_ma', period: 50, interval: '4h' },
      ruleConfig: { stopLoss: { period: 50, interval: '4h' } },
    });
    const stored = packExitReasonForDb(d);
    expect(displayExitReason(stored)).toContain('MA50 4h');
  });
});
