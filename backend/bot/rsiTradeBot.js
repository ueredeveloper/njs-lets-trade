/**
 * RSI Trade Bot — Gate.io
 *
 * Estratégia por símbolo (candle 30m):
 *   COMPRA  → RSI < 30  E  variação do candle ≥ 1%
 *             Coloca limit order 2% abaixo do fechamento do candle
 *   VENDA   → RSI passou de 70 e voltou para ≤ 70 (market order)
 *
 * Estados: WATCHING → PENDING_BUY → BOUGHT → ABOVE_70 → WATCHING
 *
 * Estado salvo em disco: sobrevive a hibernação / reinício.
 * Lê os símbolos de backend/data/favorites-trade.json automaticamente.
 *
 * Uso:
 *   node backend/bot/rsiTradeBot.js           (usa TRADE_USDT_AMOUNT do .env ou 10 USDT)
 *   node backend/bot/rsiTradeBot.js 25        (25 USDT por operação)
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { toGateSymbol } = require('../utils/toGateSymbol');
const ti               = require('technicalindicators');
const {
  fetchBinanceCandles,
  fetchGateCandles,
  fetchBinanceCurrentPrice,
  fetchGateCurrentPrice,
} = require('./prices');

// ── Configuração ──────────────────────────────────────────────────────────────

const RSI_PERIOD     = 14;
const RSI_BUY        = 30;
const RSI_SELL       = 70;
const RSI_OVERBOUGHT = 80;           // venda imediata se RSI ≥ este valor (sem esperar retorno a 70)
const VARIATION_MIN  = 1;            // % variação mínima do candle (default para 30m+)

// Variação mínima padrão por intervalo: candles curtos têm amplitude menor.
// Para 1m não exigimos variação — o RSI já é o sinal; amplitude de 1m é pequena demais.
function defaultVariationMin(iv) {
  if (/^1m$/i.test(iv))  return 0;    // sem filtro de variação para 1m
  if (/^\d+m$/i.test(iv)) {
    const n = parseInt(iv);
    if (n <= 5)  return 0.1;
    if (n <= 15) return 0.3;
  }
  return VARIATION_MIN; // 1% para 30m+
}
// Desconto padrão na ordem de compra: 0.2% para todos os intervalos.
function defaultBuyDiscount(_iv) {
  return 0.002;
}
const SELL_DISCOUNT  = 0.002;        // limit sell 0.2% abaixo do close (garante fill)
const FEE_RATE       = 0.002;        // 0.2% taxa Gate.io (maker e taker)
const CANDLE_LIMIT   = 200;

const POLL_MIN_MS = 5 * 60_000; // teto de polling: 5 minutos

// Intervalo de polling: igual ao candle se < 15 min, senão 5 min fixo
function pollMsFor(iv) {
  const n = parseInt(iv, 10);
  let candleMs;
  if (iv.endsWith('m')) candleMs = n * 60_000;
  else if (iv.endsWith('h')) candleMs = n * 3_600_000;
  else if (iv.endsWith('d')) candleMs = n * 86_400_000;
  else if (iv.endsWith('w')) candleMs = n * 7 * 86_400_000;
  else candleMs = POLL_MIN_MS;
  return candleMs < POLL_MIN_MS ? candleMs : POLL_MIN_MS;
}

const API_KEY    = process.env.GATEIO_API_KEY;
const SECRET_KEY = process.env.GATEIO_SECRET_KEY;
const BASE_URL   = 'https://api.gateio.ws/api/v4';

const BINANCE_API_KEY    = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const BINANCE_BASE_URL   = 'https://api.binance.com';

const BOT_DATA_DIR   = path.join(__dirname, '../data/bot');

// ── Favoritos via Supabase ────────────────────────────────────────────────────

async function loadFavoritesTrade() {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.SUPABASE_DEFAULT_USER_ID;

  if (!sbUrl || !sbKey || !userId) {
    console.error('❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_DEFAULT_USER_ID não definidos no .env');
    process.exit(1);
  }

  const url = `${sbUrl}/rest/v1/favorites_trade?user_id=eq.${encodeURIComponent(userId)}&select=*&order=position.asc`;
  const res = await fetch(url, {
    headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` },
  });
  if (!res.ok) throw new Error(`Supabase favorites_trade: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map(r => ({
    symbol:       r.symbol,
    exchange:     r.exchange     ?? 'gate',
    interval:     r.interval     ?? '30m',
    rsiBuy:       Number(r.rsi_buy  ?? 30),
    rsiSell:      Number(r.rsi_sell ?? 70),
    sellInterval: r.sell_interval ?? null,
    ...(r.variation_min !== null && r.variation_min !== undefined
      ? { variationMin: Number(r.variation_min) } : {}),
  }));
}

// ── Sincronização de relógio com Gate.io ──────────────────────────────────────
// Windows pode ter o relógio desincronizado; offset corrije o timestamp nas assinaturas.
let clockOffsetSec = 0;

async function syncClock() {
  try {
    // /api/v4/spot/time retorna server_time em milissegundos
    const res  = await fetch(`${BASE_URL}/spot/time`);
    const data = await res.json();
    if (!data?.server_time) throw new Error(`campo server_time ausente: ${JSON.stringify(data)}`);
    const gateTimeSec = Math.floor(data.server_time / 1000);
    const offset = gateTimeSec - Math.floor(Date.now() / 1000);
    clockOffsetSec = offset;
    if (Math.abs(offset) > 2)
      console.log(`⏱️  Clock offset: ${offset > 0 ? '+' : ''}${offset}s — timestamp Gate.io ajustado`);
  } catch (err) {
    console.warn(`⚠️  syncClock falhou (${err.message}) — offset mantido em ${clockOffsetSec}s`);
  }
}

// ── Gate.io API autenticada ───────────────────────────────────────────────────

function gateSign(method, endpointPath, queryString, bodyStr) {
  const timestamp  = (Math.floor(Date.now() / 1000) + clockOffsetSec).toString();
  const hashedBody = crypto.createHash('sha512').update(bodyStr || '').digest('hex');
  const msg        = [method.toUpperCase(), `/api/v4${endpointPath}`, queryString, hashedBody, timestamp].join('\n');
  const sign       = crypto.createHmac('sha512', SECRET_KEY).update(msg).digest('hex');
  return { timestamp, sign };
}

async function gateReq(method, endpointPath, params = {}, _retry = true) {
  let url  = `${BASE_URL}${endpointPath}`;
  let qs   = '';
  let body = '';

  if (method === 'GET' || method === 'DELETE') {
    qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    body = JSON.stringify(params);
  }

  const { timestamp, sign } = gateSign(method, endpointPath, qs, body);

  const res = await fetch(url, {
    method,
    headers: { KEY: API_KEY, Timestamp: timestamp, SIGN: sign, 'Content-Type': 'application/json' },
    body: (method === 'POST' || method === 'PUT') ? body : undefined,
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = data?.message || data?.label || text;

    // Auto-corrige offset de relógio a partir do erro 403 da Gate.io e repete a requisição
    if (res.status === 403 && _retry) {
      const match = msg.match(/current_time:(\d+).*header\.timestamp:(\d+)/);
      if (match) {
        const serverTime = parseInt(match[1]);
        const sentTime   = parseInt(match[2]);
        // sentTime = localTime + prevOffset  →  localTime = sentTime - prevOffset
        clockOffsetSec = serverTime - (sentTime - clockOffsetSec);
        console.log(`⏱️  Clock auto-corrigido: offset=${clockOffsetSec > 0 ? '+' : ''}${clockOffsetSec}s — repetindo ${method} ${endpointPath}…`);
        return gateReq(method, endpointPath, params, false);
      }
    }

    throw new Error(`Gate ${method} ${endpointPath} ${res.status}: ${msg}`);
  }
  return data;
}

// ── Filtro 4h para entrada 30m ────────────────────────────────────────────────
// Antes de comprar no RSI 30m, verifica que nenhum RSI 4h dos últimos 2 dias
// (= 12 candles de 4h) esteve acima de 50. Garante entrada na perna de subida
// do RSI 4h, não na descida.

async function check4hRsiFilter(pair, adapter, log) {
  try {
    const candles4h = await adapter.fetchCandles(pair, 50, '4h');
    const closes4h  = candles4h.map(c => c.close);
    const rsi4h     = ti.RSI.calculate({ values: closes4h, period: RSI_PERIOD });
    if (rsi4h.length === 0) {
      log('⚠️  Filtro 4h: dados insuficientes — entrada bloqueada por precaução');
      return false;
    }
    const recent = rsi4h.slice(-12); // 12 candles × 4h = 2 dias
    const maxRsi = Math.max(...recent);
    if (maxRsi <= 50) {
      log(`🔍 Filtro 4h (2d): RSI máx=${maxRsi.toFixed(2)} ≤ 50 — ✅ tendência crescente no 4h`);
      return true;
    }
    log(`🔍 Filtro 4h (2d): RSI máx=${maxRsi.toFixed(2)} > 50 — ❌ RSI 4h elevado recentemente, entrada bloqueada`);
    return false;
  } catch (err) {
    log(`⚠️  Filtro 4h: erro (${err.message}) — entrada bloqueada por precaução`);
    return false;
  }
}

// Verifica RSI de 1m para gatilho de venda rápida quando RSI ≥ 80.
// Retorna { triggers: bool, rsi: number|null }
async function check1mRsiSell(pair, adapter) {
  try {
    const candles = await adapter.fetchCandles(pair, 50, '1m');
    const rsi1m   = ti.RSI.calculate({ values: candles.map(c => c.close), period: RSI_PERIOD });
    if (!rsi1m.length) return { triggers: false, rsi: null };
    const current = rsi1m[rsi1m.length - 1];
    return { triggers: current >= 80, rsi: current };
  } catch {
    return { triggers: false, rsi: null };
  }
}

// ── Filtro MA50 1h — distância máxima de 5% do preço atual ───────────────────
// Se o preço estiver mais de 3% acima ou abaixo da MA50(1h), a entrada é bloqueada.
// Indica que o preço está muito distante de seu equilíbrio de médio prazo.

async function checkMa50Filter(pair, adapter, log, currentPrice) {
  try {
    const candles1h = await adapter.fetchCandles(pair, 100, '1h');
    const closes1h  = candles1h.map(c => c.close);
    const ma50Vals  = ti.SMA.calculate({ values: closes1h, period: 50 });
    if (ma50Vals.length === 0) {
      log('⚠️  Filtro MA50(1h): dados insuficientes — entrada bloqueada por precaução');
      return { ok: false, ma50: null };
    }
    const ma50 = ma50Vals[ma50Vals.length - 1];
    const dist = Math.abs(currentPrice - ma50) / ma50 * 100;
    if (dist > 3) {
      const dir = currentPrice > ma50 ? 'acima' : 'abaixo';
      log(`🔍 Filtro MA50(1h): preço=${currentPrice.toFixed(4)} ${dir} de MA50=${ma50.toFixed(4)} por ${dist.toFixed(1)}% > 3% — ❌ entrada bloqueada`);
      return { ok: false, ma50 };
    }
    log(`🔍 Filtro MA50(1h): preço=${currentPrice.toFixed(4)} a ${dist.toFixed(1)}% da MA50=${ma50.toFixed(4)} — ✅ dentro do limite`);
    return { ok: true, ma50 };
  } catch (err) {
    log(`⚠️  Filtro MA50(1h): erro (${err.message}) — entrada bloqueada por precaução`);
    return { ok: false, ma50: null };
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

// Usado nos arquivos de estado (timestamp completo)
function now() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(',', '');
}

// Timestamp curto para o terminal: HH:MM (ou HH:MM:SS se intervalo em minutos)
function nowFmt(withSeconds = false) {
  const opts = { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' };
  if (withSeconds) opts.second = '2-digit';
  return new Date().toLocaleTimeString('pt-BR', opts);
}

// Cores ANSI para o terminal (não são escritas no arquivo de log)
const R = '\x1b[31m'; // vermelho — RSI > 70
const G = '\x1b[32m'; // verde   — RSI < 30
const X = '\x1b[0m';  // reset

// Paleta de cores por símbolo (rotativa)
const SYMBOL_COLORS = [
  '\x1b[94m', // azul brilhante
  '\x1b[93m', // amarelo brilhante
  '\x1b[95m', // magenta brilhante
  '\x1b[96m', // ciano brilhante
  '\x1b[92m', // verde brilhante
  '\x1b[91m', // vermelho brilhante
  '\x1b[33m', // amarelo
  '\x1b[35m', // magenta
  '\x1b[36m', // ciano
  '\x1b[34m', // azul
];

function makeLogger(symbol, symbolColor = '', interval = '30m') {
  const logFile    = path.join(BOT_DATA_DIR, `log-${symbol}.txt`);
  const isMinutes  = /^\d+m$/.test(interval); // '1m', '3m', '5m', etc.
  const symTag     = `${symbolColor}[${symbol}]${X}`;
  return function log(...args) {
    const ts      = nowFmt(isMinutes);
    const plain   = `[${ts}] ${symTag} ${args.join(' ')}`;
    const noAnsi  = plain.replace(/\x1b\[[0-9;]*m/g, '');
    console.log(plain);
    try { fs.appendFileSync(logFile, noAnsi + '\n'); } catch {}
  };
}

// ── Estado por símbolo ────────────────────────────────────────────────────────
//
// phase: 'WATCHING' | 'PENDING_BUY' | 'BOUGHT' | 'ABOVE_70'
//
// PENDING_BUY → limit order colocada, aguardando fill
//   pendingOrderId  : ID da ordem Gate.io
//   pendingPrice    : preço da limit order
//   pendingQty      : qty solicitada
//
// BOUGHT → ordem preenchida, aguardando RSI > 70
//   buyPrice / buyQty / buyUsdt / buyTime

function stateFile(symbol) { return path.join(BOT_DATA_DIR, `state-${symbol}.json`); }

function loadState(symbol) {
  try { return JSON.parse(fs.readFileSync(stateFile(symbol), 'utf8')); }
  catch { return { phase: 'WATCHING' }; }
}

function saveState(symbol, state) {
  fs.writeFileSync(stateFile(symbol), JSON.stringify(state, null, 2));
}

// ── Ordens ────────────────────────────────────────────────────────────────────

async function getGateUsdtBalance() {
  const accounts = await gateReq('GET', '/spot/accounts');
  const usdt = accounts.find(a => a.currency === 'USDT');
  return usdt ? parseFloat(usdt.available) : 0;
}

async function getGateTokenBalance(baseCurrency) {
  const accounts = await gateReq('GET', '/spot/accounts');
  const acc = accounts.find(a => a.currency === baseCurrency);
  return acc ? parseFloat(acc.available) : 0;
}

const MAX_USDT_PER_COIN  = 40;  // teto por moeda
const MIN_HOLDING_USDT   = 3;   // saldo mínimo em USDT para considerar "posição aberta"

async function placeGateLimitBuy(pair, closePrice, log, buyDiscount = 0.01) {
  const balance    = await getGateUsdtBalance();
  const budget     = Math.min(balance * 0.99, MAX_USDT_PER_COIN);
  if (budget < 0.5) { log('⚠️  Saldo USDT insuficiente (menos de $0.50).'); return null; }
  log(`💰 Saldo USDT: ${balance.toFixed(2)} → usando ${budget.toFixed(2)} USDT (teto: $${MAX_USDT_PER_COIN})`);

  const limitPrice = parseFloat((closePrice * (1 - buyDiscount)).toFixed(8));
  const qty        = parseFloat((budget / limitPrice).toFixed(8));

  const order = await gateReq('POST', '/spot/orders', {
    currency_pair: pair,
    side:          'buy',
    type:          'limit',
    price:         String(limitPrice),
    amount:        String(qty),
    time_in_force: 'gtc',
  });

  return { orderId: order.id, limitPrice, qty, budget };
}

async function getOpenGateOrders(pair) {
  const orders = await gateReq('GET', '/spot/orders', { currency_pair: pair, status: 'open' });
  return Array.isArray(orders) ? orders : [];
}

async function checkGateOrder(orderId, pair) {
  return gateReq('GET', `/spot/orders/${orderId}`, { currency_pair: pair });
}

async function cancelGateOrder(orderId, pair, log) {
  try {
    await gateReq('DELETE', `/spot/orders/${orderId}`, { currency_pair: pair });
    log(`🚫 Limit order cancelada (id=${orderId})`);
  } catch (err) {
    log(`⚠️  Não foi possível cancelar ${orderId}: ${err.message}`);
  }
}

async function placeGateLimitSell(pair, qty, closePrice) {
  const sellPrice = parseFloat((closePrice * (1 - SELL_DISCOUNT)).toFixed(8));
  return gateReq('POST', '/spot/orders', {
    currency_pair: pair,
    side:          'sell',
    type:          'limit',
    price:         String(sellPrice),
    amount:        String(parseFloat(qty).toFixed(8)),
    time_in_force: 'gtc',
  });
}

// ── Binance API autenticada ───────────────────────────────────────────────────

let binanceClockOffsetMs = 0;

async function syncBinanceClock() {
  try {
    const res  = await fetch(`${BINANCE_BASE_URL}/api/v3/time`);
    const data = await res.json();
    binanceClockOffsetMs = data.serverTime - Date.now();
    if (Math.abs(binanceClockOffsetMs) > 2000)
      console.log(`⏱️  Binance clock offset: ${binanceClockOffsetMs > 0 ? '+' : ''}${Math.round(binanceClockOffsetMs / 1000)}s — timestamp ajustado`);
  } catch (err) {
    console.warn(`⚠️  syncBinanceClock falhou (${err.message}) — offset mantido em ${binanceClockOffsetMs}ms`);
  }
}

function binanceSign(params) {
  const qs  = new URLSearchParams(params).toString();
  const sig = crypto.createHmac('sha256', BINANCE_SECRET_KEY).update(qs).digest('hex');
  return `${qs}&signature=${sig}`;
}

async function binanceReq(method, endpointPath, params = {}) {
  const signed = binanceSign({ ...params, timestamp: Date.now() + binanceClockOffsetMs, recvWindow: 10000 });
  let url  = `${BINANCE_BASE_URL}${endpointPath}`;
  let body;
  if (method === 'GET' || method === 'DELETE') {
    url += `?${signed}`;
  } else {
    body = signed;
  }
  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': BINANCE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Binance ${method} ${endpointPath} ${res.status}: ${data?.msg || text}`);
  return data;
}

async function getBinanceUsdtBalance() {
  const account = await binanceReq('GET', '/api/v3/account');
  const usdt = account.balances.find(b => b.asset === 'USDT');
  return usdt ? parseFloat(usdt.free) : 0;
}

async function getBinanceTokenBalance(baseCurrency) {
  const account = await binanceReq('GET', '/api/v3/account');
  const asset = account.balances.find(b => b.asset === baseCurrency);
  return asset ? parseFloat(asset.free) : 0;
}

async function placeBinanceLimitBuy(pair, closePrice, log, buyDiscount = 0.01) {
  const balance = await getBinanceUsdtBalance();
  const budget  = Math.min(balance * 0.99, MAX_USDT_PER_COIN);
  if (budget < 0.5) { log('⚠️  Saldo USDT insuficiente (menos de $0.50).'); return null; }
  log(`💰 Saldo USDT: ${balance.toFixed(2)} → usando ${budget.toFixed(2)} USDT (teto: $${MAX_USDT_PER_COIN})`);

  // Busca filtros de precisão do par para não rejeitar a ordem
  const exInfo  = await fetch(`${BINANCE_BASE_URL}/api/v3/exchangeInfo?symbol=${pair}`).then(r => r.json());
  const filters = exInfo.symbols?.[0]?.filters ?? [];
  const lotFilter   = filters.find(f => f.filterType === 'LOT_SIZE');
  const priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER');

  const stepSize  = lotFilter   ? parseFloat(lotFilter.stepSize)   : 1e-8;
  const tickSize  = priceFilter ? parseFloat(priceFilter.tickSize) : 1e-8;
  const decimalsP = tickSize  < 1 ? String(tickSize).split('.')[1]?.length  ?? 8 : 0;
  const decimalsQ = stepSize  < 1 ? String(stepSize).split('.')[1]?.length  ?? 8 : 0;

  const limitPrice = parseFloat((Math.floor(closePrice * (1 - buyDiscount) / tickSize) * tickSize).toFixed(decimalsP));
  const qty        = parseFloat((Math.floor(budget / limitPrice / stepSize) * stepSize).toFixed(decimalsQ));

  const order = await binanceReq('POST', '/api/v3/order', {
    symbol:      pair,
    side:        'BUY',
    type:        'LIMIT',
    timeInForce: 'GTC',
    price:       String(limitPrice),
    quantity:    String(qty),
  });
  return { orderId: order.orderId, limitPrice, qty, budget };
}

function normalizeBinanceOrder(order) {
  const statusMap = { NEW: 'open', PARTIALLY_FILLED: 'open', FILLED: 'closed', CANCELED: 'cancelled', EXPIRED: 'cancelled', REJECTED: 'cancelled' };
  const execQty  = parseFloat(order.executedQty || 0);
  const quoteQty = parseFloat(order.cummulativeQuoteQty || 0);
  return {
    ...order,
    status:         statusMap[order.status] ?? 'open',
    amount:         order.origQty,
    left:           String(parseFloat(order.origQty) - execQty),
    avg_deal_price: execQty > 0 ? String(quoteQty / execQty) : order.price,
  };
}

async function getOpenBinanceOrders(pair) {
  const orders = await binanceReq('GET', '/api/v3/openOrders', { symbol: pair });
  return Array.isArray(orders) ? orders : [];
}

async function checkBinanceOrder(orderId, pair) {
  const order = await binanceReq('GET', '/api/v3/order', { symbol: pair, orderId });
  return normalizeBinanceOrder(order);
}

async function cancelBinanceOrder(orderId, pair, log) {
  try {
    await binanceReq('DELETE', '/api/v3/order', { symbol: pair, orderId });
    log(`🚫 Limit order cancelada (id=${orderId})`);
  } catch (err) {
    log(`⚠️  Não foi possível cancelar ${orderId}: ${err.message}`);
  }
}

async function placeBinanceLimitSell(pair, qty, closePrice) {
  const exInfo  = await fetch(`${BINANCE_BASE_URL}/api/v3/exchangeInfo?symbol=${pair}`).then(r => r.json());
  const filters = exInfo.symbols?.[0]?.filters ?? [];
  const lotFilter   = filters.find(f => f.filterType === 'LOT_SIZE');
  const priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER');
  const stepSize  = lotFilter   ? parseFloat(lotFilter.stepSize)   : 1e-8;
  const tickSize  = priceFilter ? parseFloat(priceFilter.tickSize) : 1e-8;
  const decimalsP = tickSize < 1 ? String(tickSize).split('.')[1]?.length  ?? 8 : 0;
  const decimalsQ = stepSize < 1 ? String(stepSize).split('.')[1]?.length  ?? 8 : 0;

  const sellPrice = parseFloat((Math.floor(closePrice * (1 - SELL_DISCOUNT) / tickSize) * tickSize).toFixed(decimalsP));
  const sellQty   = parseFloat((Math.floor(parseFloat(qty) / stepSize) * stepSize).toFixed(decimalsQ));

  const order = await binanceReq('POST', '/api/v3/order', {
    symbol:      pair,
    side:        'SELL',
    type:        'LIMIT',
    timeInForce: 'GTC',
    price:       String(sellPrice),
    quantity:    String(sellQty),
  });
  // Normaliza para o mesmo contrato do Gate.io: expõe .id
  return { ...order, id: order.orderId };
}

// ── Exchange adapters ─────────────────────────────────────────────────────────
// Interface comum para Gate.io e Binance. Cada adapter expõe os mesmos métodos
// para que tick() seja agnóstico de exchange.

function createGateAdapter() {
  return {
    name:            'Gate.io',
    toPair:          (symbol)              => toGateSymbol(symbol),
    baseCurrency:    (pair)                => pair.split('_')[0],
    fetchCandles:    (pair, lim, iv)       => fetchGateCandles(pair, lim, iv),
    getCurrentPrice: (pair)               => fetchGateCurrentPrice(pair),
    getUsdtBalance:  ()                    => getGateUsdtBalance(),
    getTokenBalance: (base)                => getGateTokenBalance(base),
    getOpenOrders:   (pair)                => getOpenGateOrders(pair),
    placeLimitBuy:   (pair, price, log, d)  => placeGateLimitBuy(pair, price, log, d),
    checkOrder:      (id, pair)            => checkGateOrder(id, pair),
    cancelOrder:     (id, pair, log)       => cancelGateOrder(id, pair, log),
    placeLimitSell:  (pair, qty, price)    => placeGateLimitSell(pair, qty, price),
  };
}

function createBinanceAdapter() {
  return {
    name:            'Binance',
    toPair:          (symbol)              => symbol,
    baseCurrency:    (pair)                => pair.endsWith('USDT') ? pair.slice(0, -4) : pair.slice(0, -3),
    fetchCandles:    (pair, lim, iv)       => fetchBinanceCandles(pair, lim, iv),
    getCurrentPrice: (pair)               => fetchBinanceCurrentPrice(pair),
    getUsdtBalance:  ()                    => getBinanceUsdtBalance(),
    getTokenBalance: (base)                => getBinanceTokenBalance(base),
    getOpenOrders:   (pair)                => getOpenBinanceOrders(pair),
    placeLimitBuy:   (pair, price, log, d)  => placeBinanceLimitBuy(pair, price, log, d),
    checkOrder:      (id, pair)            => checkBinanceOrder(id, pair),
    cancelOrder:     (id, pair, log)       => cancelBinanceOrder(id, pair, log),
    placeLimitSell:  (pair, qty, price)    => placeBinanceLimitSell(pair, qty, price),
  };
}

function createAdapter(exchange) {
  if (exchange === 'binance') return createBinanceAdapter();
  return createGateAdapter();
}

// ── Rastreamento de cruzamento RSI (por símbolo + intervalo) ──────────────────
// Guarda se o RSI estava acima do nível de compra no tick anterior.
// Permite logar apenas a entrada na zona de sobrevenda, não cada tick.
const rsiWasAbove = new Map(); // chave: "SYMBOL:interval"

// ── Tick principal ────────────────────────────────────────────────────────────

async function tick(symbol, pair, log, config, adapter) {
  const { rsiBuy = RSI_BUY, rsiSell = RSI_SELL, interval = '30m', sellInterval, exchange = 'gate' } = config;
  const effectiveSellInterval = sellInterval || interval;
  const separateSellInterval  = effectiveSellInterval !== interval;

  const variationMin   = config.variationMin   !== undefined ? config.variationMin   : defaultVariationMin(interval);
  const buyDiscount    = config.buyDiscount    !== undefined ? config.buyDiscount    : defaultBuyDiscount(interval);
  const rsiOverbought  = config.rsiOverbought  !== undefined ? config.rsiOverbought  : RSI_OVERBOUGHT;

  // Candles de entrada (sinal de compra)
  const candles = await adapter.fetchCandles(pair, CANDLE_LIMIT, interval);
  const closes  = candles.map(c => c.close);
  const rsiVals = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  if (rsiVals.length < 2) { log('RSI insuficiente — aguardando candles.'); return; }

  // Candles de saída (sinal de venda) — busca separada só quando intervalo difere
  let rsiExitVals;
  if (separateSellInterval) {
    const sellCandles = await adapter.fetchCandles(pair, CANDLE_LIMIT, effectiveSellInterval);
    const sellCloses  = sellCandles.map(c => c.close);
    rsiExitVals = ti.RSI.calculate({ values: sellCloses, period: RSI_PERIOD });
    if (rsiExitVals.length < 2) { log('RSI saída insuficiente — aguardando candles.'); return; }
  } else {
    rsiExitVals = rsiVals;
  }

  const rsi     = rsiVals[rsiVals.length - 1];
  const rsiExit = rsiExitVals[rsiExitVals.length - 1];
  const last    = candles[candles.length - 1];
  const variation = ((last.high - last.low) / last.low) * 100;

  // Detecta cruzamento: RSI entrou na zona de sobrevenda neste tick
  const alertKey    = `${symbol}:${interval}`;
  const wasAboveBuy = rsiWasAbove.get(alertKey) !== false; // default true (desconhecido = assume acima)
  rsiWasAbove.set(alertKey, rsi >= rsiBuy);
  if (rsi < rsiBuy && wasAboveBuy) {
    log(`🔔 RSI entrou em sobrevenda: ${rsi.toFixed(2)} < ${rsiBuy}  |  intervalo=${interval}  |  close=${last.close}  |  var=${variation.toFixed(2)}%`);
  }

  let state = loadState(symbol);
  if (separateSellInterval) {
    const buyColor  = rsi     < rsiBuy  ? G : '';
    const sellColor = rsiExit > rsiSell ? R : '';
    log(`${buyColor}RSI_entrada=${rsi.toFixed(2)}(${interval})${buyColor ? X : ''}  ${sellColor}RSI_saída=${rsiExit.toFixed(2)}(${effectiveSellInterval})${sellColor ? X : ''}  close=${last.close}  var=${variation.toFixed(2)}%  fase=${state.phase}`);
  } else {
    const rsiColor = rsi > rsiSell ? R : rsi < rsiBuy ? G : '';
    log(`${rsiColor}RSI=${rsi.toFixed(2)}${rsiColor ? X : ''}  close=${last.close}  var=${variation.toFixed(2)}%  fase=${state.phase}`);
  }

  // ── Executa ordem de venda e retorna o novo estado PENDING_SELL ──────────
  async function executeSell(reason) {
    try {
      const livePrice = await adapter.getCurrentPrice(pair);
      const sellPrice = parseFloat((livePrice * (1 - SELL_DISCOUNT)).toFixed(8));
      const sellOrder = await adapter.placeLimitSell(pair, state.buyQty, livePrice);
      const grossUsdt = sellPrice * state.buyQty;
      const netUsdt   = grossUsdt * (1 - FEE_RATE);
      const usdtPnl   = (netUsdt - state.buyUsdt).toFixed(4);
      const pnl       = ((netUsdt - state.buyUsdt) / state.buyUsdt * 100).toFixed(2);
      const pnlSign   = Number(usdtPnl) >= 0 ? '+' : '';
      log(`${'─'.repeat(60)}`);
      log(`${R}🔴 ORDEM DE VENDA ABERTA${X}`);
      log(`   Par      : ${pair}`);
      log(`   Motivo   : ${reason}`);
      log(`   Preço    : ${sellPrice}  (${SELL_DISCOUNT * 100}% abaixo de ${livePrice} — preço live)`);
      log(`   Qty      : ${state.buyQty}`);
      log(`   Rec. líq.: ≈${netUsdt.toFixed(2)} USDT`);
      log(`   PnL      : ${pnlSign}${usdtPnl} USDT  (${pnlSign}${pnl}%)${state.detected ? '  [posição detectada externamente]' : ''}`);
      log(`   Comprado : ${state.buyTime}`);
      log(`   ID       : ${sellOrder?.id ?? 'n/a'}`);
      log(`${'─'.repeat(60)}`);
      return {
        phase:         'PENDING_SELL',
        exchange:      state.exchange ?? exchange,
        sellOrderId:   sellOrder?.id,
        sellPrice,
        sellQty:       state.buyQty,
        buyUsdt:       state.buyUsdt,
        buyTime:       state.buyTime,
        detected:      state.detected,
        estimatedUsdt: netUsdt,
      };
    } catch (err) {
      log(`❌ Erro ao vender: ${err.message}`);
      return null;
    }
  }

  // ── Verifica saldo real em BOUGHT/ABOVE_70 — limpa estado se vendido externamente ──
  if (state.phase === 'BOUGHT' || state.phase === 'ABOVE_70') {
    const baseCurrency = adapter.baseCurrency(pair);
    const tokenBalance = await adapter.getTokenBalance(baseCurrency);
    const holdingUsdt  = tokenBalance * last.close;
    if (holdingUsdt < MIN_HOLDING_USDT) {
      state = { phase: 'WATCHING', exchange };
      saveState(symbol, state);
      log(`✅ Saldo ${baseCurrency} ≈ $${holdingUsdt.toFixed(2)} < $${MIN_HOLDING_USDT} — posição encerrada externamente, voltando a WATCHING`);
      return;
    }
  }

  // ── WATCHING: aguarda sinal de compra ──────────────────────────────────────
  if (state.phase === 'WATCHING') {
    // Verifica saldo real do token em QUALQUER situação (não só quando RSI < 30)
    // Se há posição aberta (compra manual ou de sessão anterior), inicia monitoramento para venda
    const baseCurrency = adapter.baseCurrency(pair);
    const tokenBalance = await adapter.getTokenBalance(baseCurrency);
    const holdingUsdt  = tokenBalance * last.close;
    if (holdingUsdt >= MIN_HOLDING_USDT) {
      state = {
        phase:    'BOUGHT',
        exchange,
        buyPrice: last.close,
        buyQty:   tokenBalance * (1 - FEE_RATE), // aproximação líquida
        buyUsdt:  holdingUsdt,
        buyTime:  now(),
        detected: true, // posição detectada externamente, não comprada pelo bot
      };
      saveState(symbol, state);
      log(`📦 Posição detectada: ${tokenBalance.toFixed(4)} ${baseCurrency} ≈ $${holdingUsdt.toFixed(2)} USDT — monitorando para venda.`);
      // Se RSI já está acima do nível de ABOVE_70, avança direto para esse estado
      const alreadyAbove = separateSellInterval ? rsi > 70 : rsiExit > rsiSell;
      if (alreadyAbove) {
        state.phase = 'ABOVE_70';
        saveState(symbol, state);
        if (separateSellInterval) {
          log(`${R}📈 RSI(${interval}) já acima de 70 (${rsi.toFixed(2)}) — aguardando retorno para ≤ 70…${X}`);
        } else {
          log(`${R}📈 RSI saída já acima de ${rsiSell} (${rsiExit.toFixed(2)}) — aguardando retorno para ≤ ${rsiSell}…${X}`);
        }
      }
      return;
    }

    if (rsi < rsiBuy && variation >= variationMin) {
      log(`${G}📍 RSI < ${rsiBuy} (${rsi.toFixed(2)}) + var ${variation.toFixed(2)}%${variationMin > 0 ? ` ≥ ${variationMin}%` : ''}${X}`);

      const { ok: passesMa50, ma50: ma50Value } = await checkMa50Filter(pair, adapter, log, last.close);
      if (!passesMa50) return;

      if (interval === '30m') {
        const passes = await check4hRsiFilter(pair, adapter, log);
        if (!passes) return;
      }

      log(`${G}✅ Sinal de COMPRA confirmado${X}`);
      try {
        const openOrders = await adapter.getOpenOrders(pair);
        if (openOrders.length > 0) {
          log(`⚠️  Já existe(m) ${openOrders.length} ordem(ns) aberta(s) para ${pair} — entrada bloqueada para evitar duplicata.`);
          return;
        }
        const result = await adapter.placeLimitBuy(pair, last.close, log, buyDiscount);
        if (result) {
          state = {
            phase:          'PENDING_BUY',
            pendingOrderId: result.orderId,
            pendingPrice:   result.limitPrice,
            pendingQty:     result.qty,
            pendingBudget:  result.budget,
            pendingTime:    now(),
          };
          saveState(symbol, state);
          log(`${'─'.repeat(60)}`);
          log(`${G}🟢 ORDEM DE COMPRA ABERTA${X}`);
          log(`   Par      : ${pair}`);
          log(`   Preço    : ${result.limitPrice}  (${buyDiscount * 100}% abaixo de ${last.close})`);
          log(`   MA50(1h) : ${ma50Value !== null ? ma50Value.toFixed(4) : 'n/a'}`);
          log(`   Qty      : ${result.qty}`);
          log(`   USDT     : ≈${result.budget.toFixed(2)}`);
          log(`   ID       : ${result.orderId}`);
          log(`${'─'.repeat(60)}`);
        }
      } catch (err) {
        log(`❌ Erro ao colocar limit order: ${err.message}`);
      }
    } else if (rsi < rsiBuy && variationMin > 0) {
      log(`${G}⚠️  RSI < ${rsiBuy} (${rsi.toFixed(2)}) mas var=${variation.toFixed(2)}% < ${variationMin}% — aguardando candle com mais amplitude${X}`);
    }

  // ── PENDING_BUY: verifica se a ordem foi preenchida ────────────────────────
  } else if (state.phase === 'PENDING_BUY') {
    try {
      const order = await adapter.checkOrder(state.pendingOrderId, pair);
      const status = order.status; // 'open' | 'closed' | 'cancelled'

      if (status === 'closed') {
        // Ordem preenchida — calcula qty real (amount - left) e desconta taxa de compra
        const filledQty   = parseFloat(order.amount) - parseFloat(order.left || 0);
        const netQty      = parseFloat((filledQty * (1 - FEE_RATE)).toFixed(8)); // tokens reais após 0.2% de taxa
        const filledPrice = parseFloat(order.avg_deal_price || order.price || state.pendingPrice);
        state = {
          phase:    'BOUGHT',
          exchange,
          buyPrice: filledPrice,
          buyQty:   netQty,                      // quantidade disponível para venda (já sem a taxa)
          buyUsdt:  netQty * filledPrice,
          buyTime:  now(),
        };
        saveState(symbol, state);
        log(`🟢 COMPRA PREENCHIDA | qty=${filledQty} − taxa 0.2% = ${netQty} | preço=${filledPrice} | USDT≈${state.buyUsdt.toFixed(2)} | ${state.buyTime}`);

      } else if (status === 'cancelled') {
        log(`${'─'.repeat(60)}`);
        log(`🚫 COMPRA CANCELADA (externamente)`);
        log(`   Par    : ${pair}`);
        log(`   ID     : ${state.pendingOrderId}`);
        log(`   Preço  : ${state.pendingPrice}`);
        log(`${'─'.repeat(60)}`);
        state = { phase: 'WATCHING' };
        saveState(symbol, state);

      } else {
        // 'open': ordem ainda pendente
        // Cancela se RSI de saída atingiu o nível de venda (oportunidade de compra passou)
        if (rsiExit >= rsiSell) {
          await adapter.cancelOrder(state.pendingOrderId, pair, log);
          log(`${'─'.repeat(60)}`);
          log(`🚫 COMPRA CANCELADA — RSI(${effectiveSellInterval}) atingiu ${rsiExit.toFixed(2)} ≥ ${rsiSell}`);
          log(`   Par    : ${pair}`);
          log(`   ID     : ${state.pendingOrderId}`);
          log(`   Preço  : ${state.pendingPrice}`);
          log(`${'─'.repeat(60)}`);
          state = { phase: 'WATCHING' };
          saveState(symbol, state);
        } else {
          log(`⏳ Limit order aberta (id=${state.pendingOrderId}) | preço alvo=${state.pendingPrice} | RSI=${rsi.toFixed(2)} | aguardando fill…`);
        }
      }
    } catch (err) {
      if (err.message.includes('404')) {
        log(`${'─'.repeat(60)}`);
        log(`🚫 COMPRA CANCELADA — ordem ${state.pendingOrderId} não encontrada na exchange (404)`);
        log(`   Par    : ${pair}`);
        log(`   ID     : ${state.pendingOrderId}`);
        log(`${'─'.repeat(60)}`);
        state = { phase: 'WATCHING' };
        saveState(symbol, state);
      } else {
        log(`❌ Erro ao verificar order ${state.pendingOrderId}: ${err.message}`);
      }
    }

  // ── BOUGHT: aguarda RSI cruzar acima de rsiSell ou atingir rsiOverbought ──
  } else if (state.phase === 'BOUGHT') {
    if (state.buyPrice && last.close <= state.buyPrice * 0.95) {
      const drop = ((last.close - state.buyPrice) / state.buyPrice * 100).toFixed(2);
      log(`${R}🛑 STOP-LOSS: preço=${last.close} caiu ${drop}% abaixo da compra=${state.buyPrice} — venda imediata${X}`);
      const newState = await executeSell(`stop-loss: preço ${drop}% abaixo da compra (${state.buyPrice})`);
      if (newState) { state = newState; saveState(symbol, state); }
    } else if (separateSellInterval) {
      // Modo dual-intervalo:
      //   saída rápida: RSI(sellInterval) ≥ rsiSell → vende imediatamente (ex: RSI 1m ≥ 80)
      //   saída lenta : RSI(interval)    > 70       → ABOVE_70, aguarda RSI(interval) ≤ 70
      if (rsiExit >= rsiSell) {
        log(`${R}🚀 RSI(${effectiveSellInterval})=${rsiExit.toFixed(2)} ≥ ${rsiSell} — venda imediata${X}`);
        const newState = await executeSell(`RSI(${effectiveSellInterval}) ${rsiExit.toFixed(2)} ≥ ${rsiSell}`);
        if (newState) { state = newState; saveState(symbol, state); }
      } else if (rsi > 70) {
        state.phase = 'ABOVE_70';
        saveState(symbol, state);
        log(`📈 RSI(${interval})=${rsi.toFixed(2)} > 70 — aguardando retorno para ≤ 70 ou RSI(${effectiveSellInterval}) ≥ ${rsiSell}…`);
      }
    } else {
      // Modo single-intervalo
      if (rsiExit >= rsiOverbought) {
        log(`${R}🚀 RSI sobrecomprado extremo: ${rsiExit.toFixed(2)} ≥ ${rsiOverbought} — venda imediata${X}`);
        const newState = await executeSell(`RSI(${effectiveSellInterval}) ${rsiExit.toFixed(2)} ≥ ${rsiOverbought} (sobrecomprado extremo)`);
        if (newState) { state = newState; saveState(symbol, state); }
      } else if (rsiExit > rsiSell) {
        if (interval !== '1m') {
          const { triggers: sell1m, rsi: rsi1m } = await check1mRsiSell(pair, adapter);
          if (sell1m) {
            log(`${R}📈 RSI(${effectiveSellInterval})=${rsiExit.toFixed(2)} > ${rsiSell} + RSI(1m)=${rsi1m.toFixed(2)} ≥ 80 — venda imediata${X}`);
            const newState = await executeSell(`RSI(${effectiveSellInterval}) ${rsiExit.toFixed(2)} > ${rsiSell} + RSI(1m) ${rsi1m.toFixed(2)} ≥ 80`);
            if (newState) { state = newState; saveState(symbol, state); }
            return;
          }
        }
        state.phase = 'ABOVE_70';
        saveState(symbol, state);
        log(`📈 RSI saída passou de ${rsiSell} (${rsiExit.toFixed(2)}) — aguardando retorno para ≤ ${rsiSell} ou ≥ ${rsiOverbought}…`);
      }
    }

  // ── ABOVE_70: vende quando RSI retorna a ≤ rsiSell OU atinge rsiOverbought
  } else if (state.phase === 'ABOVE_70') {
    if (state.buyPrice && last.close <= state.buyPrice * 0.95) {
      const drop = ((last.close - state.buyPrice) / state.buyPrice * 100).toFixed(2);
      log(`${R}🛑 STOP-LOSS: preço=${last.close} caiu ${drop}% abaixo da compra=${state.buyPrice} — venda imediata${X}`);
      const newState = await executeSell(`stop-loss: preço ${drop}% abaixo da compra (${state.buyPrice})`);
      if (newState) { state = newState; saveState(symbol, state); }
    } else if (separateSellInterval) {
      // Modo dual-intervalo:
      //   saída rápida: RSI(sellInterval) ≥ rsiSell → vende imediatamente
      //   saída lenta : RSI(interval)    ≤ 70       → RSI de entrada voltou → vende
      if (rsiExit >= rsiSell) {
        log(`${R}🚀 RSI(${effectiveSellInterval})=${rsiExit.toFixed(2)} ≥ ${rsiSell} — venda imediata${X}`);
        const newState = await executeSell(`RSI(${effectiveSellInterval}) ${rsiExit.toFixed(2)} ≥ ${rsiSell}`);
        if (newState) { state = newState; saveState(symbol, state); }
      } else if (rsi <= 70) {
        log(`${R}📉 RSI(${interval})=${rsi.toFixed(2)} voltou a ≤ 70 — sinal de VENDA${X}`);
        const newState = await executeSell(`RSI(${interval}) ${rsi.toFixed(2)} ≤ 70 (retorno da zona sobrecomprada no intervalo de entrada)`);
        if (newState) { state = newState; saveState(symbol, state); }
      } else {
        log(`⏳ RSI(${interval})=${rsi.toFixed(2)} aguardando ≤ 70 | RSI(${effectiveSellInterval})=${rsiExit.toFixed(2)} aguardando ≥ ${rsiSell}…`);
      }
    } else {
      // Modo single-intervalo
      if (rsiExit >= rsiOverbought) {
        log(`${R}🚀 RSI sobrecomprado extremo: ${rsiExit.toFixed(2)} ≥ ${rsiOverbought} — venda imediata${X}`);
        const newState = await executeSell(`RSI(${effectiveSellInterval}) ${rsiExit.toFixed(2)} ≥ ${rsiOverbought} (sobrecomprado extremo)`);
        if (newState) { state = newState; saveState(symbol, state); }
      } else if (rsiExit <= rsiSell) {
        log(`${R}📉 RSI saída voltou a ${rsiExit.toFixed(2)} ≤ ${rsiSell} — sinal de VENDA${X}`);
        const newState = await executeSell(`RSI(${effectiveSellInterval}) ${rsiExit.toFixed(2)} ≤ ${rsiSell} (retorno ao nível de venda)`);
        if (newState) { state = newState; saveState(symbol, state); }
      } else {
        if (interval !== '1m') {
          const { triggers: sell1m, rsi: rsi1m } = await check1mRsiSell(pair, adapter);
          if (sell1m) {
            log(`${R}🚀 RSI(1m)=${rsi1m.toFixed(2)} ≥ 80 — venda imediata${X}`);
            const newState = await executeSell(`RSI(1m) ${rsi1m.toFixed(2)} ≥ 80 (sobrecomprado no 1m)`);
            if (newState) { state = newState; saveState(symbol, state); }
            return;
          }
        }
        log(`⏳ RSI em ${rsi.toFixed(2)} — aguardando retorno a ≤ ${rsiSell} ou subida a ≥ ${rsiOverbought}…`);
      }
    }

  // ── PENDING_SELL: verifica se a ordem de venda foi preenchida ─────────────
  } else if (state.phase === 'PENDING_SELL') {
    // Guarda defensivo: sellOrderId ausente (estado corrompido ou salvo antes da correção)
    if (!state.sellOrderId) {
      log(`⚠️  sellOrderId ausente — verificando saldo para recuperar estado…`);
      const baseCurrency  = adapter.baseCurrency(pair);
      const tokenBalance  = await adapter.getTokenBalance(baseCurrency);
      const holdingUsdt   = tokenBalance * last.close;
      if (holdingUsdt >= MIN_HOLDING_USDT) {
        // Ainda tem saldo: volta para ABOVE_70 para tentar vender novamente
        state = { phase: 'ABOVE_70', exchange: state.exchange ?? exchange, buyQty: tokenBalance, buyUsdt: holdingUsdt, buyTime: state.buyTime ?? now(), detected: true };
        saveState(symbol, state);
        log(`♻️  Saldo detectado (${tokenBalance.toFixed(4)} ≈ $${holdingUsdt.toFixed(2)}) — voltando a ABOVE_70 para nova tentativa de venda`);
      } else {
        // Saldo zerado: venda provavelmente já ocorreu externamente
        state = { phase: 'WATCHING' };
        saveState(symbol, state);
        log(`✅ Saldo zerado — assumindo venda concluída, voltando a WATCHING`);
      }
      return;
    }
    try {
      const order  = await adapter.checkOrder(state.sellOrderId, pair);
      const status = order.status;

      if (status === 'closed') {
        log(`${'─'.repeat(60)}`);
        log(`${R}✅ VENDA CONCLUÍDA${X}`);
        log(`   Par      : ${pair}`);
        log(`   ID       : ${state.sellOrderId}`);
        log(`   Rec. líq.: ≈${state.estimatedUsdt.toFixed(2)} USDT`);
        log(`${'─'.repeat(60)}`);
        state = { phase: 'WATCHING' };
        saveState(symbol, state);

      } else if (status === 'cancelled') {
        log(`${'─'.repeat(60)}`);
        log(`🚫 VENDA CANCELADA (externamente)`);
        log(`   Par    : ${pair}`);
        log(`   ID     : ${state.sellOrderId}`);
        log(`   Preço  : ${state.sellPrice}`);
        log(`${'─'.repeat(60)}`);
        // Volta para ABOVE_70 para tentar vender novamente no próximo tick
        state = { phase: 'ABOVE_70', exchange: state.exchange ?? exchange, buyPrice: state.buyPrice, buyQty: state.sellQty, buyUsdt: state.buyUsdt, buyTime: state.buyTime, detected: state.detected };
        saveState(symbol, state);

      } else {
        log(`⏳ Ordem de venda aberta (id=${state.sellOrderId}) | preço=${state.sellPrice} | aguardando fill…`);
      }
    } catch (err) {
      if (err.message.includes('404')) {
        // Ordem não encontrada: verificar saldo para determinar se a venda já ocorreu
        log(`⚠️  Ordem de venda ${state.sellOrderId} não encontrada (404) — verificando saldo…`);
        try {
          const baseCurrency = adapter.baseCurrency(pair);
          const tokenBalance = await adapter.getTokenBalance(baseCurrency);
          const holdingUsdt  = tokenBalance * last.close;
          if (holdingUsdt >= MIN_HOLDING_USDT) {
            state = { phase: 'ABOVE_70', exchange: state.exchange ?? exchange, buyQty: tokenBalance, buyUsdt: holdingUsdt, buyTime: state.buyTime ?? now(), detected: true };
            saveState(symbol, state);
            log(`♻️  Saldo detectado (${tokenBalance.toFixed(4)} ≈ $${holdingUsdt.toFixed(2)}) — voltando a ABOVE_70 para nova tentativa de venda`);
          } else {
            state = { phase: 'WATCHING' };
            saveState(symbol, state);
            log(`✅ Saldo zerado — assumindo venda concluída, voltando a WATCHING`);
          }
        } catch (balErr) {
          log(`❌ Erro ao verificar saldo após 404: ${balErr.message}`);
        }
      } else {
        log(`❌ Erro ao verificar ordem de venda ${state.sellOrderId}: ${err.message}`);
      }
    }
  }

}

// ── Inicialização ─────────────────────────────────────────────────────────────

// Configs em tempo de execução: atualizadas pelo watchFavorites sem reiniciar o bot.
const liveConfigs = {};

async function startSymbol(cfg) {
  const { symbol, exchange = 'gate', interval = '30m', rsiBuy = RSI_BUY, rsiSell = RSI_SELL, symbolColor = '', sellInterval } = cfg;
  const effectiveSellInterval = sellInterval || interval;
  const adapter       = createAdapter(exchange);
  const pair          = adapter.toPair(symbol);
  const log           = makeLogger(symbol, symbolColor, interval);
  const state         = loadState(symbol);
  const variationMin  = cfg.variationMin  !== undefined ? cfg.variationMin  : defaultVariationMin(interval);
  const rsiOverbought = cfg.rsiOverbought !== undefined ? cfg.rsiOverbought : RSI_OVERBOUGHT;
  const pollMs        = Math.min(pollMsFor(interval), pollMsFor(effectiveSellInterval));

  // Registra config mutável; watchFavorites atualiza campos in-place entre ticks
  liveConfigs[symbol] = { interval, rsiBuy, rsiSell, sellInterval, variationMin, rsiOverbought, exchange };

  const ivLabel = effectiveSellInterval !== interval
    ? `entrada=${interval} / saída=${effectiveSellInterval}`
    : interval;
  log(`=== Iniciado | ${adapter.name} | par: ${pair} | intervalo: ${ivLabel} | poll: ${pollMs / 1000}s | RSI compra <${rsiBuy} | RSI venda >${rsiSell} | RSI imediato ≥${rsiOverbought} | var≥${variationMin}% | fase: ${state.phase} ===`);

  if (state.phase === 'PENDING_BUY') {
    log(`♻️  Estado restaurado — limit order pendente id=${state.pendingOrderId} | preço=${state.pendingPrice} (colocada em ${state.pendingTime})`);
  } else if (state.phase === 'BOUGHT' || state.phase === 'ABOVE_70') {
    log(`♻️  Estado restaurado — comprado a ${state.buyPrice} em ${state.buyTime}`);
  }

  const run = async () => {
    try { await tick(symbol, pair, log, liveConfigs[symbol], adapter); }
    catch (err) { log(`❌ Tick error: ${err.message}`); }
  };

  await run();
  setInterval(run, pollMs);
}

// Recarrega favorites_trade do Supabase a cada 5 min e atualiza configs in-place.
// Campos atualizáveis em tempo real: rsiBuy, rsiSell, interval, sellInterval,
// variationMin, rsiOverbought. (Trocar exchange/symbol requer reinício do bot.)
async function watchFavorites(colorOffset) {
  const UPDATABLE = ['rsiBuy', 'rsiSell', 'interval', 'sellInterval', 'variationMin', 'rsiOverbought'];

  setInterval(async () => {
    let entries;
    try {
      entries = await loadFavoritesTrade();
    } catch (err) {
      console.warn(`⚠️  [watchFavorites] erro ao recarregar favoritos: ${err.message}`);
      return;
    }

    entries.forEach((e, i) => {
      const sym = e.symbol;
      if (liveConfigs[sym]) {
        const changed = UPDATABLE.filter(k => e[k] !== undefined && liveConfigs[sym][k] !== e[k]);
        if (changed.length) {
          const summary = changed.map(k => `${k}: ${liveConfigs[sym][k]} → ${e[k]}`).join('  ');
          changed.forEach(k => { liveConfigs[sym][k] = e[k]; });
          console.log(`🔄 [${sym}] config atualizada: ${summary}`);
        }
      } else {
        // Novo símbolo adicionado enquanto o bot estava rodando
        const idx = colorOffset + i;
        const cfg = { exchange: 'binance', ...e, symbolColor: SYMBOL_COLORS[idx % SYMBOL_COLORS.length] };
        console.log(`➕ Novo símbolo detectado: ${sym} — iniciando…`);
        startSymbol(cfg).catch(err => console.error(`❌ startSymbol ${sym}:`, err.message));
      }
    });
  }, 5 * 60_000);
}

async function main() {
  if (!API_KEY || !SECRET_KEY) {
    console.error('❌ GATEIO_API_KEY / GATEIO_SECRET_KEY não definidos no .env');
    process.exit(1);
  }

  fs.mkdirSync(BOT_DATA_DIR, { recursive: true });

  // Sincroniza relógios com Gate.io e Binance, renova a cada hora
  await Promise.all([syncClock(), syncBinanceClock()]);
  setInterval(syncClock,         60 * 60_000);
  setInterval(syncBinanceClock,  60 * 60_000);

  const entries = await loadFavoritesTrade();
  if (!entries.length) { console.error('Nenhum símbolo em favorites_trade (Supabase).'); process.exit(1); }

  const configs = entries.map((e, i) => ({
    exchange: 'binance', ...e,
    symbolColor: SYMBOL_COLORS[i % SYMBOL_COLORS.length],
  }));

  console.log(`\n🤖 RSI Trade Bot`);
  configs.forEach(c => {
    const sellIv     = c.sellInterval || c.interval;
    const pollSec    = Math.min(pollMsFor(c.interval), pollMsFor(sellIv)) / 1000;
    const buyDisc    = (c.buyDiscount !== undefined ? c.buyDiscount : defaultBuyDiscount(c.interval)) * 100;
    const varMin     = c.variationMin  !== undefined ? c.variationMin  : defaultVariationMin(c.interval);
    const overbought = c.rsiOverbought !== undefined ? c.rsiOverbought : RSI_OVERBOUGHT;
    const ivLabel    = c.sellInterval ? `entrada=${c.interval}/saída=${c.sellInterval}` : c.interval;
    console.log(`   ${c.symbolColor}${c.symbol}${X}: exchange=${c.exchange}  intervalo=${ivLabel}  poll=${pollSec}s  RSI compra <${c.rsiBuy}  RSI venda >${c.rsiSell}  RSI imediato ≥${overbought}  compra −${buyDisc}%  var≥${varMin}%`);
  });
  console.log(`   Compra : desconto e var mínima por intervalo (ver defaultBuyDiscount / defaultVariationMin)`);
  console.log(`   Venda  : RSI volta a ≤${RSI_SELL}  OU  RSI ≥ ${RSI_OVERBOUGHT}  →  limit sell ${SELL_DISCOUNT * 100}% abaixo do preço live`);
  console.log(`   Capital: até $${MAX_USDT_PER_COIN} USDT por moeda (ou saldo disponível se menor)`);
  console.log(`   Taxa   : ${FEE_RATE * 100}% entrada + ${FEE_RATE * 100}% saída (descontadas da qty/receita)`);
  console.log(`   Poll   : ≤ ${POLL_MIN_MS / 60000} min (proporcional ao intervalo de cada moeda)\n`);

  await Promise.all(configs.map(startSymbol));

  // Verifica mudanças no banco a cada 5 minutos
  watchFavorites(configs.length);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
