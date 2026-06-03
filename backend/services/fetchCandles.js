const { getCandles }    = require('../binance');
const { getGateCandles } = require('../gate/getGateCandles');

const router = require('express').Router();

router.get('/candles', async (req, res) => {
  const { symbol, interval, limit, source } = req.query;
  try {
    const fn       = source === 'gate' ? getGateCandles : getCandles;
    const response = await fn(symbol, interval, limit);
    res.send(JSON.stringify(response));
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
