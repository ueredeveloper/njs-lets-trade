'use strict';

const { gateRequest } = require('./getGateClient');

const GATE_BASE = 'https://api.gateio.ws/api/v4';
const GATE_FEE_RATE = 0.002;

/**
 * Compra a mercado na Gate.io. A API spot da Gate não tem um "gasta X USDT" nativo pra
 * market buy, então usa a mesma abordagem do bot (ma-cross-bot.js): ordem limit+IOC a
 * price*1.005 (preenche como se fosse a mercado, IOC cancela o que sobrar sem preencher).
 */
async function gateMarketBuy(pair, usdtAmount) {
  const ticker     = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  const price      = parseFloat(ticker[0]?.last);
  if (!price) throw new Error(`Gate.io: preço inválido para ${pair}`);
  const limitPrice = parseFloat((price * 1.005).toFixed(8));
  const qty        = parseFloat((usdtAmount / limitPrice).toFixed(8));
  const order      = await gateRequest('POST', '/spot/orders', {
    currency_pair: pair, side: 'buy', type: 'limit',
    price: String(limitPrice), amount: String(qty), time_in_force: 'ioc',
  });
  await new Promise(r => setTimeout(r, 1000));
  const filled   = await gateRequest('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || limitPrice);
  if (grossQty <= 0) throw new Error(`Gate.io: compra não preenchida (status=${filled.status})`);
  return { filledQty: grossQty * (1 - GATE_FEE_RATE), quoteQty: quoteQty || grossQty * avgPrice, avgPrice };
}

/**
 * Compra LIMITE num preço exato (ex.: valor da lower1/vwap no vwap-bands-bot) — GTC com
 * timeout curto (`waitMs`, default 20s, sondando a cada `pollMs`, default 2s) em vez de IOC.
 *
 * Motivo da troca (mesmo caso do binanceLimitBuy, ver tradeClient.js — caso PYRUSDT): o
 * sinal só é avaliado em candle FECHADO (evaluatePullbackReady em strategyEngine.js), então
 * quando o bot manda a ordem o toque na banda já passou — com IOC, o preço quase sempre já
 * voltou a subir no instante exato do envio e a ordem morre sem preencher. GTC deixa a ordem
 * parada no book por alguns segundos, cobrindo esse atraso. Cancela e desiste (`filled:
 * false`, tenta de novo no próximo tick, igual antes) se não encher dentro do timeout.
 */
async function gateLimitBuy(pair, usdtAmount, price, opts = {}) {
  const waitMs = opts.waitMs ?? 20_000;
  const pollMs = opts.pollMs ?? 2_000;

  const handle = await gatePlaceRestingLimitBuy(pair, usdtAmount, price);
  const deadline = Date.now() + waitMs;
  let filled = await gateRequest('GET', `/spot/orders/${handle.orderId}`, { currency_pair: pair });
  while (filled.status === 'open' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    filled = await gateRequest('GET', `/spot/orders/${handle.orderId}`, { currency_pair: pair });
  }

  if (filled.status === 'open') {
    try {
      await gateRequest('DELETE', `/spot/orders/${handle.orderId}`, {}, { query: { currency_pair: pair } });
    } catch { /* já pode ter enchido ou sido cancelada sozinha entre o último poll e aqui */ }
    filled = await gateRequest('GET', `/spot/orders/${handle.orderId}`, { currency_pair: pair });
  }

  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || handle.price);
  if (grossQty <= 0) return { filled: false };
  return {
    filled: true, filledQty: grossQty * (1 - GATE_FEE_RATE), quoteQty: quoteQty || grossQty * avgPrice, avgPrice,
  };
}

/** Coloca LIMIT GTC e retorna na hora — ver binancePlaceRestingLimitBuy. */
async function gatePlaceRestingLimitBuy(pair, usdtAmount, price) {
  const limitPrice = parseFloat(price.toFixed(8));
  const qty        = parseFloat((usdtAmount / limitPrice).toFixed(8));
  const order      = await gateRequest('POST', '/spot/orders', {
    currency_pair: pair, side: 'buy', type: 'limit',
    price: String(limitPrice), amount: String(qty), time_in_force: 'gtc',
  });
  return {
    exchange: 'gate',
    orderId: order.id,
    price: limitPrice,
    qty,
    status: order.status,
    pair,
  };
}

async function gatePollRestingLimitBuy(pair, handle) {
  const filled = await gateRequest('GET', `/spot/orders/${handle.orderId}`, { currency_pair: pair });
  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || handle.price);
  if (filled.status === 'closed' || (grossQty > 0 && filled.status !== 'open')) {
    if (!(grossQty > 0)) return { filled: false, status: filled.status, open: false };
    return {
      filled: true,
      status: filled.status,
      open: false,
      filledQty: grossQty * (1 - GATE_FEE_RATE),
      quoteQty: quoteQty || grossQty * avgPrice,
      avgPrice,
    };
  }
  if (filled.status === 'open') {
    return { filled: false, status: filled.status, open: true, filledQty: grossQty, quoteQty };
  }
  return { filled: false, status: filled.status, open: false, filledQty: grossQty, quoteQty };
}

async function gateCancelRestingLimitBuy(pair, handle) {
  try {
    await gateRequest('DELETE', `/spot/orders/${handle.orderId}`, {}, { query: { currency_pair: pair } });
  } catch { /* já pode ter enchido/cancelado */ }
  return gatePollRestingLimitBuy(pair, handle);
}

module.exports = {
  gateMarketBuy,
  gateLimitBuy,
  gatePlaceRestingLimitBuy,
  gatePollRestingLimitBuy,
  gateCancelRestingLimitBuy,
};
