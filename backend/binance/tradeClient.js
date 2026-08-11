'use strict';

/**
 * Cliente Binance (REST assinado) para os bots de trade — compra/venda a mercado e
 * sincronização de relógio. Extraído de ma-cross-bot.js/amap-bot.js/swing-bot.js, que
 * tinham cada um sua própria cópia colada deste bloco (~60 linhas idênticas).
 *
 * Não usa o SDK `binance-api-node` (backend/binance/getClient.js) de propósito: os bots
 * já dependiam do endpoint bruto com quoteOrderQty (compra "gasta X USDT") e do próprio
 * fallback de arredondamento por LOT_SIZE na venda, então a extração preserva o
 * comportamento exato em vez de trocar de biblioteca.
 */

const crypto = require('crypto');

const BINANCE_BASE = 'https://api.binance.com';
const GATE_FEE_RATE_EQUIV = 0.002; // mesma taxa aplicada nas outras exchanges do bot, pra qty líquida comparável

let binanceClockOffsetMs = 0;

/**
 * Conta as casas decimais de um tickSize/stepSize (ex.: 0.0001 -> 4). Pra valores pequenos
 * (< 1e-6, ex.: tickSize 0.00000001 de moedas tipo XECUSDT) o `String(step)` do JS vira
 * notação científica ("1e-8"), sem ponto decimal — o antigo `.split('.')[1]?.length ?? 0`
 * silenciosamente virava 0 casas, arredondando o preço pra "0" e gerando
 * `usdtAmount / 0 = Infinity` na quantidade (bug real visto em produção: "Erro na compra:
 * quantidade inválida para compra limite (Infinity)" na XECUSDT).
 *
 * NÃO usa `step.toFixed(20)` pra cobrir esse caso: valores comuns tipo 0.001 não são exatos
 * em binário, e `toFixed(20)` expõe o ruído de ponto flutuante (`(0.001).toFixed(20)` =
 * "0.00100000000000000002"), contando casas decimais erradas pro caso comum. Em vez disso,
 * interpreta a própria notação científica quando ela aparece (mantissa + expoente).
 */
function decimalsFromStep(step) {
  if (!(step > 0) || step >= 1) return 0;
  const str = String(step);
  const eIdx = str.indexOf('e');
  if (eIdx === -1) {
    const dot = str.indexOf('.');
    return dot === -1 ? 0 : str.length - dot - 1;
  }
  const exp = parseInt(str.slice(eIdx + 1), 10);
  const mantissa = str.slice(0, eIdx);
  const mantissaDecimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
  return Math.max(0, -exp + mantissaDecimals);
}

async function syncBinanceClock() {
  try {
    const res  = await fetch(`${BINANCE_BASE}/api/v3/time`);
    const data = await res.json();
    binanceClockOffsetMs = data.serverTime - Date.now();
  } catch (err) {
    console.error(`⚠️  syncBinanceClock falhou (offset continua em ${binanceClockOffsetMs}ms): ${err.message}`);
  }
}

function binanceSign(params, secretKey) {
  const qs  = new URLSearchParams(params).toString();
  const sig = crypto.createHmac('sha256', secretKey).update(qs).digest('hex');
  return `${qs}&signature=${sig}`;
}

async function binanceRequest(method, endpoint, params = {}) {
  const apiKey    = process.env.BINANCE_API_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY;
  const ts        = Date.now() + binanceClockOffsetMs;
  const signed    = binanceSign({ ...params, timestamp: ts, recvWindow: 10000 }, secretKey);
  const url       = method === 'GET' ? `${BINANCE_BASE}${endpoint}?${signed}` : `${BINANCE_BASE}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method !== 'GET' ? signed : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Binance ${method} ${endpoint} ${res.status}: ${data?.msg ?? text}`);
  return data;
}

async function binanceMarketBuy(symbol, usdtAmount) {
  const order     = await binanceRequest('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: usdtAmount.toFixed(2),
  });
  const filledQty = parseFloat(order.executedQty);
  const quoteQty  = parseFloat(order.cummulativeQuoteQty);
  return { filledQty: filledQty * (1 - GATE_FEE_RATE_EQUIV), quoteQty, avgPrice: quoteQty / filledQty };
}

/**
 * Compra LIMITE num preço exato (ex.: valor da lower1/vwap no vwap-bands-bot) — GTC com
 * timeout curto (`waitMs`, default 20s, sondando a cada `pollMs`, default 2s) em vez de IOC.
 *
 * Motivo da troca (ver conversa com o usuário — caso PYRUSDT): o sinal só é avaliado em
 * candle FECHADO (evaluatePullbackReady em strategyEngine.js), então quando o bot manda a
 * ordem o toque na banda já passou — com IOC, o preço quase sempre já voltou a subir no
 * instante exato do envio e a ordem morre sem preencher, mesmo o candle tendo tocado o nível
 * segundos/minutos antes. GTC deixa a ordem parada no book por alguns segundos, cobrindo
 * esse atraso entre "candle fechou e tocou o nível" e "ordem chegou na corretora" — se o
 * preço ainda estiver oscilando perto do nível (não só um pavio único), ela pega o fill.
 * Ainda cancela e desiste (`filled: false`, tenta de novo no próximo tick) se não encher
 * dentro do timeout, pra não deixar capital preso indefinidamente numa ordem parada longe
 * do preço.
 */
async function binanceLimitBuy(symbol, usdtAmount, price, opts = {}) {
  const waitMs = opts.waitMs ?? 20_000;
  const pollMs = opts.pollMs ?? 2_000;

  const handle = await binancePlaceRestingLimitBuy(symbol, usdtAmount, price);
  let order = await binanceRequest('GET', '/api/v3/order', { symbol, orderId: handle.orderId });

  const deadline = Date.now() + waitMs;
  while (order.status !== 'FILLED' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    order = await binanceRequest('GET', '/api/v3/order', { symbol, orderId: handle.orderId });
  }

  if (order.status !== 'FILLED') {
    try {
      await binanceRequest('DELETE', '/api/v3/order', { symbol, orderId: handle.orderId });
    } catch { /* já pode ter enchido ou sido cancelada sozinha entre o último poll e aqui */ }
    order = await binanceRequest('GET', '/api/v3/order', { symbol, orderId: handle.orderId });
  }

  const filledQty = parseFloat(order.executedQty);
  const quoteQty  = parseFloat(order.cummulativeQuoteQty);
  if (!(filledQty > 0)) return { filled: false };
  return {
    filled: true, filledQty: filledQty * (1 - GATE_FEE_RATE_EQUIV), quoteQty, avgPrice: quoteQty / filledQty,
  };
}

/** Resolve LOT_SIZE / PRICE_FILTER e arredonda preço+qty pra uma limit buy. */
async function binanceLimitBuySizing(symbol, usdtAmount, price) {
  const info        = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const filters     = info.symbols?.[0]?.filters ?? [];
  const priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER');
  const lotFilter   = filters.find(f => f.filterType === 'LOT_SIZE');
  const tickSize    = priceFilter ? parseFloat(priceFilter.tickSize) : 0.00000001;
  const stepSize    = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const priceDecimals = decimalsFromStep(tickSize);
  const qtyDecimals   = decimalsFromStep(stepSize);

  const safePrice = (Math.round(price / tickSize) * tickSize).toFixed(priceDecimals);
  const rawQty    = usdtAmount / parseFloat(safePrice);
  const safeQty   = (Math.floor(rawQty / stepSize) * stepSize).toFixed(qtyDecimals);
  if (!Number.isFinite(parseFloat(safeQty)) || parseFloat(safeQty) <= 0) {
    throw new Error(`quantidade inválida para compra limite (${safeQty})`);
  }
  return { safePrice, safeQty };
}

/**
 * Coloca LIMIT GTC e devolve na hora (sem esperar fill) — pra bots que deixam a ordem
 * resting no book por N candles até um reteste (ex.: bollinger-bands toque na banda
 * inferior + fill no candle seguinte).
 */
async function binancePlaceRestingLimitBuy(symbol, usdtAmount, price) {
  const { safePrice, safeQty } = await binanceLimitBuySizing(symbol, usdtAmount, price);
  const order = await binanceRequest('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'LIMIT', timeInForce: 'GTC', quantity: safeQty, price: safePrice,
  });
  return {
    exchange: 'binance',
    orderId: order.orderId,
    clientOrderId: order.clientOrderId ?? null,
    price: parseFloat(safePrice),
    qty: parseFloat(safeQty),
    status: order.status,
  };
}

async function binancePollRestingLimitBuy(symbol, handle) {
  const order = await binanceRequest('GET', '/api/v3/order', { symbol, orderId: handle.orderId });
  const filledQty = parseFloat(order.executedQty);
  const quoteQty  = parseFloat(order.cummulativeQuoteQty);
  if (order.status === 'FILLED' || (filledQty > 0 && (order.status === 'CANCELED' || order.status === 'EXPIRED'))) {
    if (!(filledQty > 0)) return { filled: false, status: order.status, open: false };
    return {
      filled: true,
      status: order.status,
      open: false,
      filledQty: filledQty * (1 - GATE_FEE_RATE_EQUIV),
      quoteQty,
      avgPrice: quoteQty / filledQty,
    };
  }
  if (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED') {
    return { filled: false, status: order.status, open: true, filledQty, quoteQty };
  }
  return { filled: false, status: order.status, open: false, filledQty, quoteQty };
}

async function binanceCancelRestingLimitBuy(symbol, handle) {
  try {
    await binanceRequest('DELETE', '/api/v3/order', { symbol, orderId: handle.orderId });
  } catch { /* já pode ter enchido/cancelado */ }
  return binancePollRestingLimitBuy(symbol, handle);
}

async function binanceMarketSell(symbol, qty) {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`quantidade inválida para venda (${qty})`);
  }
  const info      = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const decimals  = decimalsFromStep(stepSize);
  const safeQty   = (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
  if (!Number.isFinite(parseFloat(safeQty)) || parseFloat(safeQty) <= 0) {
    throw new Error(`quantidade inválida após arredondamento (${safeQty})`);
  }
  const order   = await binanceRequest('POST', '/api/v3/order', {
    symbol, side: 'SELL', type: 'MARKET', quantity: safeQty,
  });
  const soldQty = parseFloat(order.executedQty);
  const usdtOut = parseFloat(order.cummulativeQuoteQty);
  return { soldQty, usdtOut, exitPrice: usdtOut / soldQty };
}

async function binance24hVolume(symbol) {
  const data = await fetch(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${symbol}`).then(r => r.json());
  return parseFloat(data.quoteVolume || 0);
}

module.exports = {
  syncBinanceClock,
  binanceRequest,
  binanceMarketBuy,
  binanceLimitBuy,
  binancePlaceRestingLimitBuy,
  binancePollRestingLimitBuy,
  binanceCancelRestingLimitBuy,
  binanceMarketSell,
  binance24hVolume,
  decimalsFromStep,
};
