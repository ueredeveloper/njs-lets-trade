const { detectWilliamsFractals } = require('../utils/williamsFractals');

/** Monta candles sintéticos a partir de uma série de highs/lows (open/close no meio). */
function candlesFrom(highs, lows) {
  return highs.map((h, i) => ({
    openTime: 1_000 + i * 60_000,
    open: (h + lows[i]) / 2,
    close: (h + lows[i]) / 2,
    high: h,
    low: lows[i],
  }));
}

describe('detectWilliamsFractals', () => {
  test('marca topo e fundo com janela de 2 candles de cada lado', () => {
    //            0   1   2*  3   4   5   6*  7   8
    const highs = [10, 11, 15, 12, 11, 10,  9,  9,  9];
    const lows =  [ 9,  8,  7,  6,  5,  3,  6,  7,  8];
    // idx 2 é o high mais alto numa janela [0..4] → fractal de alta
    // idx 5 é o low mais baixo numa janela [3..7] → fractal de baixa
    const fractals = detectWilliamsFractals(candlesFrom(highs, lows), { bars: 2 });

    const high = fractals.find(f => f.type === 'high');
    const low = fractals.find(f => f.type === 'low');
    expect(high).toMatchObject({ type: 'high', price: 15 });
    expect(low).toMatchObject({ type: 'low', price: 3 });
    // Ordenado por tempo
    expect(fractals).toEqual([...fractals].sort((a, b) => a.time - b.time));
  });

  test('bars maior = menos fractais (janela mais exigente)', () => {
    const highs = [1, 3, 2, 4, 2, 5, 2, 6, 2, 7, 2];
    const lows = highs.map(h => h - 1);
    const few = detectWilliamsFractals(candlesFrom(highs, lows), { bars: 4 });
    const many = detectWilliamsFractals(candlesFrom(highs, lows), { bars: 1 });
    expect(few.length).toBeLessThanOrEqual(many.length);
  });

  test('série curta demais devolve vazio', () => {
    expect(detectWilliamsFractals(candlesFrom([1, 2], [0, 1]), { bars: 2 })).toEqual([]);
  });
});
