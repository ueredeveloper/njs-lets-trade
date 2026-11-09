const { applyMinStop, MIN_STOP_PCT } = require('../bot/shared/manualOcoStop');

describe('applyMinStop — stop no mínimo 10% abaixo', () => {
  test('mínimo configurado é 10%', () => {
    expect(MIN_STOP_PCT).toBe(10);
  });

  test('stop a menos de 10% desce para −10%', () => {
    expect(applyMinStop(95, 100)).toBeCloseTo(90);
  });

  test('stop já mais longe que 10% não muda', () => {
    expect(applyMinStop(80, 100)).toBe(80);
  });

  test('sem preço de referência mantém o stop', () => {
    expect(applyMinStop(95, undefined)).toBe(95);
  });
});
