// Rebaixar o stop PRENDIDO pela faixa PERCENT_PRICE_BY_SIDE da Binance (pediu −30%, ficou −20%)
// conforme o preço cai — sem interferir na regra de queda / martingale (manualOcoWatcher#maybeLowerStop).
jest.mock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/whatsappApiClient', () => ({ sendText: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/shared/supabaseRest', () => ({ sbReq: jest.fn() }));
jest.mock('../bot/shared/livePrice', () => ({ fetchLivePrice: jest.fn() }));
jest.mock('../bot/shared/buildAdapter', () => ({ buildAdapter: jest.fn() }));
jest.mock('../binance/fetchKlines', () => jest.fn());
jest.mock('../binance/ocoClient', () => ({ binanceLowestOcoStop: jest.fn() }));

const { sbReq } = require('../bot/shared/supabaseRest');
const { fetchLivePrice } = require('../bot/shared/livePrice');
const { buildAdapter } = require('../bot/shared/buildAdapter');
const { binanceLowestOcoStop } = require('../binance/ocoClient');
const { _test: { processRow } } = require('../bot/manual-oco/manualOcoWatcher');

const log = () => {};
let adapter;
let nextId = 100; // id novo por teste: o limite de 1 tentativa/min é por ordem

beforeEach(() => {
  jest.clearAllMocks();
  adapter = {
    pollExitBracket: jest.fn(async () => ({ filled: null })),
    cancelExitBracket: jest.fn(async () => {}),
    placeExitBracket: jest.fn(async (qty, target, stop) => ({ orderListId: 2, targetPrice: target, stopPrice: stop, clamped: null, requestedStopPrice: stop })),
    marketBuy: jest.fn(async () => ({ filledQty: 0.25, quoteQty: 20, avgPrice: 80 })),
  };
  buildAdapter.mockReturnValue(adapter);
  sbReq.mockImplementation(async (method, table, body) => (method === 'POST' ? [{ id: 999, ...body }] : [{}]));
});

// Comprou a 100, pediu stop 70 (−30%), a Binance prendeu em 80 (−20%). Martingale em −15% (85).
function clampedRow(extraCc = {}, bracketExtra = {}) {
  return {
    id: nextId++, symbol: 'XUSDT', exchange: 'binance', usdt: 20, status: 'BRACKETED', entry_kind: 'candle_close',
    entry_price: 100, target_price: 115, stop_price: 70,
    fill: { filledQty: 0.2, quoteQty: 20, avgPrice: 100 },
    bracket: { orderListId: 1, targetPrice: 115, stopPrice: 80, clamped: { stop: true, target: false }, requestedStopPrice: 70, ...bracketExtra },
    close_condition: {
      interval: '4h', candleOpenTime: 0, source: 'bullish_breakout_auto',
      exit: { targetPct: 15, stopMode: 'candleMid', minStopPct: 30, onDrop: { mode: 'martingale', dropPct: 15, martingaleUsdt: 20, martingaleStopPct: 15 } },
      ...extraCc,
    },
  };
}

const patches = () => sbReq.mock.calls.filter(([m]) => m === 'PATCH');

test('preço caiu e a faixa desceu: troca a OCO com o MESMO alvo e o stop pedido (Binance prende de novo se precisar)', async () => {
  fetchLivePrice.mockResolvedValue(92);
  binanceLowestOcoStop.mockResolvedValue(74);
  await processRow(clampedRow(), log);
  expect(adapter.cancelExitBracket).toHaveBeenCalledTimes(1);
  expect(adapter.placeExitBracket).toHaveBeenCalledWith(0.2, 115, 70);
  // 1º PATCH reivindica (stopLower), o último grava o bracket novo e limpa a marca
  expect(patches()[0][2].close_condition.stopLower).toBeTruthy();
  expect(patches()[0][3]).toContain('close_condition->stopLower=is.null');
  const last = patches().pop()[2];
  expect(last.bracket).toMatchObject({ orderListId: 2, stopPrice: 70, desiredStopPrice: 70 });
  expect(last.close_condition.stopLower).toBeUndefined();
  expect(last.stop_price).toBeUndefined(); // stop pedido original fica intacto
  expect(adapter.marketBuy).not.toHaveBeenCalled(); // regra de queda roda no próximo passe
});

test('faixa desceu menos de 2% do preço comprado: não troca a OCO', async () => {
  fetchLivePrice.mockResolvedValue(99);
  binanceLowestOcoStop.mockResolvedValue(79);
  await processRow(clampedRow(), log);
  expect(adapter.cancelExitBracket).not.toHaveBeenCalled();
});

test('nunca sobe o stop', async () => {
  fetchLivePrice.mockResolvedValue(110);
  binanceLowestOcoStop.mockResolvedValue(88);
  await processRow(clampedRow(), log);
  expect(adapter.cancelExitBracket).not.toHaveBeenCalled();
});

test('stop não foi prendido: nem consulta a faixa', async () => {
  fetchLivePrice.mockResolvedValue(90);
  await processRow(clampedRow({}, { clamped: null, stopPrice: 70 }), log);
  expect(binanceLowestOcoStop).not.toHaveBeenCalled();
  expect(adapter.cancelExitBracket).not.toHaveBeenCalled();
});

test('preço no gatilho do martingale (−15%): martingale roda normal, com o stop de agora, e guarda o stop pedido', async () => {
  fetchLivePrice.mockResolvedValue(85);
  binanceLowestOcoStop.mockResolvedValue(68);
  await processRow(clampedRow(), log);
  expect(binanceLowestOcoStop).not.toHaveBeenCalled();
  // regra do martingale intacta: alvo → entrada, MESMO stop (80), compra 20 USDT
  expect(adapter.placeExitBracket).toHaveBeenNthCalledWith(1, 0.2, 100, 80);
  expect(adapter.marketBuy).toHaveBeenCalledWith(20);
  const moved = patches().find(([, , b]) => b.close_condition?.dropState?.stage === 'moved')[2];
  expect(moved.bracket.desiredStopPrice).toBe(70);
});

test('"Martingale agora" pedido (forceDrop): rebaixamento não age, martingale adiantado roda', async () => {
  fetchLivePrice.mockResolvedValue(95);
  binanceLowestOcoStop.mockResolvedValue(74);
  await processRow(clampedRow({ forceDrop: true }), log);
  expect(binanceLowestOcoStop).not.toHaveBeenCalled();
  expect(adapter.placeExitBracket).toHaveBeenNthCalledWith(1, 0.2, 100, 80);
  expect(adapter.marketBuy).toHaveBeenCalledWith(20);
});

test('outro processo rebaixando agora (marca recente): nem rebaixa nem roda o martingale neste passe', async () => {
  fetchLivePrice.mockResolvedValue(85);
  await processRow(clampedRow({ stopLower: { owner: 'outro', at: new Date().toISOString(), fromListId: 1 } }), log);
  expect(adapter.pollExitBracket).not.toHaveBeenCalled();
  expect(adapter.cancelExitBracket).not.toHaveBeenCalled();
  expect(adapter.marketBuy).not.toHaveBeenCalled();
});

test('marca velha (processo caiu no meio): recoloca a OCO e limpa a marca', async () => {
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  await processRow(clampedRow({ stopLower: { owner: 'morto', at: old, fromListId: 1 } }), log);
  expect(adapter.placeExitBracket).toHaveBeenCalledWith(0.2, 115, 70);
  const last = patches().pop()[2];
  expect(last.bracket.desiredStopPrice).toBe(70);
  expect(last.close_condition.stopLower).toBeUndefined();
});

test('não coube o stop novo: recoloca a OCO anterior (posição nunca fica sem stop)', async () => {
  fetchLivePrice.mockResolvedValue(92);
  binanceLowestOcoStop.mockResolvedValue(74);
  adapter.placeExitBracket
    .mockRejectedValueOnce(new Error('Filter failure: PERCENT_PRICE_BY_SIDE'))
    .mockResolvedValueOnce({ orderListId: 3, targetPrice: 115, stopPrice: 80 });
  await processRow(clampedRow(), log);
  expect(adapter.placeExitBracket).toHaveBeenNthCalledWith(2, 0.2, 115, 80);
  const last = patches().pop()[2];
  expect(last.bracket).toMatchObject({ orderListId: 3, stopPrice: 80, desiredStopPrice: 70 });
  expect(last.status).toBeUndefined();
});
