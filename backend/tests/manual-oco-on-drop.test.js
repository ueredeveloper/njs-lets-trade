// Explosão automática — regra de queda (close_condition.exit.onDrop, v1.193.0): caiu X% depois da
// compra → alvo da OCO vai pra entrada; no martingale compra de novo e grava a ordem filha.
jest.mock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/whatsappApiClient', () => ({ sendText: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/shared/supabaseRest', () => ({ sbReq: jest.fn() }));
jest.mock('../bot/shared/livePrice', () => ({ fetchLivePrice: jest.fn() }));
jest.mock('../bot/shared/buildAdapter', () => ({ buildAdapter: jest.fn() }));
jest.mock('../binance/fetchKlines', () => jest.fn());

const { sbReq } = require('../bot/shared/supabaseRest');
const { fetchLivePrice } = require('../bot/shared/livePrice');
const { buildAdapter } = require('../bot/shared/buildAdapter');
const { MARTINGALE_SOURCE, _test: { processRow } } = require('../bot/manual-oco/manualOcoWatcher');
const { normalizePriceActionConfig } = require('../bot/breakout-auto/priceActionConfig');
const { buildConfig } = require('../bot/breakout-auto/bullishBreakoutAuto');

const log = () => {};
let adapter;

beforeEach(() => {
  jest.clearAllMocks();
  adapter = {
    pollExitBracket: jest.fn(async () => ({ filled: null })),
    cancelExitBracket: jest.fn(async () => {}),
    placeExitBracket: jest.fn(async (qty, target, stop) => ({ orderListId: 2, targetPrice: target, stopPrice: stop })),
    marketBuy: jest.fn(async () => ({ filledQty: 0.25, quoteQty: 20, avgPrice: 80 })),
  };
  buildAdapter.mockReturnValue(adapter);
  sbReq.mockImplementation(async (method, table, body) => (method === 'POST' ? [{ id: 99, ...body }] : [{}]));
});

function bracketedRow(mode, dropState) {
  return {
    id: 7, symbol: 'XUSDT', exchange: 'binance', usdt: 20, status: 'BRACKETED', entry_kind: 'candle_close',
    entry_price: 100, target_price: 115, stop_price: 70,
    fill: { filledQty: 0.2, quoteQty: 20, avgPrice: 100 },
    bracket: { orderListId: 1, targetPrice: 115, stopPrice: 70 },
    close_condition: {
      interval: '4h', candleOpenTime: 0, source: 'bullish_breakout_auto',
      exit: { targetPct: 15, stopMode: 'candleMid', minStopPct: 30, onDrop: { mode, dropPct: 15, martingaleUsdt: 20, martingaleStopPct: 15 } },
      ...(dropState && { dropState }),
    },
  };
}

test('sem queda de 15%: não mexe na OCO', async () => {
  fetchLivePrice.mockResolvedValue(86);
  await processRow(bracketedRow('martingale'), log);
  expect(adapter.cancelExitBracket).not.toHaveBeenCalled();
  expect(adapter.marketBuy).not.toHaveBeenCalled();
});

test("'breakeven': caiu 15% → OCO recolocada com alvo na entrada e o MESMO stop, sem comprar", async () => {
  fetchLivePrice.mockResolvedValue(85);
  await processRow(bracketedRow('breakeven'), log);
  expect(adapter.cancelExitBracket).toHaveBeenCalledWith({ orderListId: 1, targetPrice: 115, stopPrice: 70 });
  expect(adapter.placeExitBracket).toHaveBeenCalledWith(0.2, 100, 70);
  expect(adapter.marketBuy).not.toHaveBeenCalled();
  const last = sbReq.mock.calls.filter(([m]) => m === 'PATCH').pop()[2];
  expect(last.bracket.targetPrice).toBe(100);
  expect(last.close_condition.dropState.stage).toBe('done');
});

test("'martingale': alvo → entrada + compra 20 USDT + ordem filha com alvo na 1ª entrada e stop −15% dela", async () => {
  fetchLivePrice.mockResolvedValue(85);
  await processRow(bracketedRow('martingale'), log);
  expect(adapter.placeExitBracket).toHaveBeenNthCalledWith(1, 0.2, 100, 70);
  expect(adapter.marketBuy).toHaveBeenCalledWith(20);
  const post = sbReq.mock.calls.find(([m]) => m === 'POST')[2];
  expect(post).toMatchObject({ status: 'FILLED', entry_kind: 'market', usdt: 20, target_price: 100, entry_price: 80 });
  expect(post.stop_price).toBeCloseTo(68);
  expect(post.close_condition).toMatchObject({ source: MARTINGALE_SOURCE, parentId: 7 });
  // OCO da 2ª compra: alvo = preço da 1ª entrada, stop −15% do preço dela
  expect(adapter.placeExitBracket).toHaveBeenNthCalledWith(2, 0.25, 100, 68);
  // Passos gravados na linha mãe: moving → moved (OCO nova) → buying → done
  const stages = sbReq.mock.calls.filter(([m, , b, q]) => m === 'PATCH' && q.startsWith('?id=eq.7') && b.close_condition)
    .map(([, , b]) => b.close_condition.dropState.stage);
  expect(stages).toEqual(['moving', 'moved', 'buying', 'done']);
});

test("restart em 'buying' NÃO recompra (a compra pode ter saído)", async () => {
  await processRow(bracketedRow('martingale', { stage: 'buying' }), log);
  expect(adapter.marketBuy).not.toHaveBeenCalled();
  const patch = sbReq.mock.calls.find(([m]) => m === 'PATCH')[2];
  expect(patch.close_condition.dropState.stage).toBe('failed');
});

test("restart em 'moving': não faz poll da OCO velha, refaz cancelar + recolocar", async () => {
  await processRow(bracketedRow('breakeven', { stage: 'moving' }), log);
  expect(fetchLivePrice).not.toHaveBeenCalled();
  expect(adapter.cancelExitBracket).toHaveBeenCalledTimes(1);
  expect(adapter.placeExitBracket).toHaveBeenCalledWith(0.2, 100, 70);
});

test('perna da OCO executou durante o cancelamento → fecha normal, sem recolocar', async () => {
  fetchLivePrice.mockResolvedValue(85);
  adapter.pollExitBracket
    .mockResolvedValueOnce({ filled: null })
    .mockResolvedValueOnce({ filled: 'stop', soldQty: 0.2, usdtOut: 14, exitPrice: 70 });
  await processRow(bracketedRow('martingale'), log);
  expect(adapter.placeExitBracket).not.toHaveBeenCalled();
  expect(adapter.marketBuy).not.toHaveBeenCalled();
  expect(sbReq.mock.calls.some(([m, , b]) => m === 'PATCH' && b.status === 'CLOSED_STOP')).toBe(true);
});

test("ordem sem onDrop (antiga / 'off') segue como antes", async () => {
  const row = bracketedRow('off');
  delete row.close_condition.exit.onDrop;
  await processRow(row, log);
  expect(fetchLivePrice).not.toHaveBeenCalled();
  expect(adapter.cancelExitBracket).not.toHaveBeenCalled();
});

test("config: padrão 'off' não grava onDrop; martingale vai em exit.onDrop", () => {
  expect(normalizePriceActionConfig({}).onDrop.mode).toBe('off');
  expect(buildConfig(normalizePriceActionConfig({})).exit.onDrop).toBeUndefined();
  const pa = normalizePriceActionConfig({ onDrop: { mode: 'martingale', martingaleUsdt: 40, martingaleStopPct: 5 } });
  expect(buildConfig(pa).exit.onDrop).toEqual({ mode: 'martingale', dropPct: 15, martingaleUsdt: 40, martingaleStopPct: 10 });
});

// "Martingale agora" do gráfico (POST /manual-oco-orders/:id/drop-now grava close_condition.forceDrop).
test('forceDrop: caiu só 10% → adianta o martingale (alvo → entrada + 2ª compra), marca forced', async () => {
  fetchLivePrice.mockResolvedValue(90);
  const row = bracketedRow('martingale');
  row.close_condition.forceDrop = { at: 'x', price: 90, pct: -10 };
  await processRow(row, log);
  expect(adapter.placeExitBracket).toHaveBeenNthCalledWith(1, 0.2, 100, 70);
  expect(adapter.marketBuy).toHaveBeenCalledWith(20);
  const first = sbReq.mock.calls.find(([m, , b]) => m === 'PATCH' && b.close_condition?.dropState)[2];
  expect(first.close_condition.dropState).toMatchObject({ stage: 'moving', forced: true });
});

test('forceDrop com o preço de volta acima da compra → ignora e limpa o pedido, sem mexer na OCO', async () => {
  fetchLivePrice.mockResolvedValue(101);
  const row = bracketedRow('martingale');
  row.close_condition.forceDrop = { at: 'x', price: 90, pct: -10 };
  await processRow(row, log);
  expect(adapter.cancelExitBracket).not.toHaveBeenCalled();
  expect(adapter.marketBuy).not.toHaveBeenCalled();
  const patch = sbReq.mock.calls.find(([m, , b]) => m === 'PATCH' && b.close_condition)[2];
  expect(patch.close_condition.forceDrop).toBeUndefined();
  expect(patch.close_condition.dropState).toBeUndefined();
});
