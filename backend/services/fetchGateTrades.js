const router = require('express').Router();
const { gateRequest } = require('../gate/getGateClient');
const { toGateSymbol } = require('../utils/toGateSymbol');
const { getGatePairMeta, floorGateAmount } = require('../bot/gate/gateMarketSell');
const { cancelRestingBracketIfAny } = require('../bot/shared/cancelRestingBracket');

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

// GET /services/gate-order-lock?symbol=BTCUSDT&quantity=1.23
// Diz se vender `quantity` desse símbolo vai precisar cancelar uma bracket resting (saldo
// livre insuficiente) — usado pelo formulário de venda do favorito AT pra avisar o usuário
// antes de mexer na bracket de uma posição gerenciada por bot.
router.get('/gate-order-lock', async (req, res) => {
  const { symbol, quantity } = req.query;
  if (!symbol || quantity == null) return res.status(400).json({ error: 'symbol e quantity são obrigatórios' });
  try {
    const currencyPair = toGateSymbol(symbol.toUpperCase());
    const baseAsset = currencyPair.split('_')[0];
    const accounts = await gateRequest('GET', '/spot/accounts', { currency: baseAsset });
    const free = accounts?.[0] ? parseFloat(accounts[0].available) : 0;
    res.json({ free, needsBracketCancel: free < Number(quantity) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /services/gate-order
// Body: { symbol, side: 'buy'|'sell', type?: 'market'|'limit', amount, price? }
router.post('/gate-order', async (req, res) => {
  const { symbol, side, type = 'market', amount, price, strategyId, allowCancelBracket } = req.body ?? {};

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

      // Só cancela a bracket resting se o saldo livre não cobrir a venda pedida — uma
      // compra separada do mesmo ativo (ex.: outro lote comprado depois, fora de qualquer
      // bot) pode estar totalmente livre, e nesse caso não há motivo pra mexer na bracket
      // de uma posição BOUGHT diferente que está protegendo outro lote.
      const accountsBefore = await gateRequest('GET', '/spot/accounts', { currency: baseAsset });
      const freeBefore     = accountsBefore?.[0] ? parseFloat(accountsBefore[0].available) : null;

      if (freeBefore == null || freeBefore < safeAmount) {
        // Venda sem strategyId (favorito AT) não sabe de quem é a posição travada — exige
        // confirmação explícita do usuário antes de cancelar a bracket de um bot. Vendas
        // com strategyId (MC/BB/VWAP) já sabem que é a própria posição e cancelam direto.
        if (!strategyId && !allowCancelBracket) {
          return res.status(409).json({
            error: 'Esta venda precisa cancelar uma ordem resting (TP/SL) antes de prosseguir.',
            needsBracketCancel: true,
          });
        }
        try {
          await cancelRestingBracketIfAny({ symbol: symbol.toUpperCase(), exchange: 'gate', strategyId });
        } catch (err) {
          return res.status(500).json({ error: `Falha ao cancelar bracket resting antes da venda: ${err.message}` });
        }
      }

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
    if (type.toLowerCase() === 'limit') {
      params.price = String(price);
    } else {
      // Gate.io rejeita ordem market com time_in_force default (gtc) — precisa ser ioc ou fok
      params.time_in_force = 'ioc';
    }

    const order = await gateRequest('POST', '/spot/orders', params);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
