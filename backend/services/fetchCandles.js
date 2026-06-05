const { getCandles }    = require('../binance');
const { getGateCandles } = require('../gate/getGateCandles');

const router = require('express').Router();

router.get('/candles', async (req, res) => {
  const { symbol, interval, limit, source } = req.query;
  try {
    const fn       = source === 'gate' ? getGateCandles : getCandles;
    const response = await fn(symbol, interval, limit);
    if (!Array.isArray(response)) {
      return res.status(502).json({ error: 'Candle data unavailable for this symbol' });
    }
    const slim = response.map(({ openTime, open, high, low, close, volume }) =>
      ({ openTime, open, high, low, close, volume }));
    res.send(JSON.stringify(slim));
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
