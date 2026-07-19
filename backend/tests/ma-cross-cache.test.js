'use strict';

const {
  matchesCachedPreset,
  matchesDefaultPreset,
  CACHED_PRESETS,
  CACHED_AGE_MIN,
  REFRESH_TICK_MS,
  buildSnapshotForPreset,
} = require('../cache/maCrossCache');

describe('maCrossCache — preset único 4h (cruzou ↑ / próximo de cruzar ↑)', () => {
  test('matchesCachedPreset: 4h cross_up (último candle)', () => {
    expect(matchesCachedPreset({
      period1: 9, interval1: '4h', period2: 21, interval2: '4h',
      mode: 'cross_up', maxAgeMin: 'last', tolerancePct: 0.5, live: true,
    })).toBe('4h|last');
  });

  test('matchesCachedPreset: 4h near_up (gap ≤0.5%)', () => {
    expect(matchesCachedPreset({
      period1: 9, interval1: '4h', period2: 21, interval2: '4h',
      mode: 'near_up', maxAgeMin: 'last', tolerancePct: 0, proximityPct: 0.5, live: true,
    })).toBe('4h|nearup');
  });

  test('matchesCachedPreset: outros intervalos não batem mais no cache', () => {
    expect(matchesCachedPreset({
      period1: 9, interval1: '5m', period2: 21, interval2: '5m',
      mode: 'cross_up', maxAgeMin: '5', tolerancePct: 0.5, live: true,
    })).toBeNull();
  });

  test('matchesDefaultPreset', () => {
    expect(matchesDefaultPreset({
      period1: 9, interval1: '4h', period2: 21, interval2: '4h',
      mode: 'cross_up', maxAgeMin: 'last', tolerancePct: 0.5, live: true,
    })).toBe(true);
  });

  test('buildSnapshotForPreset gera nomes corretos', () => {
    const sCross = buildSnapshotForPreset(CACHED_PRESETS[0], 1_700_000_000_000);
    const sNear = buildSnapshotForPreset(CACHED_PRESETS[1], 1_700_000_000_000);
    expect(sCross.name).toBe('4h|macross|9|4h|21|4h|xup|age|last|tol|0.5');
    expect(sNear.name).toBe('4h|macross|9|4h|21|4h|nearup|prox|0.5');
  });

  test('CACHED_PRESET keys', () => {
    expect(CACHED_AGE_MIN).toEqual(['4h|last', '4h|nearup']);
    expect(CACHED_PRESETS).toHaveLength(2);
    expect(REFRESH_TICK_MS).toBe(5 * 60_000);
  });
});
