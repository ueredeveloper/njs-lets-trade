'use strict';

/**
 * Consultas de conta/mercado Gate.io usadas pelos bots de trade (saldo disponível pra
 * venda, volume 24h) — extraído de ma-cross-bot.js/amap-bot.js/swing-bot.js, que
 * reimplementavam a mesma chamada em cada arquivo.
 */

const { gateRequest } = require('./getGateClient');

const GATE_PUBLIC_BASE = 'https://api.gateio.ws/api/v4';

/** Saldo livre de UMA moeda da conta (ex.: 'SKYAI', 'USDT') — usado tanto pro ativo-base
 *  (gateGetTokenBalance) quanto pro quote (gateGetQuoteBalance). */
async function gateGetBalance(currency) {
  const accounts = await gateRequest('GET', '/spot/accounts');
  const acc      = accounts.find(a => a.currency === currency);
  return acc ? parseFloat(acc.available) : 0;
}

async function gateGetTokenBalance(pair) {
  return gateGetBalance(pair.split('_')[0]);
}

/** Saldo livre de USDT — quanto dá pra gastar numa compra nova/reforço agora (ver
 *  /multitrade-buy-quote em supabaseService.js). */
async function gateGetQuoteBalance() {
  return gateGetBalance('USDT');
}

async function gate24hVolume(pair) {
  const data = await fetch(`${GATE_PUBLIC_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  return parseFloat(data[0]?.quote_volume || 0);
}

/** Último preço negociado — usado pelo aviso de faixa válida no slider OCO do botão de
 *  vender (ver /gate-price em fetchGateTrades.js). */
async function gateLastPrice(pair) {
  const data = await fetch(`${GATE_PUBLIC_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  return parseFloat(data[0]?.last || 0);
}

/** Trades próprios recentes, normalizados pro mesmo formato usado em tradeClient.js
 *  (binanceGetOwnTrades) — ver backend/bot/shared/orphanPosition.js. */
async function gateGetOwnTrades(pair, limit = 200) {
  const trades = await gateRequest('GET', '/spot/my_trades', { currency_pair: pair, limit: String(limit) });
  return trades.map(t => ({
    time: t.create_time_ms ? Number(t.create_time_ms) : Math.round(parseFloat(t.create_time) * 1000),
    price: parseFloat(t.price),
    qty: parseFloat(t.amount),
    side: t.side,
  }));
}

/** Ordens abertas pro par — mesmo propósito de binanceGetOpenOrders em tradeClient.js
 *  (ver backend/bot/shared/orphanPosition.js). */
async function gateGetOpenOrders(pair) {
  const data = await gateRequest('GET', '/spot/orders', { currency_pair: pair, status: 'open' });
  return Array.isArray(data) ? data : [];
}

module.exports = {
  gateGetTokenBalance, gateGetQuoteBalance, gate24hVolume, gateGetOwnTrades, gateGetOpenOrders, gateLastPrice,
};
