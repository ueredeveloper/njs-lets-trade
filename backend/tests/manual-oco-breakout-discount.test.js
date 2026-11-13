// Explosão automática com entrada 5% abaixo do fechamento (close_condition.entryDiscount).
jest.mock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/whatsappApiClient', () => ({ sendText: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/shared/supabaseRest', () => ({ sbReq: jest.fn() }));
jest.mock('../bot/shared/livePrice', () => ({ fetchLivePrice: jest.fn() }));
jest.mock('../bot/shared/buildAdapter', () => ({ buildAdapter: jest.fn() }));
jest.mock('../binance/fetchKlines', () => jest.fn());
jest.mock('../bot/shared/candleCloseCondition', () => ({
  ...jest.requireActual('../bot/shared/candleCloseCondition'),
  fetchClosedCandle: jest.fn(),
  bearishClosePattern: jest.fn(() => null),
}));
jest.mock('../market/bullishBreakoutScanner', () => ({
  ...jest.requireActual('../market/bullishBreakoutScanner'),
  evaluateBullishBreakout: jest.fn(() => ({ ok: true })),
}));

const { sbReq } = require('../bot/shared/supabaseRest');
const { fetchLivePrice } = require('../bot/shared/livePrice');
const { buildAdapter } = require('../bot/shared/buildAdapter');
const fetchKlines = require('../binance/fetchKlines');
const { fetchClosedCandle } = require('../bot/shared/candleCloseCondition');
const { _test: { processRow } } = require('../bot/manual-oco/manualOcoWatcher');

const H4 = 4 * 3600_000;
const OPEN_T = 1_000 * H4;
const log = () => {};

let adapter;
beforeEach(() => {
  jest.clearAllMocks();
  adapter = {
    marketBuy: jest.fn(async () => ({ filledQty: 1, quoteQty: 25, avgPrice: 95 })),
    placeExitBracket: jest.fn(async (qty, target, stop) => ({ targetPrice: target, stopPrice: stop })),
  };
  buildAdapter.mockReturnValue(adapter);
  sbReq.mockImplementation(async () => [{}]);
});

function autoRow(extra = {}) {
  return {
    id: 1, symbol: 'XUSDT', exchange: 'binance', usdt: 25, status: 'OPEN', entry_kind: 'candle_close',
    entry_price: 100, target_price: 110, stop_price: 90,
    close_condition: {
      interval: '4h', candleOpenTime: OPEN_T, closeAt: OPEN_T + H4, source: 'bullish_breakout_auto',
      confirmBreakout: { lookback: 20 },
      exit: { targetPct: 10, stopMode: 'candleMid', minStopPct: 10 },
      entryDiscount: { discountPct: 5, waitHours: 12 },
    },
    ...extra,
  };
}

test('no fechamento confirmado NÃO compra: arma limit 5% abaixo com prazo de 12h', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(OPEN_T + H4 + 60_000);
  fetchClosedCandle.mockResolvedValue({ open: 80, high: 104, low: 78, close: 100 });
  fetchKlines.mockResolvedValue([{ openTime: OPEN_T }]);
  await processRow(autoRow(), log);
  expect(adapter.marketBuy).not.toHaveBeenCalled();
  const patch = sbReq.mock.calls.find(([m]) => m === 'PATCH')[2];
  expect(patch.entry_kind).toBe('limit');
  expect(patch.entry_price).toBeCloseTo(95);
  expect(patch.target_price).toBeCloseTo(104.5);
  expect(patch.stop_price).toBeCloseTo(85.5); // metade do candle 91 > piso 85,5
  expect(patch.close_condition.limitExpiresAt).toBe(OPEN_T + H4 + 12 * 3600_000);
  expect(patch.close_condition.exitCandle).toEqual({ high: 104, low: 78, close: 100 });
  Date.now.mockRestore();
});

test('preço cai até a limite → compra e OCO usa o candle da explosão sobre o preço comprado', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(OPEN_T + H4 + 3600_000);
  fetchLivePrice.mockResolvedValue(94.9);
  adapter.marketBuy.mockResolvedValue({ filledQty: 1, quoteQty: 25, avgPrice: 94 });
  const row = autoRow({
    entry_kind: 'limit', entry_price: 95, target_price: 104.5, stop_price: 85.5,
    close_condition: { ...autoRow().close_condition, exitCandle: { high: 104, low: 60, close: 100 }, limitExpiresAt: OPEN_T + H4 + 12 * 3600_000 },
  });
  await processRow(row, log);
  expect(adapter.marketBuy).toHaveBeenCalledWith(25);
  const [, target, stop] = adapter.placeExitBracket.mock.calls[0];
  expect(target).toBeCloseTo(103.4); // 94 × 1,10
  expect(stop).toBeCloseTo(82); // metade (104+60)/2 = 82 < piso 84,6
  Date.now.mockRestore();
});

test('prazo vencido sem encher → CLOSED, sem comprar', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(OPEN_T + H4 + 13 * 3600_000);
  const row = autoRow({
    entry_kind: 'limit', entry_price: 95,
    close_condition: { ...autoRow().close_condition, limitExpiresAt: OPEN_T + H4 + 12 * 3600_000 },
  });
  await processRow(row, log);
  expect(fetchLivePrice).not.toHaveBeenCalled();
  expect(adapter.marketBuy).not.toHaveBeenCalled();
  const patch = sbReq.mock.calls.find(([m]) => m === 'PATCH')[2];
  expect(patch.status).toBe('CLOSED');
  expect(patch.error).toMatch(/expirou/);
  Date.now.mockRestore();
});

test('ordem sem entryDiscount (antiga) continua comprando a mercado no fechamento', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(OPEN_T + H4 + 60_000);
  fetchClosedCandle.mockResolvedValue({ open: 80, high: 104, low: 78, close: 100 });
  fetchKlines.mockResolvedValue([{ openTime: OPEN_T }]);
  const row = autoRow();
  delete row.close_condition.entryDiscount;
  await processRow(row, log);
  expect(adapter.marketBuy).toHaveBeenCalledWith(25);
  Date.now.mockRestore();
});
