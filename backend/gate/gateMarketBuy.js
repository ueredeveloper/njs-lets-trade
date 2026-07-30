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
 * Compra LIMITE (IOC) num preço exato (ex.: valor da lower1/vwap no vwap-bands-bot) — mesma
 * mecânica do gateMarketBuy (limit+IOC), mas no preço passado em vez de price*1.005. Se não
 * preencher nada, devolve `{ filled: false }` em vez de lançar erro — não é uma falha, só
 * "o preço já saiu dali de novo"; quem chama decide se tenta de novo no próximo tick.
 */
async function gateLimitBuy(pair, usdtAmount, price) {
  const limitPrice = parseFloat(price.toFixed(8));
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
  if (grossQty <= 0) return { filled: false };
  return {
    filled: true, filledQty: grossQty * (1 - GATE_FEE_RATE), quoteQty: quoteQty || grossQty * avgPrice, avgPrice,
  };
}

module.exports = { gateMarketBuy, gateLimitBuy };
