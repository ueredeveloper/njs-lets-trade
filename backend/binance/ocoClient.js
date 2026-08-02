'use strict';

/**
 * OCO (One-Cancels-Other) de venda na Binance — usado pelo vwap-bands quando
 * `trade_config.exit.restingBracket.enabled` pra colocar TP (LIMIT_MAKER na banda-alvo) e SL
 * (STOP_LOSS_LIMIT na banda tocada) já na corretora, logo após a compra confirmar. Enchendo
 * uma perna, a Binance cancela a outra sozinha (é uma única orderList, não duas ordens soltas)
 * — ver backend/gate/gateBracketOrders.js pro equivalente emulado na Gate.io (que não tem OCO
 * atômico).
 *
 * ⚠️ Implementado contra o endpoint clássico `/api/v3/order/oco`. Testar com uma ordem pequena
 * antes de confiar em produção — a Binance vem migrando integrações novas pra
 * `/api/v3/orderList/oco`, e não há como confirmar qual está ativa pra esta conta sem bater
 * na API de verdade.
 *
 * Reaproveita binanceRequest (mesmo signer/offset de relógio de tradeClient.js).
 */

const { binanceRequest, decimalsFromStep } = require('./tradeClient');

const BINANCE_BASE = 'https://api.binance.com';

async function getSymbolFilters(symbol) {
  const info = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const filters = info.symbols?.[0]?.filters ?? [];
  const priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER');
  const lotFilter = filters.find(f => f.filterType === 'LOT_SIZE');
  const tickSize = priceFilter ? parseFloat(priceFilter.tickSize) : 0.00000001;
  const stepSize = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  return {
    tickSize, stepSize,
    priceDecimals: decimalsFromStep(tickSize),
    qtyDecimals: decimalsFromStep(stepSize),
  };
}

function roundToStep(value, step, decimals, mode = 'round') {
  const fn = mode === 'floor' ? Math.floor : Math.round;
  return (fn(value / step) * step).toFixed(decimals);
}

/**
 * Coloca a OCO de venda: TP em targetPrice (LIMIT_MAKER), SL disparado em stopPrice
 * (STOP_LOSS_LIMIT, vende no próprio stopPrice como limite — GTC, sem folga extra; se o
 * mercado gapear abaixo disso a ordem fica no book até preencher ou até o bot substituir no
 * próximo tick por deriva).
 */
async function binancePlaceOcoSell(symbol, qty, targetPrice, stopPrice) {
  const { tickSize, stepSize, priceDecimals, qtyDecimals } = await getSymbolFilters(symbol);
  const safeQty = roundToStep(qty, stepSize, qtyDecimals, 'floor');
  if (!(parseFloat(safeQty) > 0)) {
    throw new Error(`binancePlaceOcoSell: quantidade inválida após arredondamento (${safeQty})`);
  }
  const safeTarget = roundToStep(targetPrice, tickSize, priceDecimals);
  const safeStop = roundToStep(stopPrice, tickSize, priceDecimals);

  const order = await binanceRequest('POST', '/api/v3/order/oco', {
    symbol, side: 'SELL', quantity: safeQty,
    price: safeTarget,
    stopPrice: safeStop,
    stopLimitPrice: safeStop,
    stopLimitTimeInForce: 'GTC',
  });

  const legs = {};
  for (const o of order.orderReports ?? order.orders ?? []) {
    if (o.type === 'STOP_LOSS_LIMIT' || o.stopPrice) legs.stop = o.orderId;
    else legs.target = o.orderId;
  }
  return { orderListId: order.orderListId, legs, targetPrice: parseFloat(safeTarget), stopPrice: parseFloat(safeStop) };
}

async function binanceCancelOco(symbol, orderListId) {
  try {
    await binanceRequest('DELETE', '/api/v3/orderList', { symbol, orderListId });
  } catch (err) {
    // já executada/cancelada — não é uma falha do cancelamento em si
    if (!/Unknown order|order list/i.test(String(err.message))) throw err;
  }
}

/**
 * Verifica se uma das pernas encheu. Retorna `{ filled: null }` se a lista ainda está
 * EXECUTING nas duas pernas, ou `{ filled: 'target'|'stop', soldQty, usdtOut, exitPrice }`
 * com os valores reais preenchidos na perna que fechou.
 */
async function binancePollOco(symbol, orderListId, legs) {
  const list = await binanceRequest('GET', '/api/v3/orderList', { orderListId });
  if (list.listOrderStatus !== 'ALL_DONE') return { filled: null };

  for (const [kind, orderId] of Object.entries(legs)) {
    const order = await binanceRequest('GET', '/api/v3/order', { symbol, orderId });
    if (order.status === 'FILLED') {
      const soldQty = parseFloat(order.executedQty);
      const usdtOut = parseFloat(order.cummulativeQuoteQty);
      return { filled: kind, soldQty, usdtOut, exitPrice: usdtOut / soldQty };
    }
  }
  // ALL_DONE mas nenhuma perna FILLED (ex.: cancelada externamente) — trata como não preenchida
  return { filled: null };
}

module.exports = { binancePlaceOcoSell, binanceCancelOco, binancePollOco };
