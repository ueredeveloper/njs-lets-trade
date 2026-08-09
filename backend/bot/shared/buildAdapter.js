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
const { gateMarketBuy, gateLimitBuy, gatePlaceRestingLimitBuy, gatePollRestingLimitBuy, gateCancelRestingLimitBuy } = require('../../gate/gateMarketBuy');
const { gateGetTokenBalance, gate24hVolume } = require('../../gate/gateAccount');
const { gateRequest } = require('../../gate/getGateClient');
const { gateMarketSell: gateMarketSellCore } = require('../gate/gateMarketSell');
const {
  gatePlaceTriggerSell, gateCancelTriggerOrder, gatePollTriggerOrders,
} = require('../../gate/gateBracketOrders');
const {
  binanceMarketBuy, binanceLimitBuy, binanceMarketSell, binance24hVolume, syncBinanceClock,
  binancePlaceRestingLimitBuy, binancePollRestingLimitBuy, binanceCancelRestingLimitBuy,
} = require('../../binance/tradeClient');
const { binancePlaceOcoSell, binanceCancelOco, binancePollOco } = require('../../binance/ocoClient');

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
      marketBuy:    (usdt)        => gateMarketBuy(pair, usdt),
      limitBuy:     (usdt, price) => gateLimitBuy(pair, usdt, price),
      placeRestingLimitBuy:  (usdt, price) => gatePlaceRestingLimitBuy(pair, usdt, price),
      pollRestingLimitBuy:   (handle) => gatePollRestingLimitBuy(pair, handle),
      cancelRestingLimitBuy: (handle) => gateCancelRestingLimitBuy(pair, handle),
      marketSell:   (qty, log, opts) => gateMarketSell(pair, qty, log, opts),
      fetch24hVol:  ()         => gate24hVolume(pair),
      // Bracket TP/SL emulado (sem OCO atômico nativo) — ver gateBracketOrders.js.
      placeExitBracket: async (qty, targetPrice, stopPrice) => {
        const r = await gatePlaceTriggerSell(pair, qty, { targetPrice, stopPrice });
        return { exchange: 'gate', legs: r.legs, targetPrice: r.targetPrice, stopPrice: r.stopPrice };
      },
      cancelExitBracket: (handle) => Promise.all([
        gateCancelTriggerOrder(handle.legs.target),
        gateCancelTriggerOrder(handle.legs.stop),
      ]),
      pollExitBracket: (handle) => gatePollTriggerOrders(handle.legs),
    };
  }
  return {
    name: 'Binance', pair: symbol,
    fetchCandles: (lim, iv) => fetchBinanceCandles(symbol, lim, iv),
    marketBuy:    (usdt)        => binanceMarketBuy(symbol, usdt),
    limitBuy:     (usdt, price) => binanceLimitBuy(symbol, usdt, price),
    placeRestingLimitBuy:  (usdt, price) => binancePlaceRestingLimitBuy(symbol, usdt, price),
    pollRestingLimitBuy:   (handle) => binancePollRestingLimitBuy(symbol, handle),
    cancelRestingLimitBuy: (handle) => binanceCancelRestingLimitBuy(symbol, handle),
    marketSell:   (qty)      => binanceMarketSell(symbol, qty),
    fetch24hVol:  ()         => binance24hVolume(symbol),
    // OCO real (uma perna cancela a outra na própria Binance) — ver binance/ocoClient.js.
    placeExitBracket: async (qty, targetPrice, stopPrice) => {
      const r = await binancePlaceOcoSell(symbol, qty, targetPrice, stopPrice);
      return { exchange: 'binance', legs: r.legs, orderListId: r.orderListId, targetPrice: r.targetPrice, stopPrice: r.stopPrice };
    },
    cancelExitBracket: (handle) => binanceCancelOco(symbol, handle.orderListId),
    pollExitBracket: (handle) => binancePollOco(symbol, handle.orderListId, handle.legs),
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
