jest.mock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/shared/supabaseRest', () => ({ sbReq: jest.fn() }));

const { exitLevels, CONFIG } = require('../bot/breakout-auto/bullishBreakoutAuto');

describe('exitLevels — alvo +10%, stop na metade do candle (mín. 10%)', () => {
  test('metade do candle mais longe que 10% → stop na metade', () => {
    // candle máx 130, mín 90: metade 110; comprou a 125 → piso 10% = 112,5 → stop 110
    const lv = exitLevels(125, { high: 130, low: 90 });
    expect(lv.target).toBeCloseTo(137.5);
    expect(lv.stop).toBeCloseTo(110);
  });

  test('metade do candle a menos de 10% → stop vai pra −10%', () => {
    // candle máx 106, mín 100: metade 103; comprou a 105 → piso 94,5 → stop 94,5
    const lv = exitLevels(105, { high: 106, low: 100 });
    expect(lv.stop).toBeCloseTo(94.5);
    expect(lv.target).toBeCloseTo(115.5);
  });

  test('metade ACIMA do preço comprado (gap pra baixo) → stop −10%', () => {
    const lv = exitLevels(100, { high: 130, low: 110 });
    expect(lv.stop).toBeCloseTo(90);
  });

  test('config padrão: 25 USDT, máx. 3 ordens, 4h, corpo >= 5%, volume 24h >= 1,5M, só 1ª explosão', () => {
    expect(CONFIG).toMatchObject({
      interval: '4h', usdt: 25, maxActive: 3,
      scan: { minBodyPct: 5, minVolume24h: 1_500_000, firstOfMove: true },
      exit: { targetPct: 10, minStopPct: 10 },
    });
  });
});
