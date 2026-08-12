const router  = require('express').Router();
const getClient = require('../binance/getClient');
const { decimalsFromStep, syncBinanceClock } = require('../binance/tradeClient');
const { cancelRestingBracketIfAny } = require('../bot/shared/cancelRestingBracket');
const { buildAdapter } = require('../bot/shared/buildAdapter');
const getTickers = require('../binance/cachedTicker24hr');
const supabase = require('../supabase/client');

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

// GET /services/binance-price?symbol=BTCUSDT — último preço negociado (do cache
// compartilhado do /ticker/24hr, até 5min desatualizado), usado pelo slider OCO do botão de
// vender pra avisar quando o alvo/stop arrastado (calculado sobre o preço de compra) está
// fora da faixa que a corretora aceitaria agora (ver PERCENT_PRICE_BY_SIDE em ocoClient.js).
router.get('/binance-price', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  try {
    const tickers = await getTickers();
    const ticker = tickers.find(t => t.symbol === symbol.toUpperCase());
    if (!ticker) return res.status(404).json({ error: `símbolo ${symbol} não encontrado` });
    res.json({ price: parseFloat(ticker.lastPrice) });
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

// GET /services/binance-order-lock?symbol=BTCUSDT&quantity=1.23
// Diz se vender `quantity` desse símbolo vai precisar cancelar uma OCO resting (saldo
// livre insuficiente) — usado pelo formulário de venda do favorito AT pra avisar o
// usuário antes de mexer na bracket de uma posição gerenciada por bot.
router.get('/binance-order-lock', async (req, res) => {
  const { symbol, quantity } = req.query;
  if (!symbol || quantity == null) return res.status(400).json({ error: 'symbol e quantity são obrigatórios' });
  try {
    const client = await getClient();
    const baseAsset = symbol.toUpperCase().replace(/USDT$|BTC$|ETH$|BNB$|BUSD$/, '');
    const account = await client.accountInfo();
    const balance = account.balances?.find(b => b.asset === baseAsset);
    const free = balance ? parseFloat(balance.free) : 0;
    res.json({ free, needsBracketCancel: free < Number(quantity) });
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
  const decimals = decimalsFromStep(stepSize);
  return (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
}

// POST /services/binance-order
// Body: { symbol, side: 'BUY'|'SELL', type: 'MARKET'|'LIMIT', quantity, price? }
router.post('/binance-order', async (req, res) => {
  const { symbol, side, type = 'MARKET', quantity, price, strategyId, allowCancelBracket } = req.body ?? {};

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

      // Só cancela a OCO resting se o saldo livre não cobrir a venda pedida — uma compra
      // separada do mesmo ativo (ex.: outro lote comprado depois, fora de qualquer bot)
      // pode estar totalmente livre, e nesse caso não há motivo pra mexer na bracket de
      // uma posição BOUGHT diferente que está protegendo outro lote.
      const accountBefore = await client.accountInfo();
      const balanceBefore = accountBefore.balances?.find(b => b.asset === baseAsset);
      const freeBefore    = balanceBefore ? parseFloat(balanceBefore.free) : null;

      if (freeBefore == null || freeBefore < safeQuantity) {
        // Venda sem strategyId (favorito AT) não sabe de quem é a posição travada — exige
        // confirmação explícita do usuário antes de cancelar a OCO de um bot. Vendas com
        // strategyId (MC/BB/VWAP) já sabem que é a própria posição e cancelam direto.
        if (!strategyId && !allowCancelBracket) {
          return res.status(409).json({
            error: 'Esta venda precisa cancelar uma ordem OCO/TP-SL resting antes de prosseguir.',
            needsBracketCancel: true,
          });
        }
        try {
          await cancelRestingBracketIfAny({ symbol: symbolUpper, exchange: 'binance', strategyId });
        } catch (err) {
          return res.status(500).json({ error: `Falha ao cancelar OCO resting antes da venda: ${err.message}` });
        }
      }

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

// POST /services/binance-bracket-sell
// Body: { symbol, quantity, entryPrice, targetPct, stopPct, strategyId?, allowCancelBracket? }
// Coloca uma OCO de venda (TP = entryPrice*(1+targetPct/100), SL = entryPrice*(1-stopPct/100))
// em vez de vender a mercado — mesma bracket que o bot coloca sozinho (ver
// backend/bot/shared/buildAdapter.js), só que dísparada manualmente com % escolhidos pelo
// usuário. Reaproveita a mesma checagem de saldo/cancelamento de bracket resting do
// /binance-order acima. Com strategyId, a bracket recém-criada é gravada em
// rsi_multi_bot_state.rules_state.exitBracket pra o bot (se estiver rodando) detectar o fill
// sozinho no próximo tick — se o bot estiver fora do ar, a ordem OCO já fica protegendo a
// posição direto na corretora.
router.post('/binance-bracket-sell', async (req, res) => {
  const {
    symbol, quantity, entryPrice, targetPct, stopPct, strategyId, allowCancelBracket,
  } = req.body ?? {};

  if (!symbol || !quantity || !entryPrice || !targetPct || !stopPct)
    return res.status(400).json({ error: 'symbol, quantity, entryPrice, targetPct e stopPct são obrigatórios' });

  try {
    const client      = await getClient();
    const symbolUpper = symbol.toUpperCase();
    const baseAsset   = symbolUpper.replace(/USDT$|BTC$|ETH$|BNB$|BUSD$/, '');

    let safeQuantity = Number(quantity);

    const accountBefore = await client.accountInfo();
    const balanceBefore = accountBefore.balances?.find(b => b.asset === baseAsset);
    const freeBefore    = balanceBefore ? parseFloat(balanceBefore.free) : null;

    if (freeBefore == null || freeBefore < safeQuantity) {
      if (!strategyId && !allowCancelBracket) {
        return res.status(409).json({
          error: 'Esta venda precisa cancelar uma ordem OCO/TP-SL resting antes de prosseguir.',
          needsBracketCancel: true,
        });
      }
      try {
        await cancelRestingBracketIfAny({ symbol: symbolUpper, exchange: 'binance', strategyId });
      } catch (err) {
        return res.status(500).json({ error: `Falha ao cancelar OCO resting antes da venda: ${err.message}` });
      }
    }

    const account  = await client.accountInfo();
    const balance  = account.balances?.find(b => b.asset === baseAsset);
    const free     = balance ? parseFloat(balance.free) : safeQuantity;
    safeQuantity   = Math.min(safeQuantity, free);
    if (!(safeQuantity > 0)) {
      return res.status(400).json({ error: `quantidade inválida (${safeQuantity})` });
    }

    const targetPrice = Number(entryPrice) * (1 + Number(targetPct) / 100);
    const stopPrice   = Number(entryPrice) * (1 - Number(stopPct) / 100);

    // placeExitBracket assina a requisição com o cliente HMAC "cru" (binance/tradeClient.js),
    // que só corrige o relógio quando syncBinanceClock() é chamado explicitamente — sem isso
    // o offset fica em 0 e a Binance rejeita com "Timestamp ... outside of recvWindow" se o
    // relógio do Windows tiver desviado (mesmo cliente usado pelos bots, que sincronizam no
    // boot + a cada hora; aqui é uma ação avulsa, então sincroniza na hora).
    await syncBinanceClock();
    const adapter = buildAdapter('binance', symbolUpper);
    const bracket = await adapter.placeExitBracket(safeQuantity, targetPrice, stopPrice);

    if (strategyId) {
      const { data: row } = await supabase.from('rsi_multi_bot_state')
        .select('id, rules_state')
        .eq('symbol', symbolUpper).eq('strategy_id', strategyId).eq('phase', 'BOUGHT')
        .maybeSingle();
      if (row) {
        // manual:true — o bot NÃO deve substituir essa bracket por deriva (maybeReplaceBracket
        // em bollinger-bands-bot.js/vwap-bands-bot.js pula brackets manuais), senão o TP/SL
        // escolhido aqui pelo usuário seria trocado de volta pro cálculo automático da
        // estratégia no próximo tick.
        await supabase.from('rsi_multi_bot_state')
          .update({
            rules_state: { ...(row.rules_state ?? {}), exitBracket: { ...bracket, manual: true, placedAt: new Date().toISOString() } },
          })
          .eq('id', row.id);
      }
    }

    res.json(bracket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
