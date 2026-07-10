'use strict';

jest.mock('../binance/getCandles');

const getCandles = require('../binance/getCandles');
const analyseMaCrossStats = require('../utils/analyseMaCrossStats');

function makeCandles(closes) {
  return closes.map((close, i) => ({
    openTime: i * 900_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

/** Série com cruzamento ↑ seguido de queda e cruzamento ↓ */
function buildRoundTripSeries() {
  const closes = [];
  for (let i = 0; i < 55; i++) closes.push(100 - i * 0.04);
  for (let i = 0; i < 6; i++) closes.push(closes.at(-1) + 0.35);
  closes.push(closes.at(-1) + 2.5);
  for (let i = 0; i < 20; i++) closes.push(closes.at(-1) - 0.25);
  closes.push(closes.at(-1) - 2.5);
  return makeCandles(closes);
}

describe('analyseMaCrossStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retorna ciclos EMA9↑EMA21 entrada e EMA9↓EMA21 saída', async () => {
    const candles = buildRoundTripSeries();
    getCandles.mockResolvedValue(candles);

    const result = await analyseMaCrossStats('BTCUSDT', {
      entryInterval: '15m',
      exitInterval: '15m',
      period1: 9,
      period2: 21,
    });

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.entryInterval).toBe('15m');
    expect(result.totalCandles).toBe(candles.length);
    expect(result.totalOccurrences).toBeGreaterThanOrEqual(1);
    expect(result.occurrences[0]).toMatchObject({
      startDate: expect.any(String),
      endDate: expect.any(String),
      entryPrice: expect.any(Number),
      exitPrice: expect.any(Number),
      appreciationPercent: expect.any(Number),
    });
  });

  test('intervalos de entrada e saída distintos buscam dois candlesets', async () => {
    const entry = buildRoundTripSeries();
    const exit = buildRoundTripSeries();
    getCandles.mockImplementation(async (_sym, iv) => (iv === '15m' ? entry : exit));

    const result = await analyseMaCrossStats('ETHUSDT', {
      entryInterval: '15m',
      exitInterval: '1h',
    });

    expect(getCandles).toHaveBeenCalledWith('ETHUSDT', '15m', expect.any(Number));
    expect(getCandles).toHaveBeenCalledWith('ETHUSDT', '1h', expect.any(Number));
    expect(result.exitInterval).toBe('1h');
    expect(result.totalExitCandles).toBe(exit.length);
  });
});
