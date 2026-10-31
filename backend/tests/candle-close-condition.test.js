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
