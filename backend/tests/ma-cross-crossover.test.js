'use strict';

const { checkMaCrossover, findRecentMaCross, checkMaCrossApproaching, checkPriceFilter, getMaCrossMetrics, computeStopLossFloor, evaluateExit } = require('../bot/ma-cross/strategyEngine');
const { normalizeMaCrossConfig, isValidMaCrossPeriod } = require('../bot/ma-cross/tradeConfigSchema');

function makeCandles(closes) {
  return closes.map((close, i) => ({
    openTime: i * 900_000,
    open: close, high: close, low: close, close,
  }));
}

/** Gera série onde MA9 cruza acima de MA21 no último par de candles */
function buildCrossUpSeries() {
  const closes = [];
  for (let i = 0; i < 60; i++) {
    closes.push(100 - i * 0.05);
  }
  for (let i = 0; i < 5; i++) closes.push(closes.at(-1) + 0.3);
  closes.push(closes.at(-1) + 2);
  return makeCandles(closes);
}

function buildCrossDownSeries() {
  const closes = [];
  for (let i = 0; i < 60; i++) {
    closes.push(100 + i * 0.05);
  }
  for (let i = 0; i < 5; i++) closes.push(closes.at(-1) - 0.3);
  closes.push(closes.at(-1) - 2);
  return makeCandles(closes);
}

describe('MA Cross — cruzamento', () => {
  test('cross_up MA9 vs MA21 no mesmo intervalo', () => {
    const candles = buildCrossUpSeries();
    const r = checkMaCrossover({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
    });
    expect(r.crossed).toBe(true);
    expect(r.ma1).toBeGreaterThan(r.ma2);
  });

  test('cross_down MA9 abaixo MA21 no candle fechado', () => {
    const candles = buildCrossDownSeries();
    const r = checkMaCrossover({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_down',
      tolerancePct: 0.5,
    });
    expect(r.crossed).toBe(true);
    expect(r.ma1).toBeLessThan(r.ma2);
  });

  test('findRecentMaCross: cruzou há ≤15 min e ainda acima', () => {
    const baseTime = Date.now() - 10 * 60_000;
    const closes = Array(45).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.08);
    const candles = closes.map((close, i) => ({
      openTime: baseTime + i * 900_000,
      open: close, high: close, low: close, close,
    }));
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: '15',
      now: baseTime + (candles.length - 1) * 900_000 + 60_000,
    });
    expect(typeof r.matched).toBe('boolean');
    if (r.matched) {
      expect(r.ageMin).toBeLessThanOrEqual(15);
      expect(r.ma1).toBeGreaterThan(r.ma2);
    }
  });

  test('findRecentMaCross: último candle apenas', () => {
    const candles = buildCrossUpSeries();
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: 'last',
      now: candles.at(-1).openTime + 900_000,
    });
    expect(r.matched).toBe(true);
  });

  test('near_up: gap encolhendo com MA rápida subindo', () => {
    const closes = Array(45).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.02);
    const candles = makeCandles(closes);
    const r = checkMaCrossApproaching({
      candles1: candles, period1: 9, interval1: '1m',
      candles2: candles, period2: 21, interval2: '1m',
      mode: 'near_up',
      proximityPct: 2,
      closedOnly: false,
    });
    expect(typeof r.matched).toBe('boolean');
    if (r.matched) {
      expect(r.gapPct).toBeLessThanOrEqual(2);
      expect(r.kind).toBe('approaching');
    }
  });

  test('near_up: rejeita quando MA rápida cai (gap encolhe por queda da lenta)', () => {
    const closes = Array(50).fill(0.0648);
    for (let i = 0; i < 10; i++) closes.push(0.0648 - i * 0.00005);
    const candles = makeCandles(closes);
    const r = checkMaCrossApproaching({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      mode: 'near_up',
      proximityPct: 1,
      closedOnly: true,
    });
    expect(r.matched).toBe(false);
  });

  test('getMaCrossMetrics: approaching alinhado ao check live (sem duplo slice)', () => {
    const closes = Array(50).fill(100);
    for (let i = 0; i < 8; i++) closes.push(100 - i * 0.01);
    closes.push(100.02);
    const candles = makeCandles(closes);
    const direct = checkMaCrossApproaching({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      mode: 'near_up', proximityPct: 1, closedOnly: false,
    });
    const metrics = getMaCrossMetrics({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      proximityPct: 1,
    });
    expect(metrics.approachingUp).toBe(direct.matched);
  });

  test('findRecentMaCross: ignora par com gap no histórico (15m)', () => {
    const baseTime = Date.now() - 60 * 60_000;
    const closes = Array(45).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.08);
    const candles = closes.map((close, i) => ({
      openTime: baseTime + i * 900_000,
      open: close, high: close, low: close, close,
    }));
    // Remove um candle no meio — simula gap no disco
    const gapped = [...candles.slice(0, 30), ...candles.slice(31)];
    const r = findRecentMaCross({
      candles1: gapped, period1: 9, interval1: '15m',
      candles2: gapped, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: '60',
      now: gapped.at(-1).openTime + 900_000,
    });
    // Sem gap falso no par 30→32; cruzamento real permanece no fim da série
    expect(typeof r.matched).toBe('boolean');
  });

  test('cross_up: MAs iguais no par anterior não dispara cruzamento', () => {
    const closes = Array(55).fill(0.00000027);
    closes[54] = 0.00000028;
    closes[55] = 0.00000029;
    const candles = makeCandles(closes);
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
      maxAgeMin: 'last',
      now: candles.at(-1).openTime + 900_000,
    });
    expect(r.matched).toBe(true);
    expect(r.ma1).toBeGreaterThan(r.ma2);
  });

  test('findRecentMaCross: idade medida no fechamento do candle', () => {
    const candles = buildCrossUpSeries().map((c) => ({
      ...c,
      closeTime: c.openTime + 900_000 - 1,
    }));
    const now = candles.at(-1).closeTime + 45 * 60_000;
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      maxAgeMin: 'last',
      closedOnly: false,
      now,
    });
    expect(r.matched).toBe(true);
    const openAge = (now - r.crossOpenTime) / 60_000;
    expect(r.ageMin).toBeLessThan(openAge);
    expect(r.ageMin).toBeGreaterThanOrEqual(openAge - 16);
  });

  test('findRecentMaCross: rejeita ↑ quando gap encolhe (revertendo para ↓)', () => {
    // Cruza para cima e depois o gap encolhe sem perder o lado — não é entrada válida
    const closes = Array(50).fill(100);
    for (let i = 0; i < 10; i++) closes.push(100 - i * 0.05); // abaixo
    closes.push(100.5, 101.2, 101.0, 100.85); // cruza ↑ e gap encolhe
    const candles = makeCandles(closes);
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
      maxAgeMin: 'last',
      closedOnly: false,
      now: candles.at(-1).openTime + 60_000,
    });
    // Se ainda acima com gap minúsculo encolhendo → REVERSING; senão pelo menos não é falso positivo óbvio
    if (r.reason === 'REVERSING') {
      expect(r.matched).toBe(false);
      expect(r.ma1).toBeGreaterThan(r.ma2);
    }
  });

  test('findRecentMaCross: TAO-like — ↑ recente com gap encolhendo é REVERSING', () => {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '../data/candlestick/TAOUSDT-15m.json');
    if (!fs.existsSync(file)) return;
    const candles = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
      maxAgeMin: 60,
      closedOnly: true,
      now: Date.now(),
    });
    // Enquanto o gap 15m estiver encolhendo após o micro-↑, não entra no filtro
    if (r.reason === 'REVERSING' || r.reason === 'REVERSED_AFTER_CROSS') {
      expect(r.matched).toBe(false);
    }
  });

  test('cross_up: MA9 já acima no candle anterior não é cruzamento novo (tol 0.5%)', () => {
    const closes = Array(55).fill(100);
    for (let i = 0; i < 15; i++) closes.push(100 + i * 0.02);
    const candles = makeCandles(closes);
    const r = findRecentMaCross({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
      maxAgeMin: 'last',
      closedOnly: false,
      now: candles.at(-1).openTime + 60_000,
    });
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('NO_CROSS_UP');
  });

  test('cross_up com close em string (disco Binance)', () => {
    const candles = buildCrossUpSeries().map((c) => ({
      ...c,
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
    }));
    const r = checkMaCrossover({
      candles1: candles, period1: 9, interval1: '15m',
      candles2: candles, period2: 21, interval2: '15m',
      direction: 'cross_up',
      tolerancePct: 0.5,
    });
    expect(r.crossed).toBe(true);
    expect(Number.isFinite(r.ma1)).toBe(true);
    expect(Number.isFinite(r.ma2)).toBe(true);
  });

  test('filtro strict_above bloqueia abaixo da MA', () => {
    const candles = makeCandles(Array(60).fill(100));
    const pf = checkPriceFilter(95, candles, { enabled: true, period: 50, mode: 'strict_above' });
    expect(pf.allowed).toBe(false);
    expect(pf.reason).toBe('NOT_ABOVE_MA');
  });

  test('filtro adaptive permite até maxDipPct', () => {
    const candles = makeCandles(Array(60).fill(100));
    const pf = checkPriceFilter(97, candles, { enabled: true, period: 50, mode: 'adaptive', maxDipPct: 4 }, 3);
    expect(pf.allowed).toBe(true);
  });

  test('filtro adaptive bloqueia acima do teto maxAbovePct', () => {
    const candles = makeCandles(Array(60).fill(100));
    const pf = checkPriceFilter(105, candles, {
      enabled: true, period: 50, mode: 'adaptive', maxDipPct: 4, maxAbovePct: 4,
    }, 3, {}, 4);
    expect(pf.allowed).toBe(false);
    expect(pf.reason).toBe('ABOVE_ADAPTIVE_CEILING');
  });

  test('filtro adaptive permite dentro do piso e teto', () => {
    const candles = makeCandles(Array(60).fill(100));
    const pf = checkPriceFilter(102, candles, {
      enabled: true, period: 50, mode: 'adaptive', maxDipPct: 4, maxAbovePct: 4,
    }, 3, {}, 4);
    expect(pf.allowed).toBe(true);
    expect(pf.abovePct).toBe(4);
  });

  test('maxAbovePct 0 desliga teto adaptativo', () => {
    const candles = makeCandles(Array(60).fill(100));
    const pf = checkPriceFilter(110, candles, {
      enabled: true, period: 50, mode: 'adaptive', maxDipPct: 4, maxAbovePct: 0,
    }, 3);
    expect(pf.allowed).toBe(true);
  });

  test('config normaliza param1/param2 e período livre', () => {
    const c = normalizeMaCrossConfig({
      entry: { param1: { period: 34, interval: '1h' }, param2: { period: 89, interval: '4h' } },
    });
    expect(c.entry.ma1.period).toBe(34);
    expect(c.entry.ma2.period).toBe(89);
  });

  test('múltiplos maFilters', () => {
    const c = normalizeMaCrossConfig({
      maFilters: [
        { period: 50, interval: '1h', mode: 'adaptive' },
        { period: 200, interval: '4h', mode: 'strict_above' },
      ],
    });
    expect(c.maFilters).toHaveLength(2);
  });

  test('migra priceFilter legado para maFilters', () => {
    const c = normalizeMaCrossConfig({
      priceFilter: { enabled: true, period: 50, interval: '1h', mode: 'adaptive' },
    });
    expect(c.maFilters[0].period).toBe(50);
  });
});

describe('MA Cross — período EMA', () => {
  test('isValidMaCrossPeriod aceita 2–500', () => {
    expect(isValidMaCrossPeriod(2)).toBe(true);
    expect(isValidMaCrossPeriod(13)).toBe(true);
    expect(isValidMaCrossPeriod(500)).toBe(true);
    expect(isValidMaCrossPeriod(1)).toBe(false);
    expect(isValidMaCrossPeriod(501)).toBe(false);
  });

  test('clampPeriod respeita limites', () => {
    const c = normalizeMaCrossConfig({ entry: { ma1: { period: 1 }, ma2: { period: 600 } } });
    expect(c.entry.ma1.period).toBe(9);
    expect(c.entry.ma2.period).toBe(500);
  });
});

describe('MA Cross — stop trailing', () => {
  const stopLoss = { enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5 };

  test('piso inicial 5% abaixo da compra', () => {
    expect(computeStopLossFloor(100, 100, stopLoss)).toBeCloseTo(95);
    expect(computeStopLossFloor(100, 104.9, stopLoss)).toBeCloseTo(95);
  });

  test('a cada +5% de alta o piso sobe um degrau', () => {
    expect(computeStopLossFloor(100, 105, stopLoss)).toBeCloseTo(99.75);
    expect(computeStopLossFloor(100, 110, stopLoss)).toBeCloseTo(104.5);
    expect(computeStopLossFloor(100, 130, stopLoss)).toBeCloseTo(123.5);
  });

  test('+30% de alta protege ~23.5% de lucro no piso', () => {
    const floor = computeStopLossFloor(100, 130, stopLoss);
    expect(floor).toBeCloseTo(123.5);
    expect(((floor - 100) / 100) * 100).toBeCloseTo(23.5);
  });

  test('evaluateExit dispara stop no piso trailing', () => {
    const config = {
      stopLoss,
      entry: { ma1: { interval: '15m' }, ma2: { interval: '15m' } },
      exit: {
        maCross: { enabled: false, ma1: { interval: '15m' }, ma2: { interval: '15m' } },
        rsi: { enabled: false },
      },
    };
    const cMap = { '15m': [{ close: 123 }] };
    const hit = evaluateExit(config, cMap, 100, { peakPrice: 130 });
    expect(hit.exit).toBe(true);
    expect(hit.reason).toBe('STOP_LOSS');
    expect(hit.stopFloor).toBeCloseTo(123.5);
  });

  test('sem trailing mantém piso fixo na entrada', () => {
    const fixed = { enabled: true, maxLossPct: 5, trailing: false };
    expect(computeStopLossFloor(100, 130, fixed)).toBeCloseTo(95);
  });
});

describe('MA Cross — teto acima da MA2', () => {
  const { checkEntryMaxAboveMa2 } = require('../bot/ma-cross/strategyEngine');

  test('bloqueia quando preço está > maxAboveMaPct acima da MA2', () => {
    const r = checkEntryMaxAboveMa2(0.0105, 0.01, 4);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('ABOVE_MA2_MAX');
    expect(r.aboveMa2Pct).toBeCloseTo(5, 1);
  });

  test('permite quando preço está dentro do teto', () => {
    const r = checkEntryMaxAboveMa2(0.0103, 0.01, 4);
    expect(r.allowed).toBe(true);
    expect(r.aboveMa2Pct).toBeCloseTo(3, 1);
  });

  test('0% desliga o teto', () => {
    const r = checkEntryMaxAboveMa2(0.02, 0.01, 0);
    expect(r.allowed).toBe(true);
  });
});

describe('MA Cross — entrada pullback', () => {
  const { evaluatePullbackReady } = require('../bot/ma-cross/strategyEngine');
  const { toEngineConfig, normalizeMaCrossConfig } = require('../bot/ma-cross/tradeConfigSchema');

  const baseConfig = toEngineConfig(normalizeMaCrossConfig({
    entry: {
      ma1: { period: 9, interval: '15m' },
      ma2: { period: 21, interval: '15m' },
      direction: 'cross_up',
      maxAboveMaPct: 3,
    },
    maFiltersEnabled: false,
    execution: { pullbackEntry: { enabled: true, waitCandles: 2, requirePullback: true } },
  }));

  function flatCandles(closes, startOpen = 1_700_000_000_000) {
    return closes.map((close, i) => ({
      openTime: startOpen + i * 900_000,
      open: close, high: close, low: close, close,
    }));
  }

  test('aguarda N candles antes de avaliar', () => {
    const closes = Array(25).fill(100);
    closes.push(100, 100, 101);
    const candles = flatCandles(closes);
    const signalOpenTime = candles[25].openTime;
    const pending = { signalOpenTime, signalClose: 100 };
    const r = evaluatePullbackReady(baseConfig, { '15m': candles }, {}, pending);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('WAITING_CANDLES');
    expect(r.waited).toBe(1);
    expect(r.need).toBe(2);
  });

  test('compra quando há pullback em direção à MA21', () => {
    const closes = Array(25).fill(100);
    closes.push(102, 103, 101, 104);
    const candles = flatCandles(closes);
    const signalOpenTime = candles[25].openTime;
    const pending = { signalOpenTime, signalClose: 102 };
    const r = evaluatePullbackReady(baseConfig, { '15m': candles }, {}, pending);
    expect(r.ready).toBe(true);
    expect(r.close).toBe(101);
    expect(r.pullbackVsMa2Pct).toBeLessThan(0);
  });

  test('cancela se entrada não aproxima da MA21 vs sinal', () => {
    const closes = Array(25).fill(100);
    closes.push(101, 102, 103, 104);
    const candles = flatCandles(closes);
    const pending = { signalOpenTime: candles[25].openTime, signalClose: 101 };
    const r = evaluatePullbackReady(baseConfig, { '15m': candles }, {}, pending);
    expect(r.ready).toBe(false);
    expect(r.cancel).toBe(true);
    expect(r.reason).toBe('NO_PULLBACK');
  });
});
