'use strict';

const { buildClosedLegTimeline, reinforceTradeFields } = require('../bot/shared/tradeExecution');

/**
 * Histórico por PERNA do ciclo "Reforço no stop" gravado no trade fechado
 * (rsi_multi_bot_trades.leg_timeline). O bot acumula pernas fechadas em
 * rules_state.rearm.legTimeline / rules_state.reinforce.legTimeline; ao vender, finalizeSell
 * anexa a perna FINAL e persiste o ciclo inteiro.
 */
describe('buildClosedLegTimeline', () => {
  const state = { buy_price: '0.057', buy_time: '2026-09-07T15:18:55.000Z' };

  test('rearm: pernas fechadas + perna final (venda no alvo)', () => {
    const rulesState = {
      rearm: {
        active: true, rungs: 1, entryPrice: 0.057, lastRungAt: '2026-09-07T15:18:55.000Z',
        legTimeline: [
          { entryTime: '2026-09-07T14:00:00.000Z', entryPrice: 0.06, exitTime: '2026-09-07T15:18:53.000Z', exitPrice: 0.057, outcome: 'stop' },
        ],
      },
    };
    const tl = buildClosedLegTimeline(rulesState, state, {
      exitTime: '2026-09-07T18:00:00.000Z', exitPrice: 0.0638, pnlUsdt: 4.2,
    });
    expect(tl).toHaveLength(2);
    expect(tl[0].outcome).toBe('stop');
    expect(tl[1]).toMatchObject({ entryPrice: 0.057, exitPrice: 0.0638, outcome: 'target' });
  });

  test('rearm: perna final estopada quando o P&L do ciclo é negativo', () => {
    const rulesState = { rearm: { active: true, rungs: 2, entryPrice: 0.05, legTimeline: [
      { entryTime: 't0', entryPrice: 0.06, exitTime: 't1', exitPrice: 0.054, outcome: 'stop' },
      { entryTime: 't1', entryPrice: 0.054, exitTime: 't2', exitPrice: 0.05, outcome: 'stop' },
    ] } };
    const tl = buildClosedLegTimeline(rulesState, state, { exitTime: 't3', exitPrice: 0.045, pnlUsdt: -8 });
    expect(tl).toHaveLength(3);
    expect(tl[2].outcome).toBe('stop');
  });

  test('ciclo sem reforço → null (no-op pros outros bots)', () => {
    expect(buildClosedLegTimeline({}, state, { exitTime: 't', exitPrice: 1, pnlUsdt: 1 })).toBeNull();
    expect(buildClosedLegTimeline({ lastExitTime: 'x' }, state, { exitTime: 't', exitPrice: 1, pnlUsdt: 1 })).toBeNull();
  });

  test('ladder: usa lastEntryPrice quando não há entryPrice', () => {
    const rulesState = { reinforce: { active: true, rungs: 2, lastEntryPrice: 0.048, legTimeline: [
      { entryTime: 't0', entryPrice: 0.06, exitTime: 't1', exitPrice: 0.054, outcome: 'stop' },
      { entryTime: 't1', entryPrice: 0.054, exitTime: 't2', exitPrice: 0.048, outcome: 'stop' },
    ] } };
    const tl = buildClosedLegTimeline(rulesState, state, { exitTime: 't3', exitPrice: 0.055, pnlUsdt: 1.1 });
    expect(tl[tl.length - 1]).toMatchObject({ entryPrice: 0.048, exitPrice: 0.055, outcome: 'target' });
  });
});

describe('reinforceTradeFields', () => {
  test('spread condicional: sem reforço não envia nenhuma coluna nova', () => {
    expect(reinforceTradeFields({}, {}, { exitTime: 't', exitPrice: 1, pnlUsdt: 1 })).toEqual({});
  });

  test('rearm ativo: leg_timeline + reinforce_mode + reinforce_rungs', () => {
    const rulesState = { rearm: { active: true, rungs: 3, entryPrice: 0.05, legTimeline: [
      { entryTime: 't0', entryPrice: 0.06, exitTime: 't1', exitPrice: 0.05, outcome: 'stop' },
    ] } };
    const f = reinforceTradeFields(rulesState, { buy_price: '0.05' }, { exitTime: 't2', exitPrice: 0.056, pnlUsdt: 0.3 });
    expect(f.reinforce_mode).toBe('rearm');
    expect(f.reinforce_rungs).toBe(3);
    expect(Array.isArray(f.leg_timeline)).toBe(true);
    expect(f.leg_timeline).toHaveLength(2);
  });

  test('ladder ativo: reinforce_mode "ladder"', () => {
    const rulesState = { reinforce: { active: true, rungs: 1, lastEntryPrice: 0.05, legTimeline: [
      { entryTime: 't0', entryPrice: 0.06, exitTime: 't1', exitPrice: 0.05, outcome: 'stop' },
    ] } };
    const f = reinforceTradeFields(rulesState, { buy_price: '0.05' }, { exitTime: 't2', exitPrice: 0.06, pnlUsdt: 1 });
    expect(f.reinforce_mode).toBe('ladder');
  });
});
