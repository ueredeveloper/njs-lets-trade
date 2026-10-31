const {
  evaluateBullishBreakout, findRecentBreakout, normalizeOptions, buildFilterName, DEFAULTS,
} = require('../market/bullishBreakoutScanner');

const H4 = 4 * 3_600_000;

// 20 candles laterais (100 → 101, máx 102, volume 1000) + o candle avaliado no fim
function series(last, n = 20) {
  const base = Array.from({ length: n }, (_, i) => ({
    openTime: i * H4, open: 100, high: 102, low: 99, close: 101, volume: 1000,
  }));
  return [...base, { openTime: n * H4, ...last }];
}

const NOW_OPEN = 20 * H4 + 1000; // último candle ainda em formação
const NOW_CLOSED = 21 * H4 + 1000; // último candle já fechou

// Perfil tipo SLPUSDT 4h 31/10/2026: corpo forte, volume 12,5×, fechamento a 58% do range (pavio)
const SLP_LIKE = { open: 100, high: 115, low: 95, close: 106.6, volume: 12_500 };

describe('evaluateBullishBreakout', () => {
  test('detecta estouro tipo SLP com os padrões', () => {
    const r = evaluateBullishBreakout(series(SLP_LIKE), DEFAULTS, NOW_OPEN);
    expect(r).not.toBeNull();
    expect(r.bodyPct).toBe(6.6);
    expect(r.volumeRatio).toBe(12.5);
    expect(r.closePos).toBe(0.58);
    expect(r.brokeOut).toBe(true);
    expect(r.priorHigh).toBe(102);
    expect(r.closed).toBe(false);
  });

  test('aceita valores em string (formato bruto do fetchKlines)', () => {
    const raw = series(SLP_LIKE).map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])));
    expect(evaluateBullishBreakout(raw, DEFAULTS, NOW_OPEN)).not.toBeNull();
  });

  test('candle vermelho nunca passa', () => {
    expect(evaluateBullishBreakout(series({ ...SLP_LIKE, open: 106.6, close: 100 }), DEFAULTS, NOW_OPEN)).toBeNull();
  });

  test('corpo pequeno, volume baixo ou fechamento no pavio bloqueiam', () => {
    expect(evaluateBullishBreakout(series({ ...SLP_LIKE, close: 103 }), DEFAULTS, NOW_OPEN)).toBeNull();
    expect(evaluateBullishBreakout(series({ ...SLP_LIKE, volume: 2000 }), DEFAULTS, NOW_OPEN)).toBeNull();
    expect(evaluateBullishBreakout(series({ ...SLP_LIKE, high: 130 }), DEFAULTS, NOW_OPEN)).toBeNull();
  });

  test('sem romper a máxima anterior só passa com requireBreakout=false', () => {
    const below = series({ open: 90, high: 101, low: 89, close: 100, volume: 5000 });
    expect(evaluateBullishBreakout(below, DEFAULTS, NOW_OPEN)).toBeNull();
    const r = evaluateBullishBreakout(below, { ...DEFAULTS, requireBreakout: false }, NOW_OPEN);
    expect(r).not.toBeNull();
    expect(r.brokeOut).toBe(false);
  });

  test('closedOnly descarta o candle em formação e avalia o anterior', () => {
    const cs = series(SLP_LIKE);
    expect(evaluateBullishBreakout(cs, { ...DEFAULTS, closedOnly: true }, NOW_OPEN)).toBeNull();
    const r = evaluateBullishBreakout(cs, { ...DEFAULTS, closedOnly: true }, NOW_CLOSED);
    expect(r).not.toBeNull();
    expect(r.closed).toBe(true);
  });

  test('histórico menor que lookback+1 devolve null', () => {
    expect(evaluateBullishBreakout(series(SLP_LIKE, 5), DEFAULTS, NOW_OPEN)).toBeNull();
  });
});

describe('normalizeOptions / buildFilterName', () => {
  test('converte query string e aplica padrões', () => {
    const o = normalizeOptions({ interval: '1h', minBodyPct: '3', requireBreakout: 'false', closedOnly: '1' });
    expect(o).toMatchObject({ interval: '1h', minBodyPct: 3, minVolumeRatio: 3, requireBreakout: false, closedOnly: true });
  });

  test('rejeita intervalo e parâmetros inválidos', () => {
    expect(() => normalizeOptions({ interval: '7h' })).toThrow(/intervalo inválido/);
    expect(() => normalizeOptions({ minClosePos: '1.5' })).toThrow(/entre 0 e 1/);
    expect(() => normalizeOptions({ minBodyPct: 'abc' })).toThrow(/minBodyPct inválido/);
    expect(() => normalizeOptions({ lookback: '1' })).toThrow(/lookback inválido/);
  });

  test('nome do filtro segue "interval|tipo|params"', () => {
    expect(buildFilterName(normalizeOptions({}))).toBe('4h|Explosão|c5|v3|f40|r');
    expect(buildFilterName(normalizeOptions({ requireBreakout: 'false', closedOnly: 'true', withinCandles: '3' })))
      .toBe('4h|Explosão|c5|v3|f40|n3|fechado');
  });

  test('rejeita withinCandles fora de 1..100', () => {
    expect(() => normalizeOptions({ withinCandles: '0' })).toThrow(/withinCandles inválido/);
  });
});

describe('findRecentBreakout', () => {
  // estouro tipo SLP seguido de 3 candles laterais em cima do novo patamar
  const after = [0, 1, 2].map((i) => ({
    openTime: (21 + i) * H4, open: 106, high: 107, low: 105, close: 105.5, volume: 1500,
  }));
  const cs = [...series(SLP_LIKE), ...after];
  const now = 23 * H4 + 1000; // último candle em formação

  test('acha o candle de explosão de 3 candles atrás', () => {
    const r = findRecentBreakout(cs, { ...DEFAULTS, withinCandles: 6 }, now);
    expect(r).not.toBeNull();
    expect(r.candlesAgo).toBe(3);
    expect(r.openTime).toBe(20 * H4);
    expect(r.risePct).toBe(15);
    expect(r.changeSincePct).toBe(-1.03); // 106.6 → 105.5
  });

  test('fora da janela não aparece', () => {
    expect(findRecentBreakout(cs, { ...DEFAULTS, withinCandles: 3 }, now)).toBeNull();
  });

  test('closedOnly ignora o candle aberto mas mantém a janela', () => {
    const r = findRecentBreakout(cs, { ...DEFAULTS, withinCandles: 6, closedOnly: true }, now);
    expect(r.candlesAgo).toBe(2);
  });
});
