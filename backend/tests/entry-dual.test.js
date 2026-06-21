'use strict';

const {
  checkMaEntryTrigger,
  resolveEntrySignal,
  entryRsiPathActive,
  entryMaPathActive,
  getEntryScanInterval,
  maKey,
} = require('../bot/amap/strategyEngine');
const { normalizeTradeConfig, toEngineConfig } = require('../bot/amap/tradeConfigSchema');

const baseMaSnap = {
  [maKey(50, '4h')]: { ma: 100 },
  [maKey(50, '1h')]: { ma: 95 },
};

function cfg(overrides = {}) {
  return toEngineConfig(normalizeTradeConfig({
    entryRsi: { interval: '15m', period: 14, operator: '<', value: 30 },
    entryRsiPath: { enabled: true },
    entryMa: { enabled: false },
    maConditions: [
      { period: 50, interval: '4h', mode: 'strict_above' },
      { period: 50, interval: '1h', mode: 'adaptive' },
    ],
    extension: { enabled: false },
    ...overrides,
  }));
}

describe('entrada dupla RSI + MA', () => {
  test('entryRsiPathActive / entryMaPathActive defaults', () => {
    const c = cfg();
    expect(entryRsiPathActive(c)).toBe(true);
    expect(entryMaPathActive(c)).toBe(false);
  });

  test('checkMaEntryTrigger touch quando close perto da MA', () => {
    const config = cfg({
      entryMa: { enabled: true, period: 50, interval: '1h', trigger: 'touch', tolerancePct: 1 },
    });
    const maSnap = { [maKey(50, '1h')]: { ma: 100 } };
    const hit = checkMaEntryTrigger({
      close: 100.5, low: 99, prevClose: 98, maSnap, config,
    });
    expect(hit.triggered).toBe(true);
  });

  test('checkMaEntryTrigger cross_up', () => {
    const config = cfg({
      entryMa: { enabled: true, period: 50, interval: '1h', trigger: 'cross_up' },
    });
    const maSnap = { [maKey(50, '1h')]: { ma: 100 } };
    expect(checkMaEntryTrigger({ close: 101, low: 99, prevClose: 99, maSnap, config }).triggered).toBe(true);
    expect(checkMaEntryTrigger({ close: 99, low: 98, prevClose: 97, maSnap, config }).triggered).toBe(false);
  });

  test('resolveEntrySignal — caminho RSI', () => {
    const config = cfg();
    const r = resolveEntrySignal({
      entryRsi: 25, close: 110, low: 108, prevClose: 105,
      entryTimeMs: Date.now(), config, maSnap: baseMaSnap, adaptiveDips: {},
    });
    expect(r.allowed).toBe(true);
    expect(r.entryKind).toBe('rsi');
  });

  test('resolveEntrySignal — caminho MA com RSI opcional', () => {
    const config = cfg({
      entryRsiPath: { enabled: false },
      entryMa: {
        enabled: true, period: 50, interval: '1h', trigger: 'touch', tolerancePct: 1,
        requireRsi: true,
        entryRsi: { interval: '15m', period: 14, operator: '<', value: 40 },
      },
    });
    const maSnap = { ...baseMaSnap, [maKey(50, '1h')]: { ma: 100 } };
    const ok = resolveEntrySignal({
      entryRsi: 35, maPathRsi: 35, close: 110,
      maCtx: { close: 100.2, low: 99.5, prevClose: 98 },
      entryTimeMs: Date.now(), config, maSnap, adaptiveDips: {},
    });
    expect(ok.allowed).toBe(true);
    expect(ok.entryKind).toBe('ma');

    const blocked = resolveEntrySignal({
      entryRsi: 45, maPathRsi: 45, close: 110,
      maCtx: { close: 100.2, low: 99.5, prevClose: 98 },
      entryTimeMs: Date.now(), config, maSnap, adaptiveDips: {},
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('NO_ENTRY_SIGNAL');
  });

  test('getEntryScanInterval escolhe intervalo mais fino', () => {
    const config = cfg({
      entryMa: { enabled: true, period: 200, interval: '1h', trigger: 'touch' },
    });
    expect(getEntryScanInterval(config)).toBe('15m');
  });
});
