'use strict';

const {
  matchesCachedPreset,
  matchesDefaultPreset,
  CACHED_PRESETS,
  CACHED_AGE_MIN,
  REFRESH_TICK_MS,
  buildSnapshotForPreset,
} = require('../cache/maCrossCache');

describe('maCrossCache — candle interval ≠ temporal age', () => {
  test('matchesCachedPreset: 1m candles + ≤5min temporal', () => {
    expect(matchesCachedPreset({
      period1: 9, interval1: '1m', period2: 21, interval2: '1m',
      mode: 'cross_up', maxAgeMin: '5', tolerancePct: 0.5, live: true,
    })).toBe('1m|5');
  });

  test('matchesCachedPreset: 5m candles + ≤5min temporal', () => {
    expect(matchesCachedPreset({
      period1: 9, interval1: '5m', period2: 21, interval2: '5m',
      mode: 'cross_up', maxAgeMin: '5', tolerancePct: 0.5, live: true,
    })).toBe('5m|5');
  });

  test('matchesCachedPreset: 15m candles + ≤5min temporal (não confunde com 15min)', () => {
    expect(matchesCachedPreset({
      period1: 9, interval1: '15m', period2: 21, interval2: '15m',
      mode: 'cross_up', maxAgeMin: '5', tolerancePct: 0.5, live: true,
    })).toBe('15m|5');

    expect(matchesCachedPreset({
      period1: 9, interval1: '15m', period2: 21, interval2: '15m',
      mode: 'cross_up', maxAgeMin: '15', tolerancePct: 0.5, live: true,
    })).toBeNull();
  });

  test('matchesDefaultPreset', () => {
    expect(matchesDefaultPreset({
      period1: 9, interval1: '5m', period2: 21, interval2: '5m',
      mode: 'cross_up', maxAgeMin: '5', tolerancePct: 0.5, live: true,
    })).toBe(true);
  });

  test('buildSnapshotForPreset gera nomes corretos', () => {
    const s1 = buildSnapshotForPreset(CACHED_PRESETS[0], 1_700_000_000_000);
    const s5 = buildSnapshotForPreset(CACHED_PRESETS[1], 1_700_000_000_000);
    const s15 = buildSnapshotForPreset(CACHED_PRESETS[2], 1_700_000_000_000);
    expect(s1.name).toBe('1m|macross|9|1m|21|1m|xup|age|5|tol|0.5');
    expect(s5.name).toBe('5m|macross|9|5m|21|5m|xup|age|5|tol|0.5');
    expect(s15.name).toBe('15m|macross|9|15m|21|15m|xup|age|5|tol|0.5');
  });

  test('CACHED_PRESET keys', () => {
    expect(CACHED_AGE_MIN).toEqual(['1m|5', '5m|5', '15m|5']);
    expect(CACHED_PRESETS).toHaveLength(3);
    expect(REFRESH_TICK_MS).toBe(5 * 60_000);
  });
});
