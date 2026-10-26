'use strict';

/**
 * Último preço negociado AO VIVO (endpoints públicos, sem API key) — não o cache de até 5 min do
 * /ticker/24hr (binance/cachedTicker24hr.js). Usado pela OCO manual do gráfico: a rota
 * /services/manual-oco-* (decidir limite × rompimento, recusar compra fora da faixa) e o
 * manualOcoWatcher do bot (gatilho de rompimento).
 */

const { toGateSymbol } = require('../../utils/toGateSymbol');

async function fetchLivePrice(exchange, symbol) {
  if (exchange === 'gate') {
    const pair = toGateSymbol(symbol);
    const ticker = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`).then(r => r.json());
    return parseFloat(ticker?.[0]?.last);
  }
  const data = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`).then(r => r.json());
  return parseFloat(data?.price);
}

module.exports = { fetchLivePrice };
