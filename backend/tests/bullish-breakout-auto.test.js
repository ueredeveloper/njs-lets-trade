jest.mock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/shared/supabaseRest', () => ({ sbReq: jest.fn() }));

const { exitLevels, CONFIG } = require('../bot/breakout-auto/bullishBreakoutAuto');

describe('exitLevels — alvo/stop sobre o preço comprado, stop na metade do candle se mais longe', () => {
  const EXIT10 = { targetPct: 10, stopMode: 'candleMid', minStopPct: 10 };

  test('metade do candle mais longe que 10% → stop na metade', () => {
    // candle máx 130, mín 90: metade 110; comprou a 125 → piso 10% = 112,5 → stop 110
    const lv = exitLevels(125, { high: 130, low: 90 }, EXIT10);
    expect(lv.target).toBeCloseTo(137.5);
    expect(lv.stop).toBeCloseTo(110);
  });

  test('metade do candle a menos de 10% → stop vai pra −10%', () => {
    // candle máx 106, mín 100: metade 103; comprou a 105 → piso 94,5 → stop 94,5
    const lv = exitLevels(105, { high: 106, low: 100 }, EXIT10);
    expect(lv.stop).toBeCloseTo(94.5);
    expect(lv.target).toBeCloseTo(115.5);
  });

  test('metade ACIMA do preço comprado (gap pra baixo) → stop −10%', () => {
    const lv = exitLevels(100, { high: 130, low: 110 }, EXIT10);
    expect(lv.stop).toBeCloseTo(90);
  });

  test('config padrão (v1.186.0): alvo +15% / stop −15% → comprou a 100: alvo 115, stop 85', () => {
    const lv = exitLevels(100, { high: 106, low: 100 });
    expect(lv.target).toBeCloseTo(115);
    expect(lv.stop).toBeCloseTo(85);
  });

  test('config padrão: 25 USDT, máx. 3 ordens, 4h, corpo >= 5%, volume 24h >= 1M, só 1ª explosão, compra no fechamento', () => {
    expect(CONFIG).toMatchObject({
      interval: '4h', usdt: 25, maxActive: 3,
      scan: { minBodyPct: 5, minVolume24h: 1_000_000, firstOfMove: true },
      exit: { targetPct: 15, minStopPct: 15 },
    });
    expect(CONFIG.entry).toBeNull();
  });
});
