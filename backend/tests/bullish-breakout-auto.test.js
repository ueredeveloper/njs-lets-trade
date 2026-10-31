jest.mock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/shared/supabaseRest', () => ({ sbReq: jest.fn() }));

const { exitLevels, CONFIG } = require('../bot/breakout-auto/bullishBreakoutAuto');

describe('exitLevels — alvo +10%, stop na metade do candle (mín. 5%)', () => {
  test('metade do candle mais longe que 5% → stop na metade', () => {
    // candle 100 → máx 130, mín 98: metade 114; comprou a 125 → piso 5% = 118,75 → stop 114
    const lv = exitLevels(125, { high: 130, low: 98 });
    expect(lv.target).toBeCloseTo(137.5);
    expect(lv.stop).toBeCloseTo(114);
  });

  test('metade do candle a menos de 5% → stop vai pra −5%', () => {
    // candle máx 106, mín 100: metade 103; comprou a 105 → piso 99,75 → stop 99,75
    const lv = exitLevels(105, { high: 106, low: 100 });
    expect(lv.stop).toBeCloseTo(99.75);
    expect(lv.target).toBeCloseTo(115.5);
  });

  test('metade ACIMA do preço comprado (gap pra baixo) → stop −5%', () => {
    const lv = exitLevels(100, { high: 130, low: 110 });
    expect(lv.stop).toBeCloseTo(95);
  });

  test('config padrão: 25 USDT, máx. 3 ordens, 4h', () => {
    expect(CONFIG).toMatchObject({ interval: '4h', usdt: 25, maxActive: 3, exit: { targetPct: 10, minStopPct: 5 } });
  });
});
