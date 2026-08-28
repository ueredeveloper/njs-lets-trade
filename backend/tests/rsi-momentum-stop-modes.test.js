'use strict';

const {
  computeTrailingStopPrice,
  checkHigherRsiFilter,
  computeAtrPct,
  computeBracketPrices,
} = require('../bot/rsi-momentum/strategyEngine');
const { normalizeRsiMomentumConfig } = require('../bot/rsi-momentum/tradeConfigSchema');

/** Constrói uma série de candles fechados sintética (openTime crescente, OHLC = mesmo close). */
function candles(closes, stepMs = 3_600_000) {
  return closes.map((c, i) => ({
    openTime: i * stepMs,
    open: String(c), high: String(c), low: String(c), close: String(c),
    closeTime: (i + 1) * stepMs - 1,
  }));
}

describe('computeTrailingStopPrice — modos de stop do bot RSI Momentum', () => {
  const entry = 100;

  test("'continuous' — rampa linear ancorada na entrada", () => {
    const ts = { enabled: true, mode: 'continuous', startPct: 5, coinStepPct: 3, stopStepPct: 2 };
    expect(computeTrailingStopPrice(entry, 100, ts)).toBeCloseTo(95, 6);   // 0 degraus → -5%
    expect(computeTrailingStopPrice(entry, 103, ts)).toBeCloseTo(97, 6);   // +3% → 1 degrau → -3%
    expect(computeTrailingStopPrice(entry, 106, ts)).toBeCloseTo(99, 6);   // +6% → 2 degraus → -1%
  });

  test("'twoPhase' (Escada Dupla) — fase A até travar lucro, depois fase B", () => {
    const ts = normalizeRsiMomentumConfig({
      exit: { trailingStop: { enabled: true, mode: 'twoPhase', startPct: 4, pivotPct: 1, aCoinStepPct: 3, aStopStepPct: 2.5, bCoinStepPct: 3, bStopStepPct: 1 } },
    }).exit.trailingStop;
    // pivotDist = -1 (lucro travado +1%). Fase A: stopPctA = 4 - stepsA*2.5.
    expect(computeTrailingStopPrice(entry, 100, ts)).toBeCloseTo(96, 6);    // 0 degraus → -4%
    expect(computeTrailingStopPrice(entry, 104, ts)).toBeCloseTo(98.5, 6);  // +4% → stepsA 1 → -1.5%
    // +6%: stepsA 2 → stopPctA = -1 == pivotDist → NÃO é > pivotDist, entra fase B (0 degraus B) → -(-1)% acima = +1%
    expect(computeTrailingStopPrice(entry, 106, ts)).toBeCloseTo(101, 6);
  });

  test('MONOTONICIDADE — nenhum modo devolve stop menor conforme o pico sobe', () => {
    const modes = [
      { enabled: true, mode: 'continuous', startPct: 5, coinStepPct: 3, stopStepPct: 2 },
      normalizeRsiMomentumConfig({ exit: { trailingStop: { enabled: true, mode: 'twoPhase', startPct: 4, pivotPct: 1 } } }).exit.trailingStop,
      normalizeRsiMomentumConfig({ exit: { trailingStop: { enabled: true, mode: 'peakTrail', startPct: 4, pivotGainPct: 5, wNearPct: 4, wFarPct: 9 } } }).exit.trailingStop,
      { ...normalizeRsiMomentumConfig({ exit: { trailingStop: { enabled: true, mode: 'atrTrail', startPct: 4, pivotGainPct: 5, wNearPct: 4, atrMult: 2, atrMaxPct: 12 } } }).exit.trailingStop, atrPct: 3 },
    ];
    for (const ts of modes) {
      let prev = -Infinity;
      for (let gain = 0; gain <= 40; gain += 0.5) {
        const stop = computeTrailingStopPrice(entry, entry * (1 + gain / 100), ts);
        expect(stop).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = Math.max(prev, stop);
      }
    }
  });

  test("'atrTrail' sem atrPct cai na largura fixa (wNearPct) — não quebra", () => {
    const ts = normalizeRsiMomentumConfig({
      exit: { trailingStop: { enabled: true, mode: 'atrTrail', startPct: 4, pivotGainPct: 5, wNearPct: 4 } },
    }).exit.trailingStop;
    const stop = computeTrailingStopPrice(entry, 110, ts); // +10%, sem atrPct
    expect(Number.isFinite(stop)).toBe(true);
    expect(stop).toBeGreaterThanOrEqual(entry * (1 - 4 / 100));
  });
});

describe('checkHigherRsiFilter — confirmação RSI 1h', () => {
  test('desligado → sempre libera', () => {
    const config = normalizeRsiMomentumConfig({ entry: { higherRsiFilter: { enabled: false } } });
    expect(checkHigherRsiFilter(config, {}).allowed).toBe(true);
  });

  test('sem candles de 1h suficientes → libera (fail-open)', () => {
    const config = normalizeRsiMomentumConfig({ entry: { higherRsiFilter: { enabled: true, minRsi: 55 } } });
    expect(checkHigherRsiFilter(config, { '1h': candles([100, 101, 102]) }).allowed).toBe(true);
  });

  test('RSI 1h abaixo do mínimo → bloqueia; acima → libera', () => {
    const config = normalizeRsiMomentumConfig({ entry: { higherRsiFilter: { enabled: true, minRsi: 55 } } });
    // série cravada em baixa → RSI ~ baixo
    const down = candles([...Array(30).keys()].map((i) => 120 - i));
    const low = checkHigherRsiFilter(config, { '1h': down });
    expect(low.allowed).toBe(false);
    expect(low.reason).toBe('HIGHER_RSI_TOO_LOW');
    // série cravada em alta → RSI ~ alto
    const up = candles([...Array(30).keys()].map((i) => 80 + i));
    expect(checkHigherRsiFilter(config, { '1h': up }).allowed).toBe(true);
  });
});

describe('computeBracketPrices — teto de lucro (hardTakeProfit)', () => {
  const base = (over) => normalizeRsiMomentumConfig({
    exit: { targetMode: 'continuous', restingBracket: { targetPct: 5 }, trailingTarget: { coinStepPct: 3, stepPct: 3 },
      trailingStop: { enabled: false }, hardTakeProfit: { enabled: true, pct: 15 }, ...over },
    stopLoss: { enabled: true, maxLossPct: 5 },
  });

  test('alvo abaixo do teto → não clampa', () => {
    const r = computeBracketPrices(base(), 100, 108); // +8% pico → alvo contínuo +11% (< +15%)
    expect(r.targetPrice).toBeCloseTo(111, 5);
    expect(r.targetCapped).toBe(false);
  });

  test('alvo passaria do teto → clampa em +15% e marca targetCapped', () => {
    const r = computeBracketPrices(base(), 100, 114); // +14% pico → alvo contínuo +17% → clamp +15%
    expect(r.targetPrice).toBeCloseTo(115, 5);
    expect(r.targetCapped).toBe(true);
  });

  test("targetMode 'off' + teto → cria alvo no teto", () => {
    const r = computeBracketPrices(base({ targetMode: 'off' }), 100, 100);
    expect(r.targetPrice).toBeCloseTo(115, 5);
    expect(r.targetCapped).toBe(true);
  });

  test('teto desligado → alvo contínuo sem limite', () => {
    const r = computeBracketPrices(base({ hardTakeProfit: { enabled: false } }), 100, 130); // +30% → alvo +32%
    expect(r.targetPrice).toBeGreaterThan(120);
    expect(r.targetCapped).toBe(false);
  });
});

describe('computeAtrPct', () => {
  test('null sem candles suficientes; número > 0 com histórico', () => {
    expect(computeAtrPct(candles([1, 2, 3]))).toBeNull();
    const noisy = [...Array(40).keys()].map((i) => 100 + (i % 2 ? 3 : -3) + i * 0.1);
    const atr = computeAtrPct(candles(noisy).map((c, i) => ({ ...c, high: String(Number(c.close) + 2), low: String(Number(c.close) - 2) })));
    expect(atr).toBeGreaterThan(0);
  });
});
