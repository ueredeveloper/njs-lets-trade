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
    // Lado bid (ordens BUY, ex.: pullback do favorito Bollinger Bands) — mesmo filtro, ver
    // getSymbolPercentPriceFilter em fetchBinanceTrades.js.
    bidMultiplierUp: pctFilter ? parseFloat(pctFilter.bidMultiplierUp ?? pctFilter.multiplierUp) : null,
    bidMultiplierDown: pctFilter ? parseFloat(pctFilter.bidMultiplierDown ?? pctFilter.multiplierDown) : null,
  };
}

async function getAvgPrice(symbol) {
  const data = await fetch(`${BINANCE_BASE}/api/v3/avgPrice?symbol=${symbol}`).then(r => r.json());
  return parseFloat(data.price);
}

function roundToStep(value, step, decimals, mode = 'round') {
  const fn = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
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
  let safeTarget = roundToStep(targetPrice, tickSize, priceDecimals);
  let safeStop = roundToStep(stopPrice, tickSize, priceDecimals);
  let safeStopLimit = roundToStep(
    parseFloat(safeStop) * (1 - STOP_LIMIT_SLIPPAGE_PCT / 100), tickSize, priceDecimals, 'floor',
  );

  // PERCENT_PRICE_BY_SIDE: as duas pernas da OCO são ordens SELL (ask) — a Binance rejeita
  // (400 "Filter failure: PERCENT_PRICE_BY_SIDE") se o preço estiver longe demais do preço
  // médio ponderado ATUAL, o que acontece fácil quando alvo/stop são calculados sobre o preço
  // de ENTRADA (venda manual OCO) ou sobre uma banda/EMA distante e o mercado já andou bastante
  // desde a compra. Em vez de jogar o erro cru da Binance (ou desistir de colocar a OCO
  // inteira), PRENDE (clamp) o lado que estourou o limite na borda permitida — ex.: usuário
  // comprou a $10 com stop calculado em $5, mas a Binance só aceita até $8 de distância: em
  // vez de ficar sem proteção nenhuma, coloca o stop em $8. SAFETY_MARGIN_PCT dá uma folga
  // pra sobreviver ao arredondamento de tick sem cair de novo fora do limite.
  const clamped = { target: false, stop: false };
  if (askMultiplierUp != null && askMultiplierDown != null) {
    const avgPrice = await getAvgPrice(symbol);
    if (avgPrice > 0) {
      const SAFETY_MARGIN_PCT = 0.2;
      const maxAsk = avgPrice * askMultiplierUp;
      const minAsk = avgPrice * askMultiplierDown;

      if (parseFloat(safeTarget) > maxAsk) {
        safeTarget = roundToStep(maxAsk * (1 - SAFETY_MARGIN_PCT / 100), tickSize, priceDecimals, 'floor');
        clamped.target = true;
      }
      if (parseFloat(safeStopLimit) < minAsk) {
        // Reconstrói o stopPrice (trigger) a partir do limite prendido, mantendo a mesma
        // folga de STOP_LIMIT_SLIPPAGE_PCT entre trigger e limite.
        safeStopLimit = roundToStep(minAsk * (1 + SAFETY_MARGIN_PCT / 100), tickSize, priceDecimals, 'ceil');
        safeStop = roundToStep(
          parseFloat(safeStopLimit) / (1 - STOP_LIMIT_SLIPPAGE_PCT / 100), tickSize, priceDecimals, 'ceil',
        );
        clamped.stop = true;
      }

      if (parseFloat(safeStop) >= parseFloat(safeTarget)) {
        throw new Error(
          `binancePlaceOcoSell: alvo (${safeTarget}) e stop (${safeStop}) ficaram incompatíveis após `
          + `ajuste aos limites da Binance (~${minAsk.toFixed(priceDecimals)} a ~${maxAsk.toFixed(priceDecimals)}, `
          + `preço atual ~${avgPrice.toFixed(priceDecimals)}) — intervalo alvo/stop grande demais pra caber na margem permitida.`,
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
  return {
    orderListId: order.orderListId, legs,
    targetPrice: parseFloat(safeTarget), stopPrice: parseFloat(safeStop),
    clamped: (clamped.target || clamped.stop) ? clamped : null,
    requestedTargetPrice: parseFloat(roundToStep(targetPrice, tickSize, priceDecimals)),
    requestedStopPrice: parseFloat(roundToStep(stopPrice, tickSize, priceDecimals)),
  };
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

module.exports = { binancePlaceOcoSell, binanceCancelOco, binancePollOco, getSymbolFilters, getAvgPrice };
