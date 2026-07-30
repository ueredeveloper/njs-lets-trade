'use strict';

/**
 * Adaptador de exchange pros bots de trade (ma-cross, e qualquer bot novo que reaproveite
 * este módulo): dado `exchange` ('gate'|'binance') e o símbolo Binance, devolve um objeto
 * único {fetchCandles, marketBuy, marketSell, fetch24hVol} — o resto do bot (tick, execução
 * de ordem) fica agnóstico de qual exchange está operando.
 *
 * Extraído de ma-cross-bot.js (mesma função existia colada, idêntica, em amap-bot.js e
 * swing-bot.js) — ver conversa sobre componentização antes de criar um bot novo (ema-reclaim).
 */

const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { gateMarketBuy } = require('../../gate/gateMarketBuy');
const { gateGetTokenBalance, gate24hVolume } = require('../../gate/gateAccount');
const { gateRequest } = require('../../gate/getGateClient');
const { gateMarketSell: gateMarketSellCore } = require('../gate/gateMarketSell');
const {
  binanceMarketBuy, binanceMarketSell, binance24hVolume, syncBinanceClock,
} = require('../../binance/tradeClient');

async function gateMarketSell(pair, qty, log, opts = {}) {
  return gateMarketSellCore(
    { gateReq: gateRequest, getTokenBalance: gateGetTokenBalance },
    pair, qty, log, opts,
  );
}

function buildAdapter(exchange, symbol) {
  if (exchange === 'gate') {
    const pair = toGateSymbol(symbol);
    return {
      name: 'Gate.io', pair,
      fetchCandles: (lim, iv) => fetchGateCandles(pair, lim, iv),
      marketBuy:    (usdt)     => gateMarketBuy(pair, usdt),
      marketSell:   (qty, log, opts) => gateMarketSell(pair, qty, log, opts),
      fetch24hVol:  ()         => gate24hVolume(pair),
    };
  }
  return {
    name: 'Binance', pair: symbol,
    fetchCandles: (lim, iv) => fetchBinanceCandles(symbol, lim, iv),
    marketBuy:    (usdt)     => binanceMarketBuy(symbol, usdt),
    marketSell:   (qty)      => binanceMarketSell(symbol, qty),
    fetch24hVol:  ()         => binance24hVolume(symbol),
  };
}

/** Sincroniza os relógios das duas exchanges — chamar no boot do bot e a cada hora. */
async function syncExchangeClocks() {
  await Promise.all([syncBinanceClock()]);
}

module.exports = {
  buildAdapter,
  syncExchangeClocks,
};
