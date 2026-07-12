const router = require('express').Router();
const { gateRequest } = require('../gate/getGateClient');
const { toGateSymbol } = require('../utils/toGateSymbol');
const { getGatePairMeta, floorGateAmount } = require('../bot/gate/gateMarketSell');

// GET /services/gate-trades?symbol=FARTCOINUSDT&limit=500
router.get('/gate-trades', async (req, res) => {
  const { symbol, limit = 500 } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  try {
    const currencyPair = toGateSymbol(symbol.toUpperCase());
    const trades = await gateRequest('GET', '/spot/my_trades', {
      currency_pair: currencyPair,
      limit:         String(Math.min(Number(limit), 1000)),
    });
    // Normaliza para o mesmo formato dos trades Binance: { time, price, qty, isBuyer }
    // create_time_ms (ms) é preferido; create_time é em segundos
    const normalized = trades.map(t => ({
      id:       t.id,
      time:     t.create_time_ms
                  ? Number(t.create_time_ms)
                  : Math.round(parseFloat(t.create_time) * 1000),
      price:    t.price,
      qty:      t.amount,
      side:     t.side,    // 'buy' | 'sell'
      isBuyer:  t.side === 'buy',
      fee:      t.fee,
      feeCoin:  t.fee_currency,
    }));
    res.json(normalized);
  } catch (err) {
    console.warn('[gate-trades]', symbol, err.message);
    // Qualquer erro da Gate.io (4xx, clock drift, par inválido) → retorna vazio em vez de 500
    if (err.message.startsWith('Gate.io')) return res.json([]);
    res.status(500).json({ error: err.message });
  }
});

// GET /services/gate-account
router.get('/gate-account', async (req, res) => {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts');
    // Filtra apenas saldos não-zero (igual ao binance-account)
    const nonZero = accounts.filter(
      a => parseFloat(a.available) > 0 || parseFloat(a.locked) > 0,
    );
    res.json(nonZero);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /services/gate-order
// Body: { symbol, side: 'buy'|'sell', type?: 'market'|'limit', amount, price? }
router.post('/gate-order', async (req, res) => {
  const { symbol, side, type = 'market', amount, price } = req.body ?? {};

  if (!symbol || !side || !amount)
    return res.status(400).json({ error: 'symbol, side e amount são obrigatórios' });
  if (!['buy', 'sell'].includes(side.toLowerCase()))
    return res.status(400).json({ error: 'side deve ser buy ou sell' });
  if (!['market', 'limit'].includes(type.toLowerCase()))
    return res.status(400).json({ error: 'type deve ser market ou limit' });
  if (type === 'limit' && !price)
    return res.status(400).json({ error: 'price obrigatório para ordem limit' });

  try {
    const currencyPair = toGateSymbol(symbol.toUpperCase());

    let safeAmount = Number(amount);
    if (side.toLowerCase() === 'sell') {
      const baseAsset = currencyPair.split('_')[0];
      const accounts  = await gateRequest('GET', '/spot/accounts', { currency: baseAsset });
      const free      = accounts?.[0] ? parseFloat(accounts[0].available) : safeAmount;
      safeAmount       = Math.min(safeAmount, free);
    }
    const meta      = await getGatePairMeta(currencyPair);
    const amountStr = floorGateAmount(safeAmount, meta.amountPrecision);
    if (!amountStr) {
      return res.status(400).json({ error: `quantidade inválida após arredondamento (${safeAmount})` });
    }

    const params = {
      currency_pair: currencyPair,
      side:          side.toLowerCase(),
      type:          type.toLowerCase(),
      amount:        amountStr,
    };
    if (type.toLowerCase() === 'limit') params.price = String(price);

    const order = await gateRequest('POST', '/spot/orders', params);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
