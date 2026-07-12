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

// Arredonda para baixo respeitando o stepSize do filtro LOT_SIZE da Binance
// (quantity precisa ser múltiplo exato do stepSize, senão a ordem é rejeitada).
async function roundToLotSize(client, symbol, qty) {
  const info      = await client.exchangeInfo({ symbol });
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 0;
  if (!stepSize) return String(qty);
  const decimals = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 0) : 0;
  return (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
}

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
    const client       = await getClient();
    const symbolUpper  = symbol.toUpperCase();
    const sideUpper    = side.toUpperCase();

    let safeQuantity = Number(quantity);
    if (sideUpper === 'SELL') {
      const baseAsset = symbolUpper.replace(/USDT$|BTC$|ETH$|BNB$|BUSD$/, '');
      const account   = await client.accountInfo();
      const balance    = account.balances?.find(b => b.asset === baseAsset);
      const free       = balance ? parseFloat(balance.free) : safeQuantity;
      safeQuantity      = Math.min(safeQuantity, free);
    }
    const roundedQuantity = await roundToLotSize(client, symbolUpper, safeQuantity);
    if (!Number.isFinite(parseFloat(roundedQuantity)) || parseFloat(roundedQuantity) <= 0) {
      return res.status(400).json({ error: `quantidade inválida após arredondamento (${roundedQuantity})` });
    }

    const params = {
      symbol:   symbolUpper,
      side:     sideUpper,
      type:     type.toUpperCase(),
      quantity: roundedQuantity,
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
