'use strict';

jest.mock('../binance/fetchKlines');
jest.mock('../gate/getGateCandles');

const fetchKlines = require('../binance/fetchKlines');
const { fetchFromGate } = require('../gate/getGateCandles');
const { getCandlesAroundTime } = require('../utils/getCandlesAroundTime');

function fakeCandles(n, startMs, stepMs) {
    return Array.from({ length: n }, (_, i) => ({
        openTime: startMs + i * stepMs, open: '1', high: '1', low: '1', close: '1', volume: '1',
    }));
}

describe('getCandlesAroundTime', () => {
    beforeEach(() => {
        fetchKlines.mockReset();
        fetchFromGate.mockReset();
    });

    test('Binance: pede limit = span + 2×pad e endTime = toMs + pad×intervalMs', async () => {
        const fromMs = 1_700_000_000_000;
        const toMs = fromMs + 60 * 60_000; // 1h depois, candles de 1m -> span = 60
        fetchKlines.mockResolvedValue(fakeCandles(5, fromMs, 60_000));

        await getCandlesAroundTime('BTCUSDT', '1m', null, fromMs, toMs, 100);

        expect(fetchKlines).toHaveBeenCalledTimes(1);
        const [symbol, interval, limit, endTime] = fetchKlines.mock.calls[0];
        expect(symbol).toBe('BTCUSDT');
        expect(interval).toBe('1m');
        expect(limit).toBe(60 + 200); // span(60) + 2×pad(100)
        expect(endTime).toBe(toMs + 100 * 60_000);
    });

    test('Gate: mesma conta, mas endTime vira segundos (toSec)', async () => {
        const fromMs = 1_700_000_000_000;
        const toMs = fromMs + 10 * 60_000;
        fetchFromGate.mockResolvedValue(fakeCandles(3, fromMs, 60_000));

        await getCandlesAroundTime('SKYAIUSDT', '1m', 'gate', fromMs, toMs, 50);

        expect(fetchFromGate).toHaveBeenCalledTimes(1);
        const [symbol, interval, limit, toSec] = fetchFromGate.mock.calls[0];
        expect(symbol).toBe('SKYAIUSDT');
        expect(interval).toBe('1m');
        expect(limit).toBe(10 + 100);
        expect(toSec).toBe(Math.floor((toMs + 50 * 60_000) / 1000));
    });

    test('trade muito longo: corta a FOLGA antes de cortar o período do trade', async () => {
        // span gigantesco (bem acima do teto) -> pad vira 0 e o limit fica travado no teto
        const fromMs = 1_700_000_000_000;
        const toMs = fromMs + 10_000 * 60_000; // 10.000 candles de 1m de span
        fetchKlines.mockResolvedValue([]);

        await getCandlesAroundTime('BTCUSDT', '1m', null, fromMs, toMs, 100);

        const [, , limit] = fetchKlines.mock.calls[0];
        expect(limit).toBeLessThanOrEqual(3000);
    });

    test('devolve só os campos OHLCV (sem lixo extra do provedor)', async () => {
        const fromMs = 1_700_000_000_000;
        const toMs = fromMs + 60_000;
        fetchKlines.mockResolvedValue([
            { openTime: fromMs, open: '1', high: '2', low: '0.5', close: '1.5', volume: '10', closeTime: 999, trades: 5 },
        ]);
        const out = await getCandlesAroundTime('BTCUSDT', '1m', null, fromMs, toMs, 1);
        expect(out).toEqual([{ openTime: fromMs, open: '1', high: '2', low: '0.5', close: '1.5', volume: '10' }]);
    });
});
