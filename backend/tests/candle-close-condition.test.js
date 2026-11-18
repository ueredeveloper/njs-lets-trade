const { buildCloseCondition, upperWickRejection, bearishClosePattern } = require('../bot/shared/candleCloseCondition');

describe('upperWickRejection', () => {
  test('shooting star (vermelho, pavio superior longo, corpo embaixo)', () => {
    expect(upperWickRejection({ open: 102, high: 110, low: 99.5, close: 100 })).toBe('shooting star');
  });

  test('inverted hammer (verde) — SLPUSDT 4h 31/10 01:00: máx +21,8%, fechou +5% a 30% do range', () => {
    expect(upperWickRejection({ open: 100, high: 121.8, low: 97.8, close: 105 })).toBe('inverted hammer');
  });

  test('gravestone doji (corpo ~0 colado na mínima)', () => {
    expect(upperWickRejection({ open: 100, high: 108, low: 99.9, close: 100.1 })).toBe('gravestone doji');
  });

  test('candle de alta que fechou perto da máxima passa', () => {
    expect(upperWickRejection({ open: 100, high: 112, low: 99, close: 111 })).toBeNull();
  });

  test('pavio superior com corpo grande (topo do corpo no meio do range) passa', () => {
    expect(upperWickRejection({ open: 100, high: 120, low: 99, close: 108 })).toBeNull();
  });

  test('hammer / dragonfly (pavio INFERIOR) não é rejeição de alta', () => {
    expect(upperWickRejection({ open: 108, high: 110, low: 95, close: 109.5 })).toBeNull();
    expect(upperWickRejection({ open: 110, high: 110.1, low: 100, close: 110 })).toBeNull();
  });

  test('candle sem range devolve null', () => {
    expect(upperWickRejection({ open: 1, high: 1, low: 1, close: 1 })).toBeNull();
  });
});

describe('bearishClosePattern', () => {
  // 4 candles subindo (alta antes) — último fecha em 106
  const up = [100, 102, 104, 106].map((c, i) => ({ open: c - 2, high: c + 0.5, low: c - 2.5, close: c, i }));
  const flat = [100, 100, 100, 100].map(() => ({ open: 100, high: 101, low: 99, close: 100.2 }));

  test('padrões de 1 candle com pavio superior seguem barrados', () => {
    expect(bearishClosePattern({ open: 100, high: 121.8, low: 97.8, close: 105 }, up)).toBe('inverted hammer');
  });

  test('hanging man: desenho de hammer DEPOIS de alta', () => {
    const c = { open: 106, high: 106.6, low: 100, close: 106.5 };
    expect(bearishClosePattern(c, up)).toBe('hanging man');
    expect(bearishClosePattern(c, flat)).toBeNull(); // sem alta antes = hammer, não barra
    expect(bearishClosePattern(c, [])).toBeNull();
  });

  test('bearish engulfing: vermelho cobre o corpo do verde anterior', () => {
    const prev = [...up.slice(0, 3), { open: 104, high: 107, low: 103.5, close: 106.5 }];
    expect(bearishClosePattern({ open: 106.5, high: 107.5, low: 102.5, close: 103.5 }, prev)).toBe('bearish engulfing');
    // vermelho que NÃO cobre o corpo inteiro
    expect(bearishClosePattern({ open: 106.5, high: 107.5, low: 104.5, close: 105 }, prev)).toBeNull();
  });

  test('tweezer top: verde e vermelho com a mesma máxima (até 0,2%)', () => {
    const prev = [...up.slice(0, 3), { open: 104, high: 108, low: 103.5, close: 107 }];
    expect(bearishClosePattern({ open: 107, high: 108.1, low: 105, close: 106 }, prev)).toBe('tweezer top');
    expect(bearishClosePattern({ open: 107, high: 109.5, low: 104, close: 105 }, prev)).toBeNull();
  });

  test('candle de alta forte depois de alta passa', () => {
    expect(bearishClosePattern({ open: 106, high: 112.5, low: 105.5, close: 112 }, up)).toBeNull();
  });
});

describe('buildCloseCondition', () => {
  const now = Date.UTC(2026, 9, 31, 14, 20); // 31/10 11:20 BRT

  test('4h aberto agora fecha às 13:00 BRT', () => {
    expect(buildCloseCondition({ exchange: 'binance', interval: '4h' }, now)).toEqual({
      interval: '4h', candleOpenTime: Date.UTC(2026, 9, 31, 12), closeAt: Date.UTC(2026, 9, 31, 16),
    });
  });

  test('1h aberto agora fecha às 12:00 BRT', () => {
    expect(buildCloseCondition({ exchange: 'gate', interval: '1h' }, now).closeAt).toBe(Date.UTC(2026, 9, 31, 15));
  });

  test('recusa intervalo não suportado', () => {
    expect(() => buildCloseCondition({ exchange: 'gate', interval: '2h' })).toThrow(/não suportado/);
    expect(() => buildCloseCondition({ exchange: 'binance', interval: '1w' })).toThrow(/não suportado/);
  });
});

describe('bullishClosePattern (v1.187.0 — autoriza a Explosão sem o corpo mínimo)', () => {
  const { bullishClosePattern } = require('../bot/shared/candleCloseCondition');
  const down = [106, 104, 102, 100].map((c) => ({ open: c + 2, high: c + 2.5, low: c - 0.5, close: c }));
  const up = [100, 102, 104, 106].map((c) => ({ open: c - 2, high: c + 0.5, low: c - 2.5, close: c }));

  test('martelo depois de queda; depois de alta não (é hanging man, barrado antes)', () => {
    const c = { open: 97.6, high: 99, low: 92, close: 98.8 };
    expect(bullishClosePattern(c, down)).toBe('hammer');
    expect(bullishClosePattern(c, up)).not.toBe('hammer');
    expect(bearishClosePattern(c, up)).toBe('hanging man');
  });

  test('engolfo de alta e linha de perfuração', () => {
    const p = { open: 99.5, high: 100, low: 97, close: 97.5 };
    expect(bullishClosePattern({ open: 97.2, high: 101.8, low: 96.8, close: 101.5 }, [p])).toBe('bullish engulfing');
    const p2 = { open: 100, high: 100.4, low: 96, close: 96.5 };
    expect(bullishClosePattern({ open: 96.3, high: 99.4, low: 95.6, close: 99 }, [p2])).toBe('piercing line');
  });

  test('estrela da manhã', () => {
    const prev = [{ open: 102, high: 102.5, low: 96.5, close: 97 }, { open: 97, high: 97.8, low: 95.5, close: 96.6 }];
    expect(bullishClosePattern({ open: 96.8, high: 101.3, low: 96.4, close: 101 }, prev)).toBe('morning star');
  });

  test('fundo pinça', () => {
    const p = { open: 99.5, high: 100, low: 96, close: 97 };
    expect(bullishClosePattern({ open: 97.2, high: 100.2, low: 96.05, close: 98 }, [p])).toBe('tweezer bottom');
  });

  test('marubozu de alta com corpo de 3% (abaixo dos 5%)', () => {
    expect(bullishClosePattern({ open: 100, high: 103.1, low: 99.95, close: 103 }, [])).toBe('bullish marubozu');
  });

  test('três soldados', () => {
    const prev = [{ open: 98.4, high: 100.6, low: 98.1, close: 100.4 }, { open: 99.8, high: 102.6, low: 99.5, close: 102.4 }];
    expect(bullishClosePattern({ open: 101.8, high: 104.8, low: 101.5, close: 104.6 }, prev)).toBe('three white soldiers');
  });

  test('verde comum com pavios dos dois lados não é padrão', () => {
    expect(bullishClosePattern({ open: 100, high: 104, low: 98, close: 102 }, [])).toBeNull();
  });
});
