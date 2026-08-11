const { reconstructOpenLotFifo } = require('../bot/shared/orphanPosition');

describe('reconstructOpenLotFifo', () => {
  test('posição simples: uma compra, sem venda', () => {
    const lot = reconstructOpenLotFifo([
      { time: 1, side: 'buy', qty: 100, price: 2 },
    ]);
    expect(lot).toEqual({ qty: 100, avgPrice: 2 });
  });

  test('round-trip fechado não deixa resíduo (compra + venda total)', () => {
    const lot = reconstructOpenLotFifo([
      { time: 1, side: 'buy', qty: 100, price: 2 },
      { time: 2, side: 'sell', qty: 100, price: 2.5 },
    ]);
    expect(lot).toBeNull();
  });

  test('round-trip fechado seguido de posição nova (caso real: 龙虾USDT)', () => {
    const lot = reconstructOpenLotFifo([
      { time: 1, side: 'buy', qty: 1396, price: 0.028634 },
      { time: 2, side: 'sell', qty: 1394, price: 0.029049 },
      { time: 3, side: 'buy', qty: 2031, price: 0.019604 },
      { time: 4, side: 'buy', qty: 2034, price: 0.019593 },
    ]);
    // os 2 primeiros trades quase se cancelam (sobra 2 de poeira do round-trip antigo, a
    // um preço bem diferente) — o importante é que a posição nova domine o resultado
    expect(lot.qty).toBeCloseTo(2 + 2031 + 2034, 5);
    expect(lot.avgPrice).toBeGreaterThan(0.019);
    expect(lot.avgPrice).toBeLessThan(0.03);
  });

  test('venda maior que a fila de compras não fica negativa', () => {
    const lot = reconstructOpenLotFifo([
      { time: 1, side: 'buy', qty: 10, price: 1 },
      { time: 2, side: 'sell', qty: 50, price: 1 },
    ]);
    expect(lot).toBeNull();
  });

  test('ordem cronológica é respeitada mesmo com trades fora de ordem no array', () => {
    const lot = reconstructOpenLotFifo([
      { time: 3, side: 'sell', qty: 5, price: 3 },
      { time: 1, side: 'buy', qty: 10, price: 1 },
      { time: 2, side: 'buy', qty: 5, price: 2 },
    ]);
    // consome primeiro a compra mais antiga (10@1): sobra 5@1 + 5@2
    expect(lot.qty).toBeCloseTo(10, 5);
    expect(lot.avgPrice).toBeCloseTo((5 * 1 + 5 * 2) / 10, 5);
  });

  test('sem trades → null', () => {
    expect(reconstructOpenLotFifo([])).toBeNull();
  });
});
