'use strict';

const { gateRequest } = require('./getGateClient');

const GATE_BASE = 'https://api.gateio.ws/api/v4';
const GATE_FEE_RATE = 0.002;

/**
 * Compra a mercado na Gate.io. A API spot da Gate não tem um "gasta X USDT" nativo pra
 * market buy, então usa a mesma abordagem do bot (ma-cross-bot.js): ordem limit+IOC a
 * price*1.005 (preenche como se fosse a mercado, IOC cancela o que sobrar sem preencher).
 */
async function gateMarketBuy(pair, usdtAmount) {
  const ticker     = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  const price      = parseFloat(ticker[0]?.last);
  if (!price) throw new Error(`Gate.io: preço inválido para ${pair}`);
  const limitPrice = parseFloat((price * 1.005).toFixed(8));
  const qty        = parseFloat((usdtAmount / limitPrice).toFixed(8));
  const order      = await gateRequest('POST', '/spot/orders', {
    currency_pair: pair, side: 'buy', type: 'limit',
    price: String(limitPrice), amount: String(qty), time_in_force: 'ioc',
  });
  await new Promise(r => setTimeout(r, 1000));
  const filled   = await gateRequest('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || limitPrice);
  if (grossQty <= 0) throw new Error(`Gate.io: compra não preenchida (status=${filled.status})`);
  return { filledQty: grossQty * (1 - GATE_FEE_RATE), quoteQty: quoteQty || grossQty * avgPrice, avgPrice };
}

/**
 * Compra LIMITE num preço exato (ex.: valor da lower1/vwap no vwap-bands-bot) — GTC com
 * timeout curto (`waitMs`, default 20s, sondando a cada `pollMs`, default 2s) em vez de IOC.
 *
 * Motivo da troca (mesmo caso do binanceLimitBuy, ver tradeClient.js — caso PYRUSDT): o
 * sinal só é avaliado em candle FECHADO (evaluatePullbackReady em strategyEngine.js), então
 * quando o bot manda a ordem o toque na banda já passou — com IOC, o preço quase sempre já
 * voltou a subir no instante exato do envio e a ordem morre sem preencher. GTC deixa a ordem
 * parada no book por alguns segundos, cobrindo esse atraso. Cancela e desiste (`filled:
 * false`, tenta de novo no próximo tick, igual antes) se não encher dentro do timeout.
 */
async function gateLimitBuy(pair, usdtAmount, price, opts = {}) {
  const waitMs = opts.waitMs ?? 20_000;
  const pollMs = opts.pollMs ?? 2_000;

  const limitPrice = parseFloat(price.toFixed(8));
  const qty        = parseFloat((usdtAmount / limitPrice).toFixed(8));
  const order      = await gateRequest('POST', '/spot/orders', {
    currency_pair: pair, side: 'buy', type: 'limit',
    price: String(limitPrice), amount: String(qty), time_in_force: 'gtc',
  });

  const deadline = Date.now() + waitMs;
  let filled = await gateRequest('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  while (filled.status === 'open' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    filled = await gateRequest('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  }

  if (filled.status === 'open') {
    try {
      await gateRequest('DELETE', `/spot/orders/${order.id}`, {}, { query: { currency_pair: pair } });
    } catch { /* já pode ter enchido ou sido cancelada sozinha entre o último poll e aqui */ }
    // Reconfere o estado final pós-cancelamento — pode ter enchido (parcial ou total) bem
    // no instante entre o último poll e o DELETE acima.
    filled = await gateRequest('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  }

  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || limitPrice);
  if (grossQty <= 0) return { filled: false };
  return {
    filled: true, filledQty: grossQty * (1 - GATE_FEE_RATE), quoteQty: quoteQty || grossQty * avgPrice, avgPrice,
  };
}

module.exports = { gateMarketBuy, gateLimitBuy };
