'use strict';

const readCandles = require('../utils/read-candles');
const candleUpdateQueue = require('../utils/candleUpdateQueue');

jest.mock('../utils/read-candles');
jest.mock('../utils/candleUpdateQueue', () => ({
  enqueue: jest.fn(() => true),
  fetch: jest.fn(),
}));

jest.mock('../bot/ma-cross/strategyEngine', () => ({
  intervalMs: (iv) => ({ '5m': 300_000, '15m': 900_000 }[iv] ?? 3_600_000),
}));

const getCandlesForScreening = require('../utils/getCandlesForScreening');

describe('getCandlesForScreening', () => {
  beforeEach(() => {
    readCandles.mockReset();
    candleUpdateQueue.enqueue.mockReset();
    candleUpdateQueue.fetch.mockReset();
  });

  test('usa disco quando há candles suficientes e recentes', async () => {
    const now = Date.now();
    const candles = Array.from({ length: 210 }, (_, i) => ({
      openTime: now - (210 - i) * 300_000,
      open: 1, high: 1, low: 1, close: 1,
    }));
    readCandles.mockResolvedValue(candles);

    const { candles: out, source } = await getCandlesForScreening('BTCUSDT', '5m', 200);
    expect(source).toBe('disk');
    expect(out).toHaveLength(200);
    expect(candleUpdateQueue.enqueue).not.toHaveBeenCalled();
    expect(candleUpdateQueue.fetch).not.toHaveBeenCalled();
  });

  test('disco velho: busca API via fila urgente', async () => {
    const candles = Array.from({ length: 210 }, () => ({
      openTime: Date.now() - 3_600_000,
      open: 1, high: 1, low: 1, close: 1,
    }));
    readCandles.mockResolvedValue(candles);
    candleUpdateQueue.fetch.mockResolvedValue(candles.slice(-200));

    const { source } = await getCandlesForScreening('BTCUSDT', '5m', 200);
    expect(source).toBe('api');
    expect(candleUpdateQueue.enqueue).toHaveBeenCalledWith('BTCUSDT', '5m', 200, 1);
    expect(candleUpdateQueue.fetch).toHaveBeenCalled();
  });

  test('disco muito velho: prioridade alta na fila', async () => {
    const candles = Array.from({ length: 210 }, () => ({
      openTime: Date.now() - 8 * 3_600_000,
      open: 1, high: 1, low: 1, close: 1,
    }));
    readCandles.mockResolvedValue(candles);

    await getCandlesForScreening('BTCUSDT', '5m', 200);
    expect(candleUpdateQueue.enqueue).toHaveBeenCalledWith('BTCUSDT', '5m', 200, 3);
  });

  test('arquivo ausente: usa fila urgente', async () => {
    const err = new Error('missing');
    err.code = 'ENOENT';
    readCandles.mockRejectedValue(err);
    candleUpdateQueue.fetch.mockResolvedValue([{ openTime: Date.now(), close: 1 }]);

    const { source } = await getCandlesForScreening('ETHUSDT', '5m', 200);
    expect(source).toBe('api');
    expect(candleUpdateQueue.fetch).toHaveBeenCalledWith('ETHUSDT', '5m', 200, { priority: 5 });
  });
});
