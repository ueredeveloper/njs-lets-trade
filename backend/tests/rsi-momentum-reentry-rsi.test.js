'use strict';

const { RSI } = require('technicalindicators');
const {
  evaluateReentryRsiSignal,
  getRequiredSpecs,
} = require('../bot/rsi-momentum/strategyEngine');
const { normalizeRsiMomentumConfig, RSI_MOMENTUM_DEFAULTS } = require('../bot/rsi-momentum/tradeConfigSchema');

const RSI_PERIOD = 14;

/** Constrói uma série de candles fechados sintética (openTime crescente, OHLC = mesmo close). */
function candles(closes, stepMs = 3_600_000) {
  return closes.map((c, i) => ({
    openTime: i * stepMs,
    open: String(c), high: String(c), low: String(c), close: String(c),
    closeTime: (i + 1) * stepMs - 1,
  }));
}

/** Zigzag em torno de 100 — RSI fica perto de 50, sem cruzar limiares altos (>= 60). */
function zigzag(n) {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 100 : 101));
}

/**
 * Preços cujo RSI(14) cruza PRA CIMA de `threshold` EXATAMENTE no último candle FECHADO — ou
 * seja: `evaluateReentryRsiSignal` (que só dispara na transição, não em "já está acima") acusa o
 * cruzamento sem precisar adivinhar o ponto exato à mão. Zigzag (RSI ~50) + subida gradual (+1 a
 * cada candle) até o RSI cruzar `threshold`; devolve os closes JÁ COM 1 candle extra "em
 * formação" no fim (descartado por closedCandlesOnly), então o cruzamento cai no último FECHADO.
 */
function crossingCloses(threshold = 69) {
  const base = zigzag(30);
  const rise = [];
  let last = base[base.length - 1];
  for (let i = 0; i < 60; i++) { last += 1; rise.push(last); }
  const path = [...base, ...rise];
  const series = RSI.calculate({ values: path, period: RSI_PERIOD });
  const offset = path.length - series.length;
  let crossIdx = -1;
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] < threshold && series[i] >= threshold) { crossIdx = i; break; }
  }
  if (crossIdx < 0) throw new Error('test setup: RSI nunca cruzou — ajuste a subida em crossingCloses');
  const closes = path.slice(0, crossIdx + offset + 1); // ...até o candle do cruzamento (inclusive)
  return [...closes, closes[closes.length - 1] + 0.5]; // + 1 candle "em formação" (descartado)
}

// interval PRÓPRIO diferente do entry.interval (1h) e do confirmInterval (5m) — garante que os
// testes exercitem de verdade a independência dos 3 intervalos, não uma coincidência de defaults.
const REENTRY_IV = '15m';

function baseConfig(overrides = {}) {
  return normalizeRsiMomentumConfig({
    entry: { interval: '1h' },
    exit: {
      reinforceOnStop: {
        enabled: true, mode: 'ladder', reentryTrigger: 'rsiRecross',
        reentryRsi: { interval: REENTRY_IV, rsiThreshold: 69, confirmInterval: '5m', earlyConfirm: { enabled: false }, ...overrides },
      },
    },
  });
}

describe('evaluateReentryRsiSignal — gatilho de reentrada por RSI no reforço', () => {
  test('candles insuficientes → INSUFFICIENT_DATA', () => {
    const config = baseConfig();
    const cMap = { [REENTRY_IV]: candles(zigzag(5)) };
    const r = evaluateReentryRsiSignal(config, cMap);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('INSUFFICIENT_DATA');
  });

  test('RSI nunca cruza o limiar (zigzag em torno de 50) → RSI_NOT_CROSSING', () => {
    const config = baseConfig();
    const cMap = { [REENTRY_IV]: candles(zigzag(40)) };
    const r = evaluateReentryRsiSignal(config, cMap);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('RSI_NOT_CROSSING');
  });

  test('RSI sobe e cruza o limiar no candle fechado mais recente → allowed', () => {
    const config = baseConfig();
    const cMap = { [REENTRY_IV]: candles(crossingCloses(69)) };
    const r = evaluateReentryRsiSignal(config, cMap);
    expect(r.allowed).toBe(true);
    expect(r.rsi).toBeGreaterThanOrEqual(69);
    expect(r.threshold).toBe(69);
    expect(r.price).toBeGreaterThan(0);
  });

  test('threshold customizado é respeitado (cruzamento em 90, não em 69)', () => {
    const config = baseConfig({ rsiThreshold: 90 });
    const cMap = { [REENTRY_IV]: candles(crossingCloses(90)) };
    const r = evaluateReentryRsiSignal(config, cMap);
    expect(r.threshold).toBe(90);
    expect(r.allowed).toBe(true);
    expect(r.rsi).toBeGreaterThanOrEqual(90);
  });

  test('sem reentryRsi.interval salvo (config crua, não normalizada), cai no entry.interval', () => {
    const config = { entry: { interval: '1h' }, exit: { reinforceOnStop: { reentryRsi: { rsiThreshold: 69 } } } };
    const cMap = { '1h': candles(crossingCloses(69)) };
    const r = evaluateReentryRsiSignal(config, cMap);
    expect(r.allowed).toBe(true);
  });

  test('filtro RSI de confirmação (confirmInterval) bloqueia mesmo com o RSI de reentrada cruzando', () => {
    const config = baseConfig({ rsi5mFilter: { enabled: true, threshold: 95 } });
    const cMap = {
      [REENTRY_IV]: candles(crossingCloses(69)),
      '5m': candles(zigzag(40)), // RSI de confirmação ~50, não passa de 95
    };
    const r = evaluateReentryRsiSignal(config, cMap);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('CONFIRM_RSI_TOO_LOW');
  });

  test('filtro RSI de confirmação libera quando o RSI de confirmação também está alto', () => {
    const config = baseConfig({ rsi5mFilter: { enabled: true, threshold: 40 } });
    const cMap = {
      [REENTRY_IV]: candles(crossingCloses(69)),
      '5m': candles(crossingCloses(69)),
    };
    const r = evaluateReentryRsiSignal(config, cMap);
    expect(r.allowed).toBe(true);
  });
});

describe('getRequiredSpecs — busca de intervalos pro gatilho de reentrada por RSI', () => {
  // Desliga os outros filtros que já buscam 5m por padrão (bandWidth/rsi5mFilter/earlyConfirm da
  // ENTRADA) pra isolar só o que o gatilho de reentrada exige.
  function specsFor(reinforceOnStop) {
    const config = normalizeRsiMomentumConfig({
      entry: {
        interval: '1h',
        bandWidth: { enabled: false },
        rsi5mFilter: { enabled: false },
        earlyConfirm: { enabled: false },
      },
      exit: { reinforceOnStop },
    });
    return getRequiredSpecs(config).map((s) => s.interval);
  }

  test('reentryTrigger "immediate" explícito não busca intervalos de reentrada', () => {
    const specs = specsFor({ enabled: true, mode: 'ladder', reentryTrigger: 'immediate', reentryRsi: { interval: REENTRY_IV } });
    expect(specs).not.toContain(REENTRY_IV);
  });

  test('rsiRecross (padrão) sempre busca o intervalo do RSI de reentrada, mesmo com confirmação desligada', () => {
    const specs = specsFor({
      enabled: true, reentryTrigger: 'rsiRecross',
      reentryRsi: { interval: REENTRY_IV, rsiThreshold: 69, confirmInterval: '5m', rsi5mFilter: { enabled: false }, earlyConfirm: { enabled: false } },
    });
    expect(specs).toContain(REENTRY_IV);
    expect(specs).not.toContain('5m'); // confirmação desligada — não busca o confirmInterval
  });

  test('rsiRecross com earlyConfirm ligado busca também o confirmInterval', () => {
    const specs = specsFor({
      enabled: true, reentryTrigger: 'rsiRecross',
      reentryRsi: { interval: REENTRY_IV, rsiThreshold: 69, confirmInterval: '1m', rsi5mFilter: { enabled: false }, earlyConfirm: { enabled: true, rsiThreshold: 75 } },
    });
    expect(specs).toContain(REENTRY_IV);
    expect(specs).toContain('1m');
  });

  test('rsiRecross com rsi5mFilter ligado busca também o confirmInterval', () => {
    const specs = specsFor({
      enabled: true, reentryTrigger: 'rsiRecross',
      reentryRsi: { interval: REENTRY_IV, rsiThreshold: 69, confirmInterval: '30m', rsi5mFilter: { enabled: true, threshold: 75 }, earlyConfirm: { enabled: false } },
    });
    expect(specs).toContain(REENTRY_IV);
    expect(specs).toContain('30m');
  });

  test('reforço desligado não busca intervalo de reentrada mesmo com rsiRecross configurado', () => {
    const specs = specsFor({ enabled: false, reentryTrigger: 'rsiRecross', reentryRsi: { interval: REENTRY_IV } });
    expect(specs).not.toContain(REENTRY_IV);
  });
});

describe('normalizeRsiMomentumConfig — exit.reinforceOnStop.reentryTrigger/reentryRsi', () => {
  test('defaults: rsiRecross, RSI>80 em 5m, confirmInterval 5m, rsi5mFilter/earlyConfirm desligados', () => {
    const c = normalizeRsiMomentumConfig({});
    expect(c.exit.reinforceOnStop.reentryTrigger).toBe('rsiRecross');
    expect(c.exit.reinforceOnStop.reentryRsi).toEqual(RSI_MOMENTUM_DEFAULTS.exit.reinforceOnStop.reentryRsi);
    expect(c.exit.reinforceOnStop.reentryRsi).toEqual({
      interval: '5m',
      rsiThreshold: 80,
      confirmInterval: '5m',
      rsi5mFilter: { enabled: false, threshold: 75 },
      earlyConfirm: { enabled: false, rsiThreshold: 75 },
    });
  });

  test('reentryTrigger inválido cai no default ("rsiRecross")', () => {
    const c = normalizeRsiMomentumConfig({ exit: { reinforceOnStop: { reentryTrigger: 'bogus' } } });
    expect(c.exit.reinforceOnStop.reentryTrigger).toBe('rsiRecross');
  });

  test('reentryTrigger "immediate" explícito é respeitado', () => {
    const c = normalizeRsiMomentumConfig({ exit: { reinforceOnStop: { reentryTrigger: 'immediate' } } });
    expect(c.exit.reinforceOnStop.reentryTrigger).toBe('immediate');
  });

  test('reentryRsi.rsiThreshold é clampado em [50, 95]', () => {
    const low = normalizeRsiMomentumConfig({ exit: { reinforceOnStop: { reentryRsi: { rsiThreshold: 10 } } } });
    const high = normalizeRsiMomentumConfig({ exit: { reinforceOnStop: { reentryRsi: { rsiThreshold: 200 } } } });
    expect(low.exit.reinforceOnStop.reentryRsi.rsiThreshold).toBe(50);
    expect(high.exit.reinforceOnStop.reentryRsi.rsiThreshold).toBe(95);
  });

  test('reentryRsi.interval/confirmInterval inválidos caem no default (5m)', () => {
    const c = normalizeRsiMomentumConfig({ exit: { reinforceOnStop: { reentryRsi: { interval: 'bogus', confirmInterval: 'bogus' } } } });
    expect(c.exit.reinforceOnStop.reentryRsi.interval).toBe('5m');
    expect(c.exit.reinforceOnStop.reentryRsi.confirmInterval).toBe('5m');
  });

  test('reentryRsi.interval/confirmInterval explícitos são respeitados', () => {
    const c = normalizeRsiMomentumConfig({ exit: { reinforceOnStop: { reentryRsi: { interval: REENTRY_IV, confirmInterval: '1m' } } } });
    expect(c.exit.reinforceOnStop.reentryRsi.interval).toBe(REENTRY_IV);
    expect(c.exit.reinforceOnStop.reentryRsi.confirmInterval).toBe('1m');
  });

  test('reentryRsi.rsi5mFilter/earlyConfirm preservam enabled explícito', () => {
    const c = normalizeRsiMomentumConfig({
      exit: {
        reinforceOnStop: {
          reentryTrigger: 'rsiRecross',
          reentryRsi: {
            interval: REENTRY_IV, rsiThreshold: 72, confirmInterval: '1m',
            rsi5mFilter: { enabled: true, threshold: 80 },
            earlyConfirm: { enabled: true, rsiThreshold: 77 },
          },
        },
      },
    });
    expect(c.exit.reinforceOnStop.reentryTrigger).toBe('rsiRecross');
    expect(c.exit.reinforceOnStop.reentryRsi).toEqual({
      interval: REENTRY_IV,
      rsiThreshold: 72,
      confirmInterval: '1m',
      rsi5mFilter: { enabled: true, threshold: 80 },
      earlyConfirm: { enabled: true, rsiThreshold: 77 },
    });
  });
});
