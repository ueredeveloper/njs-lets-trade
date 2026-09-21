const { summarizeSellOrders, buildRescueReport } = require('../bot/shared/rescuePosition');

// Formato real de GET /api/v3/openOrders da Binance para uma OCO (BOMEUSDT, 21/09/2026)
const ocoLegs = [
  { orderId: 2950663310, orderListId: 24835138305, side: 'SELL', type: 'LIMIT_MAKER', price: '0.0012239', stopPrice: '0.00000000', origQty: '39179.00', executedQty: '0.00' },
  { orderId: 2950663309, orderListId: 24835138305, side: 'SELL', type: 'STOP_LOSS_LIMIT', price: '0.0009640', stopPrice: '0.0009689', origQty: '39179.00', executedQty: '0.00' },
];

describe('summarizeSellOrders', () => {
  test('OCO completa: pernas alvo/stop, quantidade travada contada UMA vez', () => {
    const r = summarizeSellOrders(ocoLegs);
    expect(r.oco).toEqual({
      exchange: 'binance', orderListId: 24835138305,
      legs: { target: 2950663310, stop: 2950663309 },
      targetPrice: 0.0012239, stopPrice: 0.0009689, qty: 39179,
    });
    expect(r.lockedQty).toBe(39179);
    expect(r.otherOrders).toEqual([]);
  });

  test('ordem de compra aberta é ignorada; ordem de venda solta entra em otherOrders', () => {
    const r = summarizeSellOrders([
      { orderId: 1, orderListId: -1, side: 'BUY', type: 'LIMIT', price: '1', origQty: '10', executedQty: '0' },
      { orderId: 2, orderListId: -1, side: 'SELL', type: 'LIMIT', price: '2', origQty: '10', executedQty: '4' },
    ]);
    expect(r.oco).toBeNull();
    expect(r.lockedQty).toBe(6);
    expect(r.otherOrders).toHaveLength(1);
    expect(r.otherOrders[0]).toMatchObject({ kind: 'ordem-solta', orderId: 2, qty: 6 });
  });

  test('sem ordens / entrada inválida → vazio', () => {
    expect(summarizeSellOrders([])).toEqual({ oco: null, otherOrders: [], lockedQty: 0 });
    expect(summarizeSellOrders(null)).toEqual({ oco: null, otherOrders: [], lockedQty: 0 });
  });
});

describe('buildRescueReport', () => {
  const now = Date.UTC(2026, 8, 21, 12, 0, 0);
  const buyTime = Date.UTC(2026, 8, 21, 9, 4, 1);

  test('posição inteira travada na OCO (saldo livre 0): total = travado, preço médio pelo FIFO', () => {
    const r = buildRescueReport({
      freeQty: 0, orders: ocoLegs, lastPrice: 0.00102, now,
      trades: [{ time: buyTime, side: 'buy', qty: 39179.78, price: 0.0010199 }],
    });
    expect(r.hasPosition).toBe(true);
    expect(r.totalQty).toBe(39179);
    expect(r.avgPrice).toBeCloseTo(0.0010199, 10);
    expect(r.buyTime).toBe(new Date(buyTime).toISOString());
    expect(r.confident).toBe(true);
    expect(r.oco.orderListId).toBe(24835138305);
  });

  test('trades não batem com o saldo → devolve estimativa mas confident=false', () => {
    const r = buildRescueReport({
      freeQty: 1000, orders: [], lastPrice: 1, now,
      trades: [{ time: buyTime, side: 'buy', qty: 100, price: 1 }],
    });
    expect(r.hasPosition).toBe(true);
    expect(r.confident).toBe(false);
    expect(r.avgPrice).toBe(1);
  });

  test('sem trades → preço/hora nulos (usuário preenche à mão)', () => {
    const r = buildRescueReport({ freeQty: 50, orders: [], trades: [], lastPrice: 1, now });
    expect(r.hasPosition).toBe(true);
    expect(r.avgPrice).toBeNull();
    expect(r.buyTime).toBeNull();
    expect(r.confident).toBe(false);
  });

  test('poeira (< 3 USDT) não é posição', () => {
    const r = buildRescueReport({ freeQty: 2, orders: [], trades: [], lastPrice: 1, now });
    expect(r.hasPosition).toBe(false);
  });

  test('trades além da janela de 7 dias são ignorados', () => {
    const r = buildRescueReport({
      freeQty: 100, orders: [], lastPrice: 1, now,
      trades: [{ time: now - 8 * 24 * 3600 * 1000, side: 'buy', qty: 100, price: 1 }],
    });
    expect(r.avgPrice).toBeNull();
  });
});
