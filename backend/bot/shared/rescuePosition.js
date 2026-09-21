'use strict';

/**
 * "Resgatar da corretora": reconstrói o que o painel precisa pra registrar (ou corrigir) uma
 * posição que a corretora tem mas o Supabase não sabe — quantidade TOTAL (livre + travada em
 * ordens de venda), preço médio e hora da compra (FIFO sobre os trades próprios) e a OCO de saída
 * já aberta (pra ADOTAR em vez de colocar outra por cima). Usado por
 * GET /services/sb/multitrade-rescue-position e pelo PATCH .../multitrade-bot-state
 * (adoptOrderListId). Só funções puras aqui — as chamadas à corretora ficam no serviço.
 */

const { reconstructOpenLotFifo } = require('./orphanPosition');

const RESCUE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // mais folgado que o do bot (24h): o resgate é manual
const DUST_USDT = 3;
const QTY_TOLERANCE = 0.05; // ~5% de folga pra taxa cobrada em ativo-base

/** Quantidade ainda por executar de uma ordem aberta (Binance: origQty−executedQty; Gate: left). */
function remainingQty(o) {
  if (o.left != null) return Number(o.left) || 0;
  return Math.max(0, (Number(o.origQty ?? o.amount) || 0) - (Number(o.executedQty) || 0));
}

/**
 * Separa as ordens de VENDA abertas em: a OCO completa (perna alvo + perna stop, mesmo
 * orderListId — só Binance), ordens soltas e a quantidade travada. Uma OCO trava a quantidade UMA
 * vez (as duas pernas compartilham o mesmo saldo).
 */
function summarizeSellOrders(orders) {
  const sells = (Array.isArray(orders) ? orders : [])
    .filter(o => String(o.side ?? '').toLowerCase() === 'sell');

  const lists = new Map();
  const standalone = [];
  for (const o of sells) {
    const listId = Number(o.orderListId);
    if (Number.isFinite(listId) && listId > 0) {
      if (!lists.has(listId)) lists.set(listId, []);
      lists.get(listId).push(o);
    } else {
      standalone.push(o);
    }
  }

  let oco = null;
  let lockedQty = 0;
  const otherOrders = [];

  for (const [orderListId, legs] of lists) {
    lockedQty += remainingQty(legs[0]);
    const stopLeg = legs.find(o => Number(o.stopPrice) > 0 || /STOP/i.test(String(o.type ?? '')));
    const targetLeg = legs.find(o => o !== stopLeg);
    if (stopLeg && targetLeg && !oco) {
      oco = {
        exchange: 'binance',
        orderListId,
        legs: { target: targetLeg.orderId, stop: stopLeg.orderId },
        targetPrice: Number(targetLeg.price),
        stopPrice: Number(stopLeg.stopPrice),
        qty: remainingQty(legs[0]),
      };
    } else {
      otherOrders.push({ kind: 'oco-incompleta', orderListId, qty: remainingQty(legs[0]) });
    }
  }
  for (const o of standalone) {
    lockedQty += remainingQty(o);
    otherOrders.push({
      kind: 'ordem-solta', orderId: o.orderId ?? o.id, type: o.type ?? null,
      price: Number(o.price) || null, stopPrice: Number(o.stopPrice) || null, qty: remainingQty(o),
    });
  }

  return { oco, otherOrders, lockedQty };
}

/**
 * @param {object} p
 * @param {number} p.freeQty      saldo LIVRE do ativo-base (adapter.getBaseBalance)
 * @param {Array}  p.orders       ordens abertas do símbolo (adapter.getOpenOrders)
 * @param {Array}  p.trades       trades próprios normalizados {time, price, qty, side}
 * @param {number} p.lastPrice    preço atual (pra descartar poeira)
 */
function buildRescueReport({ freeQty, orders, trades, lastPrice, now = Date.now() }) {
  const { oco, otherOrders, lockedQty } = summarizeSellOrders(orders);
  const free = Number(freeQty) > 0 ? Number(freeQty) : 0;
  const totalQty = free + lockedQty;

  if (!(totalQty > 0) || (lastPrice > 0 && totalQty * lastPrice < DUST_USDT)) {
    return { hasPosition: false, freeQty: free, lockedQty, totalQty, oco, otherOrders };
  }

  const recent = (Array.isArray(trades) ? trades : []).filter(t => t.time >= now - RESCUE_LOOKBACK_MS);
  const lot = reconstructOpenLotFifo(recent);
  const confident = !!lot && Math.abs(lot.qty - totalQty) / totalQty <= QTY_TOLERANCE;

  return {
    hasPosition: true,
    freeQty: free, lockedQty, totalQty,
    avgPrice: lot?.avgPrice ?? null,
    buyTime: lot?.firstTime ? new Date(lot.firstTime).toISOString() : null,
    tradesQty: lot?.qty ?? null,
    confident,
    oco, otherOrders,
  };
}

module.exports = { summarizeSellOrders, buildRescueReport, RESCUE_LOOKBACK_MS };
