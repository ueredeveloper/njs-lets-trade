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
  // PERCENT_PRICE_BY_SIDE (símbolos novos) ou PERCENT_PRICE (legado, mesmo multiplier pros
  // dois lados) — limita o quanto uma ordem SELL (nossas duas pernas da OCO) pode se afastar
  // do preço médio ponderado atual da Binance. Ver validação em binancePlaceOcoSell.
  const pctFilter = filters.find(f => f.filterType === 'PERCENT_PRICE_BY_SIDE')
    ?? filters.find(f => f.filterType === 'PERCENT_PRICE');
  const tickSize = priceFilter ? parseFloat(priceFilter.tickSize) : 0.00000001;
  const stepSize = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  return {
    tickSize, stepSize,
    priceDecimals: decimalsFromStep(tickSize),
    qtyDecimals: decimalsFromStep(stepSize),
    askMultiplierUp: pctFilter ? parseFloat(pctFilter.askMultiplierUp ?? pctFilter.multiplierUp) : null,
    askMultiplierDown: pctFilter ? parseFloat(pctFilter.askMultiplierDown ?? pctFilter.multiplierDown) : null,
  };
}

async function getAvgPrice(symbol) {
  const data = await fetch(`${BINANCE_BASE}/api/v3/avgPrice?symbol=${symbol}`).then(r => r.json());
  return parseFloat(data.price);
}

function roundToStep(value, step, decimals, mode = 'round') {
  const fn = mode === 'floor' ? Math.floor : Math.round;
  return (fn(value / step) * step).toFixed(decimals);
}

// STOP_LOSS_LIMIT ativa uma ordem LIMITE quando o preço cruza stopPrice — se o limite fosse
// o próprio stopPrice (sem folga), numa queda rápida o preço já passou daquele nível quando a
// ordem ativa e ela fica presa no book esperando o preço VOLTAR a subir até ali (caso real:
// XECUSDT bateu no stop 2x no 15m e não vendeu, ver conversa com o usuário). A folga abaixo do
// stopPrice dá espaço pra ordem casar contra o book em vez de esperar um preço exato.
const STOP_LIMIT_SLIPPAGE_PCT = 0.3;

/**
 * Coloca a OCO de venda: TP em targetPrice (LIMIT_MAKER), SL disparado em stopPrice
 * (STOP_LOSS_LIMIT, limite STOP_LIMIT_SLIPPAGE_PCT% abaixo do stopPrice — GTC — pra ter chance
 * de preencher numa queda rápida em vez de ficar presa no book esperando o preço exato).
 */
async function binancePlaceOcoSell(symbol, qty, targetPrice, stopPrice) {
  const {
    tickSize, stepSize, priceDecimals, qtyDecimals, askMultiplierUp, askMultiplierDown,
  } = await getSymbolFilters(symbol);
  const safeQty = roundToStep(qty, stepSize, qtyDecimals, 'floor');
  if (!(parseFloat(safeQty) > 0)) {
    throw new Error(`binancePlaceOcoSell: quantidade inválida após arredondamento (${safeQty})`);
  }
  const safeTarget = roundToStep(targetPrice, tickSize, priceDecimals);
  const safeStop = roundToStep(stopPrice, tickSize, priceDecimals);
  const safeStopLimit = roundToStep(
    parseFloat(safeStop) * (1 - STOP_LIMIT_SLIPPAGE_PCT / 100), tickSize, priceDecimals, 'floor',
  );

  // PERCENT_PRICE_BY_SIDE: as duas pernas da OCO são ordens SELL (ask) — a Binance rejeita
  // (400 "Filter failure: PERCENT_PRICE_BY_SIDE") se o preço estiver longe demais do preço
  // médio ponderado ATUAL, o que acontece fácil quando alvo/stop são calculados sobre o preço
  // de ENTRADA (venda manual OCO) e o mercado já andou bastante desde a compra. Valida aqui
  // com uma mensagem clara em vez de deixar o erro cru da Binance estourar como 500 genérico.
  if (askMultiplierUp != null && askMultiplierDown != null) {
    const avgPrice = await getAvgPrice(symbol);
    if (avgPrice > 0) {
      const maxAsk = avgPrice * askMultiplierUp;
      const minAsk = avgPrice * askMultiplierDown;
      const problems = [];
      if (parseFloat(safeTarget) > maxAsk) {
        const maxTargetPct = ((maxAsk / avgPrice) - 1) * 100;
        problems.push(`alvo ${safeTarget} acima do máximo permitido agora (~${maxAsk.toFixed(priceDecimals)}, até +${maxTargetPct.toFixed(1)}% do preço atual)`);
      }
      if (parseFloat(safeStopLimit) < minAsk) {
        const minStopPct = (1 - (minAsk / avgPrice)) * 100;
        problems.push(`stop ${safeStopLimit} abaixo do mínimo permitido agora (~${minAsk.toFixed(priceDecimals)}, até -${minStopPct.toFixed(1)}% do preço atual)`);
      }
      if (problems.length) {
        throw new Error(
          `binancePlaceOcoSell: ${problems.join('; ')} — preço atual ~${avgPrice.toFixed(priceDecimals)}. `
          + 'Arraste o alvo/stop mais perto do preço de mercado e tente de novo.',
        );
      }
    }
  }

  const order = await binanceRequest('POST', '/api/v3/order/oco', {
    symbol, side: 'SELL', quantity: safeQty,
    price: safeTarget,
    stopPrice: safeStop,
    stopLimitPrice: safeStopLimit,
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
