const router     = require('express').Router();
const getCandles = require('../binance/getCandles');

const ALL_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const FORCE_LIMIT   = 1000;

// GET /services/reload-candles?symbol=BTCUSDT&interval=1h
// GET /services/reload-candles?symbol=BTCUSDT&interval=all
router.get('/reload-candles', async (req, res) => {
  const { symbol, interval = 'all' } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });
  }

  const sym       = symbol.toUpperCase();
  const intervals = interval === 'all' ? ALL_INTERVALS : [interval];
  const results   = [];

  for (const iv of intervals) {
    try {
      const candles = await getCandles(sym, iv, FORCE_LIMIT);
      results.push({ interval: iv, candles: candles.length, status: 'ok' });
    } catch (err) {
      results.push({ interval: iv, candles: 0, status: 'error', message: err.message });
    }
  }

  res.json({ symbol: sym, results });
});

module.exports = router;
