'use strict';

/**
 * Bracket TP/SL na Gate.io — a Gate não tem um OCO atômico (uma perna cancelando a outra
 * sozinha na corretora), então emula com DUAS ordens de gatilho por preço independentes
 * (`POST /spot/price_orders`, o "auto order" da Gate): TP dispara `rule: ">="` no valor da
 * banda superior, SL dispara `rule: "<="` no valor da banda tocada — as duas dão `put` como
 * venda A MERCADO (não uma ordem limite parada no book).
 *
 * Risco aceito (decidido com o usuário): se as duas dispararem quase juntas com o bot
 * offline, a segunda falha por saldo insuficiente — nunca vende a mais, só falha a ordem
 * redundante. Ver backend/binance/ocoClient.js pro equivalente real (atômico) na Binance.
 *
 * ⚠️ Schema de `/spot/price_orders` implementado pela documentação pública da Gate.io API v4,
 * não vendorizado/testado neste repo antes — conferir contra a doc oficial e testar com uma
 * ordem pequena (colocar + cancelar) antes de confiar em produção.
 */

const { gateRequest } = require('./getGateClient');
const { getGatePairMeta, floorGateAmount, formatGatePrice } = require('../bot/gate/gateMarketSell');

async function placeTrigger(pair, { rule, triggerPrice, amountStr }) {
  return gateRequest('POST', '/spot/price_orders', {
    trigger: { price: String(triggerPrice), rule, expiration: 86400 * 30 },
    put: { type: 'market', side: 'sell', amount: amountStr, account: 'normal', time_in_force: 'ioc' },
    market: pair,
  });
}

/** Coloca as duas ordens de gatilho (TP >= targetPrice, SL <= stopPrice). */
async function gatePlaceTriggerSell(pair, qty, { targetPrice, stopPrice }) {
  const meta = await getGatePairMeta(pair);
  const amountStr = floorGateAmount(qty, meta.amountPrecision);
  if (!amountStr) throw new Error(`gatePlaceTriggerSell: quantidade inválida (${qty})`);
  const safeTarget = formatGatePrice(targetPrice, meta.pricePrecision);
  const safeStop = formatGatePrice(stopPrice, meta.pricePrecision);
  if (!safeTarget || !safeStop) {
    throw new Error(`gatePlaceTriggerSell: preço inválido (target=${targetPrice}, stop=${stopPrice})`);
  }

  const target = await placeTrigger(pair, { rule: '>=', triggerPrice: safeTarget, amountStr });
  let stop;
  try {
    stop = await placeTrigger(pair, { rule: '<=', triggerPrice: safeStop, amountStr });
  } catch (err) {
    await gateCancelTriggerOrder(target.id).catch(() => {});
    throw err;
  }

  return {
    legs: { target: target.id, stop: stop.id },
    targetPrice: parseFloat(safeTarget), stopPrice: parseFloat(safeStop),
  };
}

async function gateCancelTriggerOrder(orderId) {
  try {
    await gateRequest('DELETE', `/spot/price_orders/${orderId}`);
  } catch (err) {
    // já disparada/cancelada/expirada — não é uma falha do cancelamento em si
    if (!/not found|invalid|order_not_found/i.test(String(err.message))) throw err;
  }
}

/**
 * Verifica se uma das duas ordens de gatilho já disparou. Se sim, cancela a outra (não
 * atômico como o OCO da Binance — ver comentário do módulo) e devolve os valores reais da
 * venda a mercado que a ordem disparada executou.
 */
async function gatePollTriggerOrders({ target, stop }) {
  const [targetOrder, stopOrder] = await Promise.all([
    gateRequest('GET', `/spot/price_orders/${target}`),
    gateRequest('GET', `/spot/price_orders/${stop}`),
  ]);

  const fired = targetOrder.status === 'finish' ? { kind: 'target', order: targetOrder }
    : stopOrder.status === 'finish' ? { kind: 'stop', order: stopOrder }
    : null;
  if (!fired) return { filled: null };

  await gateCancelTriggerOrder(fired.kind === 'target' ? stop : target).catch(() => {});

  const firedOrderId = fired.order.fired_order_id ?? fired.order.put?.order_id;
  if (!firedOrderId) return { filled: fired.kind, soldQty: null, usdtOut: null, exitPrice: null };

  const filledOrder = await gateRequest('GET', `/spot/orders/${firedOrderId}`, { currency_pair: fired.order.market });
  const soldQty = parseFloat(filledOrder.amount) - parseFloat(filledOrder.left || 0);
  const usdtOut = parseFloat(filledOrder.filled_total || 0);
  return { filled: fired.kind, soldQty, usdtOut, exitPrice: soldQty > 0 ? usdtOut / soldQty : null };
}

module.exports = { gatePlaceTriggerSell, gateCancelTriggerOrder, gatePollTriggerOrders };
