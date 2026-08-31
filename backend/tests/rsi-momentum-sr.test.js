'use strict';

const {
  pickSupport, pickResistance, checkSupportResistanceFilter, classifySrZone,
  computeSupportResistanceZoneStats, computeAdaptiveSupportEntryPct,
} = require('../utils/analyseRsiThresholdBacktest');

// preço do sinal = 100. Suportes abaixo, resistências acima.
const zones = {
  supports: [
    { type: 'support', price: 95, touches: 2 },
    { type: 'support', price: 90, touches: 4 },
    { type: 'support', price: 80, touches: 1 },
  ], // já em ordem desc
  resistances: [
    { type: 'resistance', price: 105, touches: 1 },
    { type: 'resistance', price: 120, touches: 3 },
    { type: 'resistance', price: 150, touches: 1 },
  ], // já em ordem asc
};

describe('pickSupport / pickResistance por posição', () => {
  test('rank 1/2/3 = 1ª/2ª/3ª linha abaixo / acima', () => {
    expect(pickSupport(zones, 100, 1).price).toBe(95);
    expect(pickSupport(zones, 100, 2).price).toBe(90);
    expect(pickSupport(zones, 100, 3).price).toBe(80);
    expect(pickSupport(zones, 100, 4)).toBeNull();

    expect(pickResistance(zones, 100, 1).price).toBe(105);
    expect(pickResistance(zones, 100, 2).price).toBe(120);
    expect(pickResistance(zones, 100, 3).price).toBe(150);
    expect(pickResistance(zones, 100, 4)).toBeNull();
  });
});

describe('checkSupportResistanceFilter (distância % acima do suporte)', () => {
  test('bloqueia quando o preço está mais de maxPct% acima do suporte', () => {
    // suporte1 = 95
    expect(checkSupportResistanceFilter(zones, 96, 1, 1, 5)).toBe(true);    // ~1% acima
    expect(checkSupportResistanceFilter(zones, 100, 1, 1, 5)).toBe(false);  // ~5.3% acima
    expect(checkSupportResistanceFilter(zones, 100, 1, 1, 10)).toBe(true);  // limite mais largo
  });

  test('NÃO depende da resistência de saída (exitRank ignorado)', () => {
    expect(checkSupportResistanceFilter(zones, 100, 1, 1, 5))
      .toBe(checkSupportResistanceFilter(zones, 100, 1, 3, 5));
  });

  test('sem suporte abaixo do preço → fail-open (passa)', () => {
    expect(checkSupportResistanceFilter(zones, 79, 1, 1, 1)).toBe(true); // nada abaixo de 79
  });

  test('sem suporte de referência → fail-open', () => {
    expect(checkSupportResistanceFilter({ supports: [], resistances: [] }, 100, 1, 1, 10)).toBe(true);
    expect(checkSupportResistanceFilter(null, 100, 1, 1, 10)).toBe(true);
  });

  test('rank de suporte diferente muda a linha de referência', () => {
    // rank 1 = 95 (preço 100 = 5.3% acima), rank 2 = 90 (11% acima)
    expect(checkSupportResistanceFilter(zones, 100, 1, 1, 8)).toBe(true);
    expect(checkSupportResistanceFilter(zones, 100, 2, 1, 8)).toBe(false);
  });
});

describe('classifySrZone (distância % acima do suporte)', () => {
  test('faixas ≤3 / ≤6 / ≤10 / ≤20 / >20', () => {
    expect(classifySrZone(zones, 96, 1)).toBe(1);    // ~1% acima de 95
    expect(classifySrZone(zones, 100, 1)).toBe(2);   // ~5.3%
    expect(classifySrZone(zones, 103, 1)).toBe(3);   // ~8.4%
    expect(classifySrZone(zones, 110, 1)).toBe(4);   // ~15.8%
    expect(classifySrZone(zones, 130, 1)).toBe(5);   // ~36.8%
  });

  test('sem suporte de referência → null', () => {
    expect(classifySrZone({ supports: [], resistances: [] }, 100, 1)).toBeNull();
  });
});

describe('computeAdaptiveSupportEntryPct', () => {
  const mk = (highs, lows) => highs.map((h, i) => ({
    openTime: 1000 + i * 60000, open: (h + lows[i]) / 2, close: (h + lows[i]) / 2, high: h, low: lows[i],
  }));

  test('dados insuficientes → default 3%', () => {
    expect(computeAdaptiveSupportEntryPct(mk([1, 2], [0, 1]))).toBe(3);
    expect(computeAdaptiveSupportEntryPct([])).toBe(3);
  });

  test('onda com fundos ~2% acima do suporte anterior → ~2%, clampado em [1,8]', () => {
    // fundos subindo de pouquinho em pouquinho (cada fundo ~2% acima do anterior)
    const lows = [];
    for (let c = 0; c < 8; c++) {
      const base = 100 * (1.02 ** c);
      for (const v of [base + 3, base + 1.5, base, base + 1.5, base + 3]) lows.push(v);
    }
    const highs = lows.map((l) => l + 4);
    const pct = computeAdaptiveSupportEntryPct(mk(highs, lows));
    expect(pct).toBeGreaterThanOrEqual(1);
    expect(pct).toBeLessThanOrEqual(8);
  });
});

describe('computeSupportResistanceZoneStats', () => {
  test('agrupa por srZone (mesma forma do cloudZone)', () => {
    const r = computeSupportResistanceZoneStats([
      { srZone: 1, filled: true, outcome: 'target', pnlPct: 4 },
      { srZone: 1, filled: true, outcome: 'stop', pnlPct: -5 },
      { srZone: 5, filled: false, outcome: 'not_filled', pnlPct: null },
    ]);
    expect(r.total).toBe(3);
    expect(r.zones[0]).toMatchObject({ zone: 1, signals: 2, winRatePct: 50 });
    expect(r.zones[4]).toMatchObject({ zone: 5, signals: 1, notFilled: 1 });
  });

  test('sem faixa resolvida → null', () => {
    expect(computeSupportResistanceZoneStats([{ srZone: null, filled: false }])).toBeNull();
  });
});
