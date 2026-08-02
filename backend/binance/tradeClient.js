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
  } catch {}
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
 * Compra LIMITE (IOC) num preço exato (ex.: valor da lower1/vwap no vwap-bands-bot) — só
 * preenche se o mercado estiver naquele preço ou melhor no instante do envio; o que não
 * preencher é cancelado na hora pela própria IOC, sem ficar parado no book. Se não
 * preencher nada, devolve `{ filled: false }` em vez de lançar erro — quem chama decide se
 * tenta de novo no próximo tick (não é uma falha, só "ainda não chegou lá").
 */
async function binanceLimitBuy(symbol, usdtAmount, price) {
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

  const order = await binanceRequest('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'LIMIT', timeInForce: 'IOC', quantity: safeQty, price: safePrice,
  });
  const filledQty = parseFloat(order.executedQty);
  const quoteQty  = parseFloat(order.cummulativeQuoteQty);
  if (!(filledQty > 0)) return { filled: false };
  return {
    filled: true, filledQty: filledQty * (1 - GATE_FEE_RATE_EQUIV), quoteQty, avgPrice: quoteQty / filledQty,
  };
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
  binanceMarketSell,
  binance24hVolume,
  decimalsFromStep,
};
