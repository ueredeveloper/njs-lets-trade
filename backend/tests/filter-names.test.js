'use strict';

const {
  buildRsiFilterName,
  buildMaFilterName,
  buildMaCrossFilterName,
  parseCompareToken,
} = require('../utils/filterNames');

describe('filterNames', () => {
  const conditions = [
    { type: 'above', value: 20 },
    { type: 'below', value: 30 },
  ];

  test('RSI nome em inglês', () => {
    expect(buildRsiFilterName('15m', conditions, 'en')).toBe('15m|rsi|abov|20|belw|30');
  });

  test('RSI nome em português', () => {
    expect(buildRsiFilterName('15m', conditions, 'pt')).toBe('15m|rsi|acim|20|abaix|30');
  });

  test('MA nome acima do close (en)', () => {
    expect(buildMaFilterName('1h', 50, 'above', 'close', 'en')).toBe('1h|ma|50|abov|close');
  });

  test('MA nome acima do close (pt)', () => {
    expect(buildMaFilterName('1h', 50, 'above', 'close', 'pt')).toBe('1h|ma|50|acim|close');
  });

  test('MA nome abaixo do close (en)', () => {
    expect(buildMaFilterName('1h', 50, 'below', 'close', 'en')).toBe('1h|ma|50|belw|close');
  });

  test('MA nome abaixo do close (pt)', () => {
    expect(buildMaFilterName('1h', 50, 'below', 'close', 'pt')).toBe('1h|ma|50|abaix|close');
  });

  test('parse tokens legado e novos', () => {
    expect(parseCompareToken('a')).toBe('above');
    expect(parseCompareToken('ab')).toBe('above');
    expect(parseCompareToken('ac')).toBe('above');
    expect(parseCompareToken('abov')).toBe('above');
    expect(parseCompareToken('acim')).toBe('above');
    expect(parseCompareToken('b')).toBe('below');
    expect(parseCompareToken('belw')).toBe('below');
    expect(parseCompareToken('abaix')).toBe('below');
  });

  test('MA cross nome cruzamento', () => {
    expect(buildMaCrossFilterName('15m', 9, '15m', 21, '15m', 'cross_up', { maxAgeMin: '5', tolerancePct: 0.5 }))
      .toBe('15m|macross|9|15m|21|15m|xup|age|5|tol|0.5');
  });

  test('MA cross nome proximidade', () => {
    expect(buildMaCrossFilterName('1m', 9, '1m', 21, '1m', 'near_up', { proximityPct: 0.5 }))
      .toBe('1m|macross|9|1m|21|1m|nearup|prox|0.5');
  });
});
