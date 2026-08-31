const { detectZigZag } = require('../utils/zigzag');

function candlesFrom(highs, lows) {
  return highs.map((h, i) => ({
    openTime: 1_000 + i * 60_000,
    open: (h + lows[i]) / 2,
    close: (h + lows[i]) / 2,
    high: h,
    low: lows[i],
  }));
}

/** Onda triangular: sobe até `peak`, desce até `trough`, repete `cycles` vezes. */
function wave(peak, trough, step, cycles, pad) {
  const highs = [];
  for (let c = 0; c < cycles; c++) {
    for (let v = trough; v <= peak; v += step) highs.push(v);
    for (let v = peak - step; v >= trough; v -= step) highs.push(v);
  }
  const head = new Array(pad).fill(trough);
  const tail = new Array(pad).fill(trough);
  const series = [...head, ...highs, ...tail];
  return candlesFrom(series, series.map(h => h - 0.5));
}

describe('detectZigZag', () => {
  test('pivôs alternam entre topo e fundo', () => {
    const { points } = detectZigZag(wave(20, 10, 1, 3, 6), { depth: 3, deviationPct: 5 });
    expect(points.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].type).not.toBe(points[i - 1].type);
    }
  });

  test('deviationPct alto filtra reversões pequenas', () => {
    const candles = wave(20, 10, 1, 3, 6);
    const solto = detectZigZag(candles, { depth: 3, deviationPct: 1 });
    const rigido = detectZigZag(candles, { depth: 3, deviationPct: 60 });
    expect(rigido.points.length).toBeLessThan(solto.points.length);
  });

  test('devolve a perna tentativa até o candle mais recente', () => {
    const { lastLeg, points } = detectZigZag(wave(20, 10, 1, 3, 6), { depth: 3, deviationPct: 5 });
    if (points.length) {
      expect(lastLeg).not.toBeNull();
      expect(lastLeg.to.time).toBeGreaterThan(lastLeg.from.time);
    }
  });

  test('sem candles devolve estrutura vazia', () => {
    expect(detectZigZag([], {})).toEqual({ points: [], lastLeg: null });
  });
});
