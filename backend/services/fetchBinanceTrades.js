const router  = require('express').Router();
const getClient = require('../binance/getClient');

// GET /services/binance-trades?symbol=BTCUSDT&limit=500
router.get('/binance-trades', async (req, res) => {
  const { symbol, limit = 500 } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  try {
    const client = await getClient();
    const trades = await client.myTrades({ symbol: symbol.toUpperCase(), limit: Number(limit) });
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/binance-account
router.get('/binance-account', async (req, res) => {
  try {
    const client = await getClient();
    const info = await client.accountInfo();
    // Filtra apenas saldos não-zero
    info.balances = info.balances.filter(
      b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    );
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /services/binance-order
// Body: { symbol, side: 'BUY'|'SELL', type: 'MARKET'|'LIMIT', quantity, price? }
router.post('/binance-order', async (req, res) => {
  const { symbol, side, type = 'MARKET', quantity, price } = req.body ?? {};

  if (!symbol || !side || !quantity)
    return res.status(400).json({ error: 'symbol, side e quantity são obrigatórios' });
  if (!['BUY', 'SELL'].includes(side.toUpperCase()))
    return res.status(400).json({ error: 'side deve ser BUY ou SELL' });
  if (!['MARKET', 'LIMIT'].includes(type.toUpperCase()))
    return res.status(400).json({ error: 'type deve ser MARKET ou LIMIT' });
  if (type.toUpperCase() === 'LIMIT' && !price)
    return res.status(400).json({ error: 'price obrigatório para ordem LIMIT' });

  try {
    const client = await getClient();
    const params = {
      symbol:   symbol.toUpperCase(),
      side:     side.toUpperCase(),
      type:     type.toUpperCase(),
      quantity: String(quantity),
    };
    if (type.toUpperCase() === 'LIMIT') {
      params.price       = String(price);
      params.timeInForce = 'GTC';
    }
    const order = await client.order(params);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
