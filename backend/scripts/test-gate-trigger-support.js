'use strict';

/**
 * Testa se um par da Gate.io aceita ordens de gatilho (`POST /spot/price_orders`) — o
 * mecanismo que o bot usa pra emular TP/SL tipo OCO (ver backend/gate/gateBracketOrders.js,
 * que não é atômico como o OCO da Binance e não tinha sido testado par a par antes).
 *
 * Coloca as duas pernas (TP acima do preço atual, SL abaixo) com gatilhos bem longe do
 * mercado — não deveriam disparar no tempo do teste — e cancela as duas em seguida. Se a
 * Gate aceitar e devolver um id, o par suporta o recurso. Se rejeitar, o erro da Gate
 * normalmente indica o motivo (par sem suporte a price_orders, saldo insuficiente, etc).
 *
 * Uso:
 *   node backend/scripts/test-gate-trigger-support.js 龙虾USDT
 *   node backend/scripts/test-gate-trigger-support.js BTCUSDT
 */

require('dotenv').config();
const { gateRequest } = require('../gate/getGateClient');
const { gateGetTokenBalance } = require('../gate/gateAccount');
const { getGatePairMeta, formatGatePrice } = require('../bot/gate/gateMarketSell');
const { toGateSymbol } = require('../utils/toGateSymbol');

async function placeTrigger(pair, { rule, triggerPrice, amountStr }) {
  return gateRequest('POST', '/spot/price_orders', {
    trigger: { price: String(triggerPrice), rule, expiration: 86400 * 30 },
    put: { type: 'market', side: 'sell', amount: amountStr, account: 'normal', time_in_force: 'ioc' },
    market: pair,
  });
}

async function cancelQuiet(id) {
  if (!id) return;
  try {
    await gateRequest('DELETE', `/spot/price_orders/${id}`);
    console.log(`   cancelado (id ${id})`);
  } catch (err) {
    console.log(`   ⚠️  cancelamento falhou (id ${id}): ${err.message}`);
  }
}

async function main() {
  const rawSymbol = process.argv[2];
  if (!rawSymbol) {
    console.error('Uso: node backend/scripts/test-gate-trigger-support.js <SYMBOL ex: BTCUSDT ou 龙虾USDT>');
    process.exit(1);
  }
  const pair = rawSymbol.includes('_') ? rawSymbol : toGateSymbol(rawSymbol);

  console.log(`Par: ${pair}`);
  const meta = await getGatePairMeta(pair);
  console.log('Meta:', meta);

  const ticker = await gateRequest('GET', '/spot/tickers', { currency_pair: pair });
  const lastPrice = parseFloat(ticker[0]?.last);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    console.error('Não consegui obter preço atual — abortando.');
    process.exit(1);
  }
  console.log(`Preço atual: ${lastPrice}`);

  const balance = await gateGetTokenBalance(pair);

  // Notional mínimo pra ordens de gatilho costuma ser maior que o min_quote_amount de ordem
  // normal (confirmado na prática: par com min_base_amount=1 rejeitou com
  // "spot_api_order_total_too_small 1 USDT") — soma uma margem e arredonda pra cima (não pra
  // baixo, senão cai de novo abaixo do mínimo) na precisão do par.
  const minNotionalUsdt = Math.max(meta.minQuoteAmount || 0, 1) * 1.2;
  const factor = 10 ** meta.amountPrecision;
  const rawMinQty = Math.max(meta.minBaseAmount || 0, minNotionalUsdt / lastPrice);
  const amountStr = (Math.ceil(rawMinQty * factor) / factor).toFixed(meta.amountPrecision);

  console.log(`Saldo disponível: ${balance} | quantidade usada no teste: ${amountStr} (~$${(amountStr * lastPrice).toFixed(4)})`);
  if (balance < parseFloat(amountStr)) {
    console.log('⚠️  Saldo insuficiente pra cobrir a quantidade de teste — se a Gate rejeitar por saldo,');
    console.log('   isso NÃO significa que o par não suporta price_orders. O erro abaixo deixa claro qual foi.');
  }

  // Longe o bastante do preço atual pra não dar match nem no meio do teste.
  const targetTrigger = formatGatePrice(lastPrice * 3, meta.pricePrecision);
  const stopTrigger = formatGatePrice(lastPrice * 0.3, meta.pricePrecision);

  let targetId = null;
  let stopId = null;
  let ok = true;

  try {
    console.log(`\n[TP] rule >= ${targetTrigger} ...`);
    const target = await placeTrigger(pair, { rule: '>=', triggerPrice: targetTrigger, amountStr });
    targetId = target.id;
    console.log(`   aceito, id ${targetId}`);
  } catch (err) {
    ok = false;
    console.log(`   ❌ rejeitado: ${err.message}`);
  }

  try {
    console.log(`[SL] rule <= ${stopTrigger} ...`);
    const stop = await placeTrigger(pair, { rule: '<=', triggerPrice: stopTrigger, amountStr });
    stopId = stop.id;
    console.log(`   aceito, id ${stopId}`);
  } catch (err) {
    ok = false;
    console.log(`   ❌ rejeitado: ${err.message}`);
  }

  console.log('\nCancelando ordens de teste...');
  await cancelQuiet(targetId);
  await cancelQuiet(stopId);

  console.log(`\nResultado: ${ok ? '✅ par ACEITA price_orders (bracket TP/SL do bot deve funcionar)' : '❌ par NÃO aceitou uma ou ambas as pernas — ver erro acima'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
