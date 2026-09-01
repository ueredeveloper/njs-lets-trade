'use strict';

const { computeMacdWhatIf } = require('../utils/analyseRsiThresholdBacktest');

/** Ocorrência mínima pro que computeMacdWhatIf lê. */
const occ = (outcome, pnlUsd, macdHistAtSignal, filled = true) => ({ filled, outcome, pnlUsd, macdHistAtSignal });

describe('computeMacdWhatIf — acordeão "E se o MACD confirmasse a entrada?"', () => {
  test('separa trades fechados por sinal do histograma e conta stops/ganhos de cada lado', () => {
    const r = computeMacdWhatIf([
      occ('stop', -5, -0.2),   // histograma <= 0 → o MACD vetaria → stop evitado
      occ('stop', -5, 0.3),    // histograma > 0 → o MACD permitiria → stop mantido
      occ('target', 10, 0.5),  // histograma > 0 → ganho confirmado
      occ('target', 10, -0.1), // histograma <= 0 → ganho perdido
      occ('open', 0, 0.4),     // não fechado → ignorado
      occ('not_filled', null, 0.4, false), // não preenchido → ignorado
    ], '15m');

    expect(r.closedTrades).toBe(4);
    expect(r.evaluated).toBe(4);
    expect(r.warmupSkipped).toBe(0);
    expect(r.stopsAvoided).toBe(1);
    expect(r.gainsBlocked).toBe(1);
    expect(r.gainsConfirmed).toBe(1);
    expect(r.stopsKept).toBe(1);
    expect(r.blocked).toMatchObject({ total: 2, stops: 1, targets: 1 });
    expect(r.allowed).toMatchObject({ total: 2, stops: 1, targets: 1 });
    expect(r.macdPeriods).toBe('12/26/9');
    expect(r.interval).toBe('15m');
  });

  test('trades sem valor de MACD (warmup) ficam de fora (fail-open)', () => {
    const r = computeMacdWhatIf([
      occ('target', 10, null),
      occ('stop', -5, null),
      occ('target', 10, 0.2),
    ], '1h');

    expect(r.warmupSkipped).toBe(2);
    expect(r.evaluated).toBe(1);
    expect(r.gainsConfirmed).toBe(1);
    expect(r.winRateWithMacdPct).toBe(100);
  });

  test('sem trades fechados → tudo zero, sem divisão por zero', () => {
    const r = computeMacdWhatIf([occ('open', 0, 0.1)], '5m');
    expect(r.evaluated).toBe(0);
    expect(r.winRateWithoutMacdPct).toBe(0);
    expect(r.winRateWithMacdPct).toBe(0);
    expect(r.pnlWithoutMacdUsd).toBe(0);
  });
});
