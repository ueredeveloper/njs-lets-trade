'use strict';

const { buildExitReasonDetail, buildPendingCancelDetail, displayExitReason, packExitReasonForDb } = require('../bot/amap/exitReasonFormat');

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

  test('pending cancel timeout com tempo decorrido', () => {
    const d = buildPendingCancelDetail({
      reason: 'CANCELLED_TIMEOUT',
      ruleId: 'rule1',
      entryKind: 'rsi',
      pendingSince: 0,
      cancelTime: 31 * 60_000,
      elapsedMs: 31 * 60_000,
      pendingTimeoutMs: 30 * 60_000,
      triggerPrice: 2095.36,
      limitPrice: 2093.26,
    });
    expect(d.label).toContain('31min');
    expect(d.label).toContain('30min');
    expect(d.detail).toContain('2093.26');
    expect(d.detail).toContain('2095.36');
  });
});
