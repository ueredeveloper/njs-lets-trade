'use strict';

/**
 * Consultas de conta/mercado Gate.io usadas pelos bots de trade (saldo disponível pra
 * venda, volume 24h) — extraído de ma-cross-bot.js/amap-bot.js/swing-bot.js, que
 * reimplementavam a mesma chamada em cada arquivo.
 */

const { gateRequest } = require('./getGateClient');

const GATE_PUBLIC_BASE = 'https://api.gateio.ws/api/v4';

async function gateGetTokenBalance(pair) {
  const base     = pair.split('_')[0];
  const accounts = await gateRequest('GET', '/spot/accounts');
  const acc      = accounts.find(a => a.currency === base);
  return acc ? parseFloat(acc.available) : 0;
}

async function gate24hVolume(pair) {
  const data = await fetch(`${GATE_PUBLIC_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  return parseFloat(data[0]?.quote_volume || 0);
}

module.exports = { gateGetTokenBalance, gate24hVolume };
