// "Revisar OCO" (backend/bot/manual-oco/ocoReview.js) — caso AIGENSYN #300 (22/11/2026): dois
// processos do bot fizeram o martingale juntos → OCO duplicada na mãe e a #301 sem OCO.
const { diagnose, groupOpenOcos } = require('../bot/manual-oco/ocoReview');

const oco = (listId, qty, target, stop) => [
  { orderListId: listId, side: 'SELL', type: 'STOP_LOSS_LIMIT', origQty: String(qty), executedQty: '0', price: String(stop * 0.997), stopPrice: String(stop), orderId: listId * 10 + 1 },
  { orderListId: listId, side: 'SELL', type: 'LIMIT_MAKER', origQty: String(qty), executedQty: '0', price: String(target), stopPrice: '0', orderId: listId * 10 + 2 },
];

const parent = { id: 300, status: 'BRACKETED', fill: { filledQty: 1197.6 }, target_price: 0.01666, stop_price: 0.011662,
  bracket: { orderListId: 2, targetPrice: 0.01666, stopPrice: 0.0134 }, close_condition: { dropState: { stage: 'done' } } };
const child1 = { id: 301, status: 'OCO_FAILED', fill: { filledQty: 1341.312 }, target_price: 0.01666, stop_price: 0.012648,
  bracket: null, close_condition: { parentId: 300 } };
const child2 = { id: 302, status: 'BRACKETED', fill: { filledQty: 1340.314 }, target_price: 0.01666, stop_price: 0.0126565,
  bracket: { orderListId: 3, targetPrice: 0.01666, stopPrice: 0.01266 }, close_condition: { parentId: 300 } };

const openAigen = [...oco(1, 1197, 0.01666, 0.0134), ...oco(2, 1197, 0.01666, 0.0134), ...oco(3, 1340, 0.01666, 0.01266)];

test('agrupa as pernas por orderListId', () => {
  expect(groupOpenOcos(openAigen)).toHaveLength(3);
  expect(groupOpenOcos(openAigen)[0]).toMatchObject({ orderListId: 1, qty: 1197, target: 0.01666, stop: 0.0134 });
});

test('AIGENSYN: cancela a duplicada da mãe e põe a OCO da #301 com o saldo liberado', () => {
  const d = diagnose({ family: [parent, child1, child2], openOrders: openAigen, trackedIds: [2, 3], free: 153 });
  expect(d.ok).toBe(false);
  expect(d.actions[0]).toMatchObject({ kind: 'cancel', twinOf: 300, oco: { orderListId: 1 } });
  expect(d.actions[1]).toMatchObject({ kind: 'place', id: 301, target: 0.01666, stop: 0.012648 });
  expect(d.actions[1].qty).toBeCloseTo(1341.312);
  expect(d.actions[1].short).toBe(false);
  expect(d.unknown).toEqual([]);
});

test('OCO aberta não rastreada que casa com a perna sem OCO → adota em vez de colocar outra', () => {
  const open = [...oco(2, 1197, 0.01666, 0.0134), ...oco(9, 1341, 0.01666, 0.012648), ...oco(3, 1340, 0.01666, 0.01266)];
  const d = diagnose({ family: [parent, child1, child2], openOrders: open, trackedIds: [2, 3], free: 10 });
  expect(d.actions).toEqual([expect.objectContaining({ kind: 'adopt', id: 301, oco: expect.objectContaining({ orderListId: 9 }) })]);
});

test('tudo certo → ok; OCO de outra coisa só aparece como desconhecida', () => {
  const open = [...oco(2, 1197, 0.01666, 0.0134), ...oco(3, 1340, 0.01666, 0.01266), ...oco(7, 50, 0.02, 0.01)];
  const d = diagnose({ family: [parent, child2], openOrders: open, trackedIds: [2, 3], free: 0 });
  expect(d.ok).toBe(true);
  expect(d.unknown.map((g) => g.orderListId)).toEqual([7]);
});

test('saldo livre insuficiente → marca short', () => {
  const open = [...oco(2, 1197, 0.01666, 0.0134), ...oco(3, 1340, 0.01666, 0.01266)];
  const d = diagnose({ family: [parent, child1, child2], openOrders: open, trackedIds: [2, 3], free: 153 });
  expect(d.actions[0]).toMatchObject({ kind: 'place', id: 301, qty: 153, short: true });
});

test('martingale em andamento → busy', () => {
  const p = { ...parent, close_condition: { dropState: { stage: 'buying' } } };
  expect(diagnose({ family: [p], openOrders: [], trackedIds: [], free: 0 }).busy).toBe(true);
});
