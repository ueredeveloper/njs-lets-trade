const router  = require('express').Router();
const getClient = require('../binance/getClient');
const { decimalsFromStep, syncBinanceClock } = require('../binance/tradeClient');
const { cancelRestingBracketIfAny } = require('../bot/shared/cancelRestingBracket');
const { buildAdapter } = require('../bot/shared/buildAdapter');
const getTickers = require('../binance/cachedTicker24hr');
const supabase = require('../supabase/client');
const { getSymbolFilters, getAvgPrice } = require('../binance/ocoClient');
const { fetchLivePrice } = require('../bot/shared/livePrice');

// OCO manual do gráfico (ChartOcoTool.jsx / ManualOcoOrdersPanel.jsx). Entrada arrastada: o painel
// só grava o pedido e backend/bot/manual-oco/manualOcoWatcher.js (dentro do rsi-momentum-bot) arma
// a compra, coloca a OCO no fill e detecta alvo/stop. Migração: supabase/add-manual-oco-orders-table.sql.
const MANUAL_OCO_TABLE = 'manual_oco_orders';

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

// GET /services/binance-percent-price-filter?symbol=BTCUSDT — até quantos % abaixo do preço
// médio ponderado ATUAL a Binance aceita numa ordem LIMIT de compra (filtro
// PERCENT_PRICE_BY_SIDE, lado bid — mesmo filtro que binancePlaceOcoSell valida pro lado ask
// em ocoClient.js). Usado pelo campo "Pullback" do formulário Bollinger Bands pra avisar o
// limite da corretora antes de salvar o favorito. Não precisa de API key (exchangeInfo/avgPrice
// são endpoints públicos).
router.get('/binance-percent-price-filter', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  try {
    const symbolUpper = symbol.toUpperCase();
    const [{ bidMultiplierDown }, avgPrice] = await Promise.all([
      getSymbolFilters(symbolUpper),
      getAvgPrice(symbolUpper),
    ]);
    const maxBelowPct = bidMultiplierDown != null
      ? parseFloat(((1 - bidMultiplierDown) * 100).toFixed(2))
      : null;
    res.json({ symbol: symbolUpper, avgPrice, bidMultiplierDown, maxBelowPct });
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

// POST /services/manual-oco-buy
// Body: { symbol, exchange?: 'binance'|'gate', usdt, targetPrice, stopPrice }
// Botão "Comprar agora" da OCO arrastada no gráfico (ChartOcoTool.jsx): compra a mercado `usdt`
// e na sequência coloca a OCO de venda da quantidade comprada nos preços ABSOLUTOS do alvo/stop
// (Binance = OCO real; Gate = par de trigger orders emulado — mesmo placeExitBracket dos bots).
// Recusa antes de comprar se o preço atual já não está entre o stop e o alvo. Se a compra sai e a
// OCO falha, responde 502 com `bought` — a posição fica SEM proteção e o usuário precisa saber.
// Ordem avulsa: não cria favorito nem linha em rsi_multi_bot_state.
router.post('/manual-oco-buy', async (req, res) => {
  const { symbol, exchange = 'binance', usdt, targetPrice, stopPrice } = req.body ?? {};
  const usdtNum = Number(usdt);
  const target = Number(targetPrice);
  const stop = Number(stopPrice);
  if (!symbol || !(usdtNum > 0) || !(target > 0) || !(stop > 0))
    return res.status(400).json({ error: 'symbol, usdt, targetPrice e stopPrice são obrigatórios (> 0)' });
  if (!['binance', 'gate'].includes(exchange))
    return res.status(400).json({ error: 'exchange deve ser binance ou gate' });
  if (!(stop < target))
    return res.status(400).json({ error: 'stop precisa ficar abaixo do alvo' });

  const symbolUpper = symbol.toUpperCase();
  let price;
  try {
    price = await fetchLivePrice(exchange, symbolUpper);
  } catch (err) {
    return res.status(500).json({ error: `Falha ao ler o preço atual: ${err.message}` });
  }
  if (!(price > 0)) return res.status(500).json({ error: `preço atual inválido para ${symbolUpper}` });
  if (!(stop < price && price < target)) {
    return res.status(409).json({
      error: `Preço atual (${price}) fora da OCO (stop ${stop} / alvo ${target}) — reposicione as linhas.`,
      price,
    });
  }

  if (exchange === 'binance') await syncBinanceClock(); // ver comentário no /binance-bracket-sell
  const adapter = buildAdapter(exchange, symbolUpper);

  let bought;
  try {
    bought = await adapter.marketBuy(usdtNum);
  } catch (err) {
    return res.status(500).json({ error: `Compra falhou: ${err.message}` });
  }

  // Grava em manual_oco_orders (entry_kind 'market') pra o gráfico mostrar a OCO ao abrir a moeda
  // e o bot detectar alvo/stop executado. Best-effort: tabela ausente não desfaz a compra.
  const record = (fields) => supabase.from(MANUAL_OCO_TABLE).insert({
    symbol: symbolUpper, exchange, usdt: usdtNum,
    entry_price: bought.avgPrice, target_price: target, stop_price: stop, entry_kind: 'market',
    fill: { filledQty: bought.filledQty, quoteQty: bought.quoteQty, avgPrice: bought.avgPrice, at: new Date().toISOString() },
    ...fields,
  }).then(({ error }) => { if (error) console.warn(`[manual-oco-buy] registro falhou: ${error.message}`); });

  try {
    const bracket = await adapter.placeExitBracket(bought.filledQty, target, stop);
    await record({ status: 'BRACKETED', bracket });
    res.json({ bought, bracket });
  } catch (err) {
    await record({ status: 'OCO_FAILED', error: err.message });
    res.status(502).json({
      error: `Comprou ${bought.filledQty} a ~${bought.avgPrice}, mas a OCO FALHOU: ${err.message} — posição sem stop/alvo, proteja manualmente.`,
      bought,
    });
  }
});


// POST /services/manual-oco-orders
// Body: { symbol, exchange?, usdt, entryPrice, targetPrice, stopPrice }
// entry abaixo do preço atual → 'limit' (bot compra a mercado quando o preço CAI até ela); acima →
// 'trigger' (compra a mercado no rompimento). Nada vai pra corretora antes disso — ver
// manualOcoWatcher.js. Exige stop < entrada < alvo.
router.post('/manual-oco-orders', async (req, res) => {
  const { symbol, exchange = 'binance', usdt, entryPrice, targetPrice, stopPrice } = req.body ?? {};
  const usdtNum = Number(usdt);
  const entry = Number(entryPrice);
  const target = Number(targetPrice);
  const stop = Number(stopPrice);
  if (!symbol || !(usdtNum > 0) || !(entry > 0) || !(target > 0) || !(stop > 0))
    return res.status(400).json({ error: 'symbol, usdt, entryPrice, targetPrice e stopPrice são obrigatórios (> 0)' });
  if (!['binance', 'gate'].includes(exchange))
    return res.status(400).json({ error: 'exchange deve ser binance ou gate' });
  if (!(stop < entry && entry < target))
    return res.status(400).json({ error: 'precisa stop < entrada < alvo' });

  const symbolUpper = symbol.toUpperCase();
  let price;
  try {
    price = await fetchLivePrice(exchange, symbolUpper);
  } catch (err) {
    return res.status(500).json({ error: `Falha ao ler o preço atual: ${err.message}` });
  }
  if (!(price > 0)) return res.status(500).json({ error: `preço atual inválido para ${symbolUpper}` });

  const { data, error } = await supabase.from(MANUAL_OCO_TABLE).insert({
    symbol: symbolUpper, exchange, usdt: usdtNum,
    entry_price: entry, target_price: target, stop_price: stop,
    entry_kind: entry < price ? 'limit' : 'trigger',
  }).select().single();
  if (error) {
    return res.status(500).json({ error: error.message, hint: 'rode supabase/add-manual-oco-orders-table.sql (1×)' });
  }
  res.json({ ...data, livePrice: price });
});

// GET /services/manual-oco-orders?symbol=BTCUSDT — últimas 20 do símbolo (ativas primeiro na UI).
router.get('/manual-oco-orders', async (req, res) => {
  const { symbol, active } = req.query;
  // ?active=1 sem symbol — todas as ordens ainda vivas (esperando entrada ou posição aberta), pra
  // ordenação do favorito B (Compradas / Aguardando) na tabela de moedas.
  if (!symbol && active) {
    const { data, error } = await supabase.from(MANUAL_OCO_TABLE)
      .select('id, symbol, exchange, status')
      .in('status', ['NEW', 'OPEN', 'CANCEL_REQUESTED', 'FILLED', 'BRACKETED', 'SELLING', 'OCO_FAILED'])
      .order('id', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message, hint: 'rode supabase/add-manual-oco-orders-table.sql (1×)' });
    return res.json(data ?? []);
  }
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  const { data, error } = await supabase.from(MANUAL_OCO_TABLE)
    .select('*').eq('symbol', symbol.toUpperCase())
    .order('id', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message, hint: 'rode supabase/add-manual-oco-orders-table.sql (1×)' });
  res.json(data ?? []);
});

// POST /services/manual-oco-orders/:id/cancel — NEW e OPEN sem nada na corretora viram CANCELLED
// direto; OPEN com limite antiga armada (buy_handle) vira CANCEL_REQUESTED e o bot cancela a
// limite na corretora no próximo passe.
router.post('/manual-oco-orders/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const now = new Date().toISOString();
  for (const [from, to, noHandle] of [['NEW', 'CANCELLED'], ['OPEN', 'CANCELLED', true], ['OPEN', 'CANCEL_REQUESTED']]) {
    let q = supabase.from(MANUAL_OCO_TABLE)
      .update({ status: to, updated_at: now }).eq('id', id).eq('status', from);
    if (noHandle) q = q.is('buy_handle', null);
    const { data, error } = await q.select();
    if (error) return res.status(500).json({ error: error.message });
    if (data?.length) return res.json(data[0]);
  }
  res.status(409).json({ error: 'ordem não está mais pendente (já comprou ou foi encerrada)' });
});

// POST /services/manual-oco-orders/:id/sell — "Vender agora" do gráfico: cancela a OCO e vende a
// mercado a quantidade comprada (limitada ao saldo livre). Marca SELLING antes (condicional) pra o
// watcher do bot não pollar a OCO no meio. Se a OCO já tinha executado, devolve 409 e encerra a
// linha como CLOSED_*; se a OCO foi cancelada mas a venda falhou, vira OCO_FAILED (sem proteção).
router.post('/manual-oco-orders/:id/sell', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });

  const { data: rows, error: lockErr } = await supabase.from(MANUAL_OCO_TABLE)
    .update({ status: 'SELLING', updated_at: new Date().toISOString() })
    .eq('id', id).in('status', ['BRACKETED', 'OCO_FAILED', 'FILLED']).select();
  if (lockErr) return res.status(500).json({ error: lockErr.message });
  const row = rows?.[0];
  if (!row) return res.status(409).json({ error: 'ordem sem posição aberta (ainda não comprou ou já foi encerrada)' });

  const finish = (fields) => supabase.from(MANUAL_OCO_TABLE)
    .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  const exchange = row.exchange === 'gate' ? 'gate' : 'binance';
  try {
    if (exchange === 'binance') await syncBinanceClock();
    const adapter = buildAdapter(exchange, row.symbol);

    if (row.bracket) {
      await adapter.cancelExitBracket(row.bracket);
      const r = await adapter.pollExitBracket(row.bracket).catch(() => null);
      if (r?.filled) {
        const exit = { kind: r.filled, soldQty: r.soldQty, usdtOut: r.usdtOut, exitPrice: r.exitPrice, at: new Date().toISOString(), notified: false };
        await finish({ status: r.filled === 'target' ? 'CLOSED_TARGET' : 'CLOSED_STOP', exit });
        return res.status(409).json({ error: `A OCO já tinha executado (${r.filled === 'target' ? 'alvo' : 'stop'} a ~${r.exitPrice}).` });
      }
    }

    let qty = Number(row.fill?.filledQty);
    const free = Number(await adapter.getBaseBalance());
    if (Number.isFinite(free) && free > 0) qty = Number.isFinite(qty) && qty > 0 ? Math.min(qty, free) : free;
    if (!(qty > 0)) throw new Error('sem saldo do ativo para vender');

    const sold = await adapter.marketSell(qty);
    const exit = { kind: 'manual', soldQty: sold.soldQty, usdtOut: sold.usdtOut, exitPrice: sold.exitPrice, at: new Date().toISOString(), notified: false };
    await finish({ status: 'SOLD', exit, error: null });
    res.json({ ...row, status: 'SOLD', exit });
  } catch (err) {
    await finish({ status: 'OCO_FAILED', error: `venda imediata falhou: ${err.message}` });
    res.status(500).json({ error: `Venda falhou: ${err.message} — confira a posição na corretora (a OCO pode ter sido cancelada).` });
  }
});

module.exports = router;
