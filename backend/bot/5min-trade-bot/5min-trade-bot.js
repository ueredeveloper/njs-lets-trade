'use strict';

/**
 * 5min Trade Bot — RSI 5m com DCA (cooldown 2h entre entradas)
 *
 * Entrada          : RSI(14) 5m < 30
 * DCA              : em posição, RSI < 30 de novo após ≥ 2h da última compra
 * Saída            : RSI(14) 5m > 70 — vende toda a posição
 * Capital          : por símbolo em five_min_bot_state (Supabase)
 *
 * Uso:
 *   node backend/bot/5min-trade-bot/5min-trade-bot.js
 */

const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { fetchBinanceCandles, fetchGateCandles, fetchBinanceCurrentPrice, fetchGateCurrentPrice } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { sendWhatsApp } = require('../whatsapp');
const { computeActiveStops } = require('./stopLossEngine');
const { normalizeRecoveryPattern, recoveryPatternLabel } = require('./recoveryPatternConfig');
const { isActiveStopLoss, stopLossLabel } = require('./stopLossConfig');
const { normalizeSellScope, sellScopeLabel } = require('./sellScopeConfig');
const { normalizeEntryPrice, entryPriceLabel, maLimitPriceFromMa } = require('./entryPriceConfig');
const { normalizeEntryPaths, entryPathsLabel } = require('./entryPathsConfig');
const { isNearMa50_5mForFastPoll, MA5M_FAST_MARGIN_PCT } = require('./ma5mEntryEngine');
const { evaluateTickForBot } = require('./evaluateTickForBot');
const { emitSignal, isReadyEntryReport, isReadyExitReport, clearSignalDedupe } = require('./fiveMinSignalLog');

// ── Configuração ──────────────────────────────────────────────────────────────
const INTERVAL           = '5m';
const RSI_PERIOD         = 14;
const RSI_BUY            = 30;
const RSI_SELL           = 70;
const RSI_FAST_MARGIN    = 4;           // ativa poll rápido quando RSI está a ≤4 do limiar
const ENTRY_COOLDOWN_MS  = 2 * 60 * 60_000; // 2h entre entradas
const CANDLE_LIMIT       = 100;
const POLL_MS            = 3 * 60_000;  // 3 min
const FAST_POLL_MS       = 60_000;      // 1 min quando RSI próximo de limiar
const VOL_MIN_USDT       = 1_000_000;
const GATE_FEE_RATE      = 0.002;

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';
// Verde (\x1b[32m/\x1b[92m) e vermelho (\x1b[31m/\x1b[91m) são reservados para compra/venda
const COLORS = ['\x1b[94m','\x1b[93m','\x1b[95m','\x1b[96m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[34m','\x1b[97m','\x1b[90m'];

function nowFmt() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function makeLogger(symbol, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-5min.txt`);
  return function log(...args) {
    const msg    = `[${nowFmt()}] ${color}[${symbol}]${X} ${args.join(' ')}`;
    const noAnsi = msg.replace(/\x1b\[[0-9;]*m/g, '');
    console.log(msg);
    try { fs.appendFileSync(logFile, noAnsi + '\n'); } catch {}
  };
}

function askUser(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

// ── Binance ───────────────────────────────────────────────────────────────────
const BINANCE_BASE       = 'https://api.binance.com';
const BINANCE_API_KEY    = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
let   binanceClockOffsetMs = 0;

async function syncBinanceClock() {
  try {
    const res  = await fetch(`${BINANCE_BASE}/api/v3/time`);
    const data = await res.json();
    binanceClockOffsetMs = data.serverTime - Date.now();
  } catch {}
}

function binanceSign(params) {
  const qs  = new URLSearchParams(params).toString();
  const sig = crypto.createHmac('sha256', BINANCE_SECRET_KEY).update(qs).digest('hex');
  return `${qs}&signature=${sig}`;
}

async function binanceReq(method, endpoint, params = {}) {
  const ts     = Date.now() + binanceClockOffsetMs;
  const signed = binanceSign({ ...params, timestamp: ts, recvWindow: 10000 });
  const url    = method === 'GET'
    ? `${BINANCE_BASE}${endpoint}?${signed}`
    : `${BINANCE_BASE}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': BINANCE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method !== 'GET' ? signed : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Binance ${method} ${endpoint} ${res.status}: ${data?.msg ?? text}`);
  return data;
}

async function binanceMarketBuy(symbol, usdtAmount) {
  const order     = await binanceReq('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: usdtAmount.toFixed(2),
  });
  const filledQty = parseFloat(order.executedQty);
  const quoteQty  = parseFloat(order.cummulativeQuoteQty);
  return { filledQty, quoteQty, avgPrice: quoteQty / filledQty };
}

async function binanceSymbolFilters(symbol) {
  const info = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const sym  = info.symbols?.[0];
  if (!sym) return {};
  const priceFilter = sym.filters?.find(f => f.filterType === 'PRICE_FILTER');
  const lotFilter   = sym.filters?.find(f => f.filterType === 'LOT_SIZE');
  const tickSize    = priceFilter ? parseFloat(priceFilter.tickSize) : 0.00000001;
  const stepSize    = lotFilter ? parseFloat(lotFilter.stepSize) : 0.00000001;
  const priceDecimals = tickSize < 1 ? (String(tickSize).split('.')[1]?.length ?? 8) : 0;
  const qtyDecimals   = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 8) : 0;
  return { tickSize, stepSize, priceDecimals, qtyDecimals };
}

function roundDown(value, step) {
  if (!step || step <= 0) return value;
  return Math.floor(value / step) * step;
}

async function binanceBuy(symbol, usdtAmount, { belowPct = 0 } = {}) {
  const pct = Number(belowPct);
  if (!Number.isFinite(pct) || pct <= 0) return binanceMarketBuy(symbol, usdtAmount);

  const ticker = await fetch(`${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}`).then(r => r.json());
  const market = parseFloat(ticker.price);
  if (!market) throw new Error('Binance: preço inválido');

  const { tickSize, stepSize, priceDecimals, qtyDecimals } = await binanceSymbolFilters(symbol);
  const rawLimit   = market * (1 - pct / 100);
  const limitPrice = parseFloat(roundDown(rawLimit, tickSize).toFixed(priceDecimals));
  const rawQty     = usdtAmount / limitPrice;
  const quantity   = parseFloat(roundDown(rawQty, stepSize).toFixed(qtyDecimals));
  if (quantity <= 0) throw new Error('Binance: quantidade inválida para limit');

  const order = await binanceReq('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'LIMIT', timeInForce: 'IOC',
    price: String(limitPrice), quantity: String(quantity),
  });
  const filledQty = parseFloat(order.executedQty || 0);
  const quoteQty  = parseFloat(order.cummulativeQuoteQty || 0);
  if (filledQty <= 0) {
    throw new Error(`Binance: limit −${pct}% @ ${limitPrice} não preenchida (mercado ${market})`);
  }
  return { filledQty, quoteQty, avgPrice: quoteQty / filledQty };
}

const MA_LIMIT_WAIT_MS = 5000;

async function binanceCancelOrder(symbol, orderId, log) {
  try {
    await binanceReq('DELETE', '/api/v3/order', { symbol, orderId });
    log?.(`🚫 Ordem limit cancelada (id=${orderId})`);
  } catch (err) {
    log?.(`⚠️  Cancelar ordem ${orderId}: ${err.message}`);
  }
}

/** Limit GTC no preço da MA50 5m — aguarda reteste até MA_LIMIT_WAIT_MS */
async function binanceBuyLimitGtc(symbol, usdtAmount, limitPrice, log) {
  const lp = Number(limitPrice);
  if (!Number.isFinite(lp) || lp <= 0) throw new Error('Binance: preço limit MA inválido');

  const { tickSize, stepSize, priceDecimals, qtyDecimals } = await binanceSymbolFilters(symbol);
  const price = parseFloat(roundDown(lp, tickSize).toFixed(priceDecimals));
  const rawQty = usdtAmount / price;
  const quantity = parseFloat(roundDown(rawQty, stepSize).toFixed(qtyDecimals));
  if (quantity <= 0) throw new Error('Binance: quantidade inválida para limit GTC');

  const order = await binanceReq('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'LIMIT', timeInForce: 'GTC',
    price: String(price), quantity: String(quantity),
  });
  await new Promise(r => setTimeout(r, MA_LIMIT_WAIT_MS));

  const status = await binanceReq('GET', '/api/v3/order', { symbol, orderId: order.orderId });
  let filledQty = parseFloat(status.executedQty || 0);
  let quoteQty  = parseFloat(status.cummulativeQuoteQty || 0);

  if (status.status !== 'FILLED' && filledQty <= 0) {
    await binanceCancelOrder(symbol, order.orderId, log);
    throw new Error(`Binance: limit GTC @ ${price} não preenchida em ${MA_LIMIT_WAIT_MS / 1000}s (reteste)`);
  }
  if (status.status !== 'FILLED' && status.status !== 'EXPIRED') {
    await binanceCancelOrder(symbol, order.orderId, log);
  }
  if (filledQty <= 0) {
    throw new Error(`Binance: limit GTC @ ${price} sem fill`);
  }
  return { filledQty, quoteQty, avgPrice: quoteQty / filledQty };
}

async function binanceGetTokenBalance(symbol) {
  const base    = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol.slice(0, -3);
  const account = await binanceReq('GET', '/api/v3/account');
  const asset   = account.balances.find(b => b.asset === base);
  return asset ? parseFloat(asset.free) : 0;
}

async function binanceMarketSell(symbol, qty, log, _opts = {}) {
  const actualBalance = await binanceGetTokenBalance(symbol);
  const sellQty       = Math.min(parseFloat(qty), actualBalance);
  if (sellQty <= 0) throw new Error(`Binance: saldo insuficiente (disponível: ${actualBalance})`);
  if (sellQty < parseFloat(qty)) log?.(`⚠️  Qty ajustada: ${qty} → ${sellQty} (saldo real Binance)`);

  const info      = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const decimals  = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 0) : 0;
  const safeQty   = (Math.floor(sellQty / stepSize) * stepSize).toFixed(decimals);
  const order     = await binanceReq('POST', '/api/v3/order', {
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

// ── Gate.io ───────────────────────────────────────────────────────────────────
const GATE_BASE       = 'https://api.gateio.ws/api/v4';
const GATE_API_KEY    = process.env.GATEIO_API_KEY;
const GATE_SECRET_KEY = process.env.GATEIO_SECRET_KEY;
let   gateClockOffsetSec = 0;

async function syncGateClock() {
  try {
    const res  = await fetch(`${GATE_BASE}/spot/time`);
    const data = await res.json();
    if (!data?.server_time) return;
    gateClockOffsetSec = Math.floor(data.server_time / 1000) - Math.floor(Date.now() / 1000);
  } catch {}
}

function gateSign(method, endpointPath, queryString, bodyStr) {
  const timestamp  = (Math.floor(Date.now() / 1000) + gateClockOffsetSec).toString();
  const hashedBody = crypto.createHash('sha512').update(bodyStr || '').digest('hex');
  const msg        = [method.toUpperCase(), `/api/v4${endpointPath}`, queryString, hashedBody, timestamp].join('\n');
  const sign       = crypto.createHmac('sha512', GATE_SECRET_KEY).update(msg).digest('hex');
  return { timestamp, sign };
}

async function gateReq(method, endpointPath, params = {}, _retry = true) {
  let url  = `${GATE_BASE}${endpointPath}`;
  let qs   = '';
  let body = '';
  if (method === 'GET') {
    qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    body = JSON.stringify(params);
  }
  const { timestamp, sign } = gateSign(method, endpointPath, qs, body);
  const res = await fetch(url, {
    method,
    headers: { KEY: GATE_API_KEY, Timestamp: timestamp, SIGN: sign, 'Content-Type': 'application/json' },
    body: method === 'POST' ? body : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = data?.message || data?.label || text;
    if (res.status === 403 && _retry) {
      const match = msg.match(/current_time:(\d+).*header\.timestamp:(\d+)/);
      if (match) {
        gateClockOffsetSec = parseInt(match[1]) - (parseInt(match[2]) - gateClockOffsetSec);
        return gateReq(method, endpointPath, params, false);
      }
    }
    throw new Error(`Gate ${method} ${endpointPath} ${res.status}: ${msg}`);
  }
  return data;
}

async function gateGetTokenBalance(pair) {
  const base     = pair.split('_')[0];
  const accounts = await gateReq('GET', '/spot/accounts');
  const acc      = accounts.find(a => a.currency === base);
  return acc ? parseFloat(acc.available) : 0;
}

async function gateCancelOrder(orderId, pair, log) {
  try {
    await gateReq('DELETE', `/spot/orders/${orderId}`, { currency_pair: pair });
    log?.(`🚫 Ordem limit cancelada (id=${orderId})`);
  } catch (err) {
    log?.(`⚠️  Cancelar ordem ${orderId}: ${err.message}`);
  }
}

async function gateBuyLimitGtc(pair, usdtAmount, limitPrice, log) {
  const lp = Number(limitPrice);
  if (!Number.isFinite(lp) || lp <= 0) throw new Error('Gate.io: preço limit MA inválido');

  const price = parseFloat(lp.toFixed(8));
  const qty   = parseFloat((usdtAmount / price).toFixed(8));
  if (qty <= 0) throw new Error('Gate.io: quantidade inválida para limit GTC');

  const order = await gateReq('POST', '/spot/orders', {
    currency_pair: pair, side: 'buy', type: 'limit',
    price: String(price), amount: String(qty), time_in_force: 'gtc',
  });
  await new Promise(r => setTimeout(r, MA_LIMIT_WAIT_MS));

  const filled = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || price);

  if (grossQty <= 0) {
    await gateCancelOrder(order.id, pair, log);
    throw new Error(`Gate.io: limit GTC @ ${price} não preenchida em ${MA_LIMIT_WAIT_MS / 1000}s (reteste)`);
  }
  if (filled.status === 'open') {
    await gateCancelOrder(order.id, pair, log);
  }
  const netQty = parseFloat((grossQty * (1 - GATE_FEE_RATE)).toFixed(8));
  return { filledQty: netQty, quoteQty: quoteQty || grossQty * avgPrice, avgPrice };
}

async function gateBuy(pair, usdtAmount, { belowPct = 0 } = {}) {
  const ticker     = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  const price      = parseFloat(ticker[0]?.last);
  if (!price) throw new Error(`Gate.io: preço inválido para ${pair}`);
  const pct        = Number(belowPct);
  const limitPrice = parseFloat(
    (price * (pct > 0 ? (1 - pct / 100) : 1.005)).toFixed(8),
  );
  const qty        = parseFloat((usdtAmount / limitPrice).toFixed(8));
  const order      = await gateReq('POST', '/spot/orders', {
    currency_pair: pair, side: 'buy', type: 'limit',
    price: String(limitPrice), amount: String(qty), time_in_force: 'ioc',
  });
  await new Promise(r => setTimeout(r, 1000));
  const filled   = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || limitPrice);
  if (grossQty <= 0) {
    const label = pct > 0 ? `limit −${pct}%` : 'mercado';
    throw new Error(`Gate.io: compra ${label} @ ${limitPrice} não preenchida`);
  }
  const netQty = parseFloat((grossQty * (1 - GATE_FEE_RATE)).toFixed(8));
  return { filledQty: netQty, quoteQty: quoteQty || grossQty * avgPrice, avgPrice };
}

async function gateMarketSell(pair, qty, log, { aggressive = false } = {}) {
  const actualBalance = await gateGetTokenBalance(pair);
  const sellQty       = Math.min(parseFloat(qty), actualBalance);
  if (sellQty <= 0) throw new Error(`Gate.io: saldo insuficiente (disponível: ${actualBalance})`);
  if (sellQty < parseFloat(qty)) log(`⚠️  Qty ajustada: ${qty} → ${sellQty} (saldo real)`);

  if (aggressive) {
    try {
      const ticker = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
      const bid    = parseFloat(ticker[0]?.highest_bid || ticker[0]?.last);
      if (bid > 0) {
        log(`📉 Venda IOC no bid $${bid} (baixa liquidez)`);
        const order  = await gateReq('POST', '/spot/orders', {
          currency_pair: pair, side: 'sell', type: 'limit',
          price: String(bid), amount: sellQty.toFixed(8), time_in_force: 'ioc',
        });
        await new Promise(r => setTimeout(r, 1500));
        const filled    = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
        const soldQty   = parseFloat(filled.amount) - parseFloat(filled.left || 0);
        const usdtOut   = parseFloat(filled.filled_total || 0);
        const exitPrice = parseFloat(filled.avg_deal_price || bid);
        if (soldQty > 0) return { soldQty, usdtOut: usdtOut || soldQty * exitPrice, exitPrice };
        log(`⚠️  IOC parcial/zero — tentando market`);
      }
    } catch (err) { log(`⚠️  IOC falhou (${err.message}) — tentando market`); }
  }

  const order = await gateReq('POST', '/spot/orders', {
    currency_pair: pair, side: 'sell', type: 'market',
    amount: sellQty.toFixed(8), time_in_force: 'ioc',
  });
  await new Promise(r => setTimeout(r, 2000));
  const filled    = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  const soldQty   = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const usdtOut   = parseFloat(filled.filled_total || 0);
  const exitPrice = parseFloat(filled.avg_deal_price || 0);
  if (soldQty <= 0) throw new Error(`Gate.io: venda não preenchida (status=${filled.status})`);
  return { soldQty, usdtOut: usdtOut || soldQty * exitPrice, exitPrice };
}

async function gate24hVolume(pair) {
  const data = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  return parseFloat(data[0]?.quote_volume || 0);
}

// ── Adapters ──────────────────────────────────────────────────────────────────
function buildAdapter(exchange, symbol) {
  if (exchange === 'gate') {
    const pair = toGateSymbol(symbol);
    return {
      name:         'Gate.io',
      pair,
      fetchCandles: (lim, iv)  => fetchGateCandles(pair, lim, iv),
      fetchLastPrice: ()       => fetchGateCurrentPrice(pair),
      marketBuy:    (usdt, opts) => gateBuy(pair, usdt, opts),
      buyLimitGtc:  (usdt, limitPrice, log) => gateBuyLimitGtc(pair, usdt, limitPrice, log),
      marketSell:   (qty, log, opts) => gateMarketSell(pair, qty, log, opts),
      fetch24hVol:  ()         => gate24hVolume(pair),
      getBalance:   ()         => gateGetTokenBalance(pair),
    };
  }
  return {
    name:         'Binance',
    pair:         symbol,
    fetchCandles: (lim, iv)  => fetchBinanceCandles(symbol, lim, iv),
    fetchLastPrice: ()       => fetchBinanceCurrentPrice(symbol),
    marketBuy:    (usdt, opts) => binanceBuy(symbol, usdt, opts),
    buyLimitGtc:  (usdt, limitPrice, log) => binanceBuyLimitGtc(symbol, usdt, limitPrice, log),
      marketSell:   (qty, log, opts) => binanceMarketSell(symbol, qty, log, opts),
    fetch24hVol:  ()         => binance24hVolume(symbol),
    getBalance:   ()         => binanceGetTokenBalance(symbol),
  };
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbReq(method, table, body, query = '') {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${table} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function loadSymbols() {
  return sbReq('GET', 'five_min_bot_state', null, '?order=id.asc');
}

async function saveState(id, update) {
  await sbReq('PATCH', 'five_min_bot_state', { ...update, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
}

async function saveTrade(trade) {
  await sbReq('POST', 'five_min_bot_trades', trade);
}

async function resolveSellQty(adapter, state, log) {
  const scope  = normalizeSellScope(state.sell_scope).scope;
  const botQty = parseFloat(state.buy_qty || 0);
  if (scope === 'wallet') {
    const balance = await adapter.getBalance();
    if (balance <= 0) throw new Error(`Saldo livre insuficiente para venda (${adapter.name})`);
    if (balance > botQty + 1e-12) {
      log(`${Y}📦 Modo carteira — vendendo saldo ${balance.toFixed(8)} (bot rastreou ${botQty.toFixed(8)})${X}`);
    }
    return { sellQty: balance, scope, botQty };
  }
  if (botQty <= 0) throw new Error('Qty do bot zerada — nada a vender');
  return { sellQty: botQty, scope: 'bot_only', botQty };
}

async function executeSell(rowId, adapter, log, state, rsi, reason = 'rsi') {
  const { symbol, phase } = state;
  if (phase !== 'BOUGHT') return false;

  const buyCount      = state.buy_count || 0;
  const capitalPerEntry = parseFloat(state.capital);
  const reasonLabel   = reason === 'stop_loss' ? 'STOP LOSS' : 'VENDA TOTAL';
  const reasonEmoji   = reason === 'stop_loss' ? `${Y}🛡️` : `${R}🔴`;
  const rsiNote       = reason === 'rsi' ? `RSI(5m)=${rsi.toFixed(2)} > ${Number(state.rsi_sell ?? RSI_SELL)} — ` : '';

  let sellPlan;
  try {
    sellPlan = await resolveSellQty(adapter, state, log);
  } catch (err) {
    log(`❌ ${err.message}`);
    return false;
  }
  const { sellQty, scope, botQty } = sellPlan;

  let result;
  try {
    let sellOpts = {};
    if (adapter.name === 'Gate.io') {
      let aggressive = false;
      try {
        const vol = await adapter.fetch24hVol();
        aggressive = vol == null || vol < 1_000_000;
      } catch { aggressive = true; }
      sellOpts = { aggressive };
    }
    result = await adapter.marketSell(sellQty, log, sellOpts);
  } catch (err) {
    log(`❌ Erro na venda: ${err.message}`);
    return false;
  }

  const { soldQty, usdtOut, exitPrice } = result;
  const totalIn       = parseFloat(state.buy_usdt);
  let countedUsdtOut  = usdtOut;
  if (scope === 'wallet' && soldQty > botQty && botQty > 0) {
    countedUsdtOut = usdtOut * (botQty / soldQty);
  }
  const pnlUsdt       = countedUsdtOut - totalIn;
  const pnlPct        = totalIn > 0 ? (pnlUsdt / totalIn) * 100 : 0;
  const capitalBefore = capitalPerEntry;
  const capitalAfter  = capitalBefore + pnlUsdt;
  const pnlSign       = pnlUsdt >= 0 ? '+' : '';

  await saveTrade({
    symbol, exchange: state.exchange,
    entry_time: state.buy_time, exit_time: new Date().toISOString(),
    entry_price: parseFloat(state.buy_price), exit_price: exitPrice,
    qty: soldQty, usdt_in: totalIn, usdt_out: usdtOut,
    pnl_usdt: pnlUsdt, pnl_pct: pnlPct,
    capital_before: capitalBefore, capital_after: capitalAfter,
    buy_count: buyCount,
    rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: rsi,
  });

  await saveState(rowId, {
    capital: capitalAfter, phase: 'WATCHING',
    buy_price: null, buy_qty: null, buy_usdt: null,
    buy_time: null, last_buy_time: null, buy_count: 0, rsi_entry: null,
    entry_path: null,
  });

  const waPrefix = reason === 'stop_loss' ? '🛡️' : '🔴';
  const waTitle  = reason === 'stop_loss' ? 'STOP LOSS' : 'VENDA TOTAL';
  sendWhatsApp(
    `${waPrefix} [5m Trade] ${symbol} ${waTitle} [${adapter.name}]\n` +
    `Entradas: ${buyCount}\nPreço saída: ${exitPrice.toFixed(6)}\n` +
    `USDT investido: ${totalIn.toFixed(4)}\nUSDT recebido: ${usdtOut.toFixed(4)}\n` +
    `PnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)\n` +
    `Capital: ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)} USDT` +
    (reason === 'rsi' ? `\nRSI(5m): ${rsi.toFixed(2)}` : ''),
  );

  return true;
}

async function executeBuy(rowId, adapter, log, state, rsi, capitalPerEntry, isDca, rsiBuy, entryPath = 'rsi', maPrice = null) {
  const { symbol } = state;
  const usdtAmount = parseFloat(capitalPerEntry);
  const entryCfg   = normalizeEntryPrice(state.entry_price);
  const pathLbl    = entryPath === 'ma50_5m' ? 'MA50 5m' : `RSI<${rsiBuy}`;

  let entryLabel;
  let result;

  try {
    if (entryPath === 'ma50_5m') {
      if (entryCfg.maMode === 'ma_limit') {
        const limitPx = maLimitPriceFromMa(maPrice, entryCfg);
        if (limitPx == null) throw new Error('MA50 5m indisponível para limit GTC');
        entryLabel = entryCfg.maBelowPct > 0
          ? `limit GTC MA−${entryCfg.maBelowPct}% @ ${limitPx.toFixed(6)}`
          : `limit GTC @ MA ${limitPx.toFixed(6)}`;
        log(`ℹ️  MA50 5m: ${entryLabel} (aguarda ${MA_LIMIT_WAIT_MS / 1000}s)`);
        result = await adapter.buyLimitGtc(usdtAmount, limitPx, log);
      } else {
        entryLabel = 'mercado';
        result = await adapter.marketBuy(usdtAmount, { belowPct: 0 });
      }
    } else {
      const belowPct = entryCfg.mode === 'below' ? entryCfg.belowPct : 0;
      entryLabel = belowPct > 0 ? `limit −${belowPct}%` : 'mercado';
      result = await adapter.marketBuy(usdtAmount, { belowPct });
    }
  } catch (err) {
    log(`❌ Erro na compra (${pathLbl}): ${err.message}`);
    return { error: err.message, entryLabel };
  }

  const { filledQty, quoteQty, avgPrice } = result;
  const now = new Date().toISOString();

  const prevQty   = parseFloat(state.buy_qty   || 0);
  const prevUsdt  = parseFloat(state.buy_usdt  || 0);
  const newQty    = prevQty + filledQty;
  const newUsdt   = prevUsdt + quoteQty;
  const avgEntry  = newUsdt / newQty;
  const buyCount  = (state.buy_count || 0) + 1;

  await saveState(rowId, {
    phase:         'BOUGHT',
    buy_price:     avgEntry,
    buy_qty:       newQty,
    buy_usdt:      newUsdt,
    buy_time:      state.buy_time || now,
    last_buy_time: now,
    buy_count:     buyCount,
    rsi_entry:     state.rsi_entry ?? rsi,
    entry_path:    isDca ? (state.entry_path || entryPath) : entryPath,
  });

  sendWhatsApp(
    `🟢 [5m Trade] ${symbol} COMPRA${isDca ? ' DCA' : ''} #${buyCount} [${adapter.name}]\n` +
    `Preço: ${avgPrice.toFixed(6)}\nQty+: ${filledQty}\nTotal qty: ${newQty.toFixed(8)}\n` +
    `USDT+: ${quoteQty.toFixed(4)} (total: ${newUsdt.toFixed(4)})\nRSI(5m): ${rsi.toFixed(2)}`,
  );

  return { newQty, newUsdt, buyCount, avgPrice: avgEntry };
}

async function refreshActiveStop(adapter, state, rsiBuy, entryPrice, currentPrice) {
  const stopLoss = state.stop_loss;
  if (!isActiveStopLoss(stopLoss)) return null;
  try {
    return await computeActiveStops(
      adapter, state.stop_loss, state.ma_filters, rsiBuy, entryPrice, currentPrice,
    );
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────
function tickPollState(rsi, nearMa5m = false) {
  return { rsi, nearMa5m: nearMa5m === true };
}

async function tick(rowId, adapter, log, prevPoll = null, lastStop = null, setStop = null) {
  const candles = await adapter.fetchCandles(CANDLE_LIMIT, INTERVAL);
  const closes  = candles.map(c => c.close);

  if (closes.length < RSI_PERIOD + 2) return prevPoll ?? tickPollState(null, false);

  const rsiVals = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  const rsi     = rsiVals[rsiVals.length - 1];
  const close   = closes[closes.length - 1];

  if (rsi == null) return prevPoll ?? tickPollState(null, false);

  const rows = await sbReq('GET', 'five_min_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) { log('❌ Linha não encontrada no Supabase.'); return tickPollState(rsi, false); }

  const rsiBuy  = Number(state.rsi_buy  ?? RSI_BUY);
  const rsiSell = Number(state.rsi_sell ?? RSI_SELL);
  const { phase, capital, symbol } = state;
  const capitalPerEntry = parseFloat(capital);
  const entryPathsCfg = normalizeEntryPaths(state.entry_paths);
  let livePrice = null;
  if (typeof adapter.fetchLastPrice === 'function') {
    try { livePrice = await adapter.fetchLastPrice(); } catch { /* usa close da vela */ }
  }
  const ma5mProximity = isNearMa50_5mForFastPoll(candles, entryPathsCfg, livePrice);

  let report;
  try {
    report = await evaluateTickForBot(adapter, state, candles, livePrice);
  } catch (err) {
    log(`❌ Avaliação: ${err.message}`);
    return tickPollState(rsi, ma5mProximity.near);
  }

  const willExecuteEntry = isReadyEntryReport(report)
    && ((phase === 'WATCHING' && report.action === 'compraria')
      || (phase === 'BOUGHT' && report.action === 'dca_compraria'));
  const willExecuteExit = phase === 'BOUGHT' && isReadyExitReport(report);

  if (phase === 'WATCHING') {
    if (willExecuteEntry) {
      const path = report.pathSignal?.path ?? 'rsi';
      const maPrice = report.ma5mTrigger?.ma ?? null;
      const buyResult = await executeBuy(rowId, adapter, log, state, rsi, capitalPerEntry, false, rsiBuy, path, maPrice);
      if (buyResult && !buyResult.error) {
        clearSignalDedupe(symbol);
        await emitSignal(sbReq, { ...state, entry_path: path }, report, 'entry', log, {
          entryPath: path,
          motivation: `Compra executada · ${report.reason}`,
          price: buyResult.avgPrice,
        });
        if (setStop) {
          refreshActiveStop(adapter, state, rsiBuy, buyResult.avgPrice, buyResult.avgPrice)
            .then(stop => { setStop(stop); })
            .catch(() => {});
        }
      } else {
        await emitSignal(sbReq, state, report, 'possible_entry', log, {
          entryPath: path,
          motivation: `Regras OK mas ordem não preencheu · ${report.reason}`,
          orderError: buyResult?.error ?? 'ordem não preencheu',
        });
      }
    }
    return tickPollState(rsi, ma5mProximity.near);
  }

  if (phase === 'BOUGHT') {
    const entryPrice = parseFloat(state.buy_price || close);

    if (isActiveStopLoss(state.stop_loss)) {
      const activeStop = await refreshActiveStop(adapter, state, rsiBuy, entryPrice, close);
      if (setStop) setStop(activeStop);

      if (activeStop?.ok && close <= activeStop.stopPrice) {
        const sold = await executeSell(rowId, adapter, log, state, rsi, 'stop_loss');
        if (sold) {
          clearSignalDedupe(symbol);
          await emitSignal(sbReq, state, report, 'exit', log, {
            exitReason: 'stop_loss',
            motivation: `Stop ${activeStop.label} @ ${activeStop.stopPrice}`,
            price: close,
          });
        }
        return tickPollState(rsi, ma5mProximity.near);
      }
    }

    if (willExecuteExit) {
      const sold = await executeSell(rowId, adapter, log, state, rsi, 'rsi');
      if (sold) {
        clearSignalDedupe(symbol);
        await emitSignal(sbReq, state, report, 'exit', log, {
          exitReason: 'rsi',
          motivation: report.reason,
          price: close,
        });
      } else {
        await emitSignal(sbReq, state, report, 'possible_exit', log, {
          exitReason: 'rsi',
          motivation: `Regras OK mas venda falhou · ${report.reason}`,
        });
      }
      return tickPollState(rsi, ma5mProximity.near);
    }

    if (willExecuteEntry) {
      const path = report.pathSignal?.path ?? 'rsi';
      const maPrice = report.ma5mTrigger?.ma ?? null;
      const buyResult = await executeBuy(rowId, adapter, log, state, rsi, capitalPerEntry, true, rsiBuy, path, maPrice);
      if (buyResult && !buyResult.error) {
        await emitSignal(sbReq, { ...state, entry_path: path }, report, 'entry', log, {
          entryPath: path,
          motivation: `DCA executada · ${report.reason}`,
          price: buyResult.avgPrice,
          details: { dca: true },
        });
        if (setStop) {
          refreshActiveStop(adapter, state, rsiBuy, buyResult.avgPrice, buyResult.avgPrice)
            .then(stop => { setStop(stop); })
            .catch(() => {});
        }
      } else {
        await emitSignal(sbReq, state, report, 'possible_entry', log, {
          entryPath: path,
          motivation: `DCA regras OK mas ordem não preencheu · ${report.reason}`,
          orderError: buyResult?.error ?? 'ordem não preencheu',
          details: { dca: true },
        });
      }
    }
  }

  return tickPollState(rsi, ma5mProximity.near);
}

// ── Inicialização por símbolo ─────────────────────────────────────────────────
async function startSymbol(row, color) {
  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, color);
  const rsiBuy  = Number(row.rsi_buy  ?? RSI_BUY);
  const rsiSell = Number(row.rsi_sell ?? RSI_SELL);
  const buyFastThreshold  = rsiBuy  + RSI_FAST_MARGIN;
  const sellFastThreshold = rsiSell - RSI_FAST_MARGIN;

  log(
    `=== Iniciado | ${adapter.name} | RSI(${RSI_PERIOD},${INTERVAL}) | ` +
    `compra < ${rsiBuy} | venda > ${rsiSell} | caminhos: ${entryPathsLabel(row.entry_paths)} | ` +
    `entrada: ${entryPriceLabel(row.entry_price)} | stop: ${stopLossLabel(row.stop_loss)} | ` +
    `venda: ${sellScopeLabel(row.sell_scope)} | ` +
    `padrão 1h: ${recoveryPatternLabel(row.recovery_pattern)} | ` +
    `DCA cooldown ${normalizeEntryPaths(row.entry_paths).pathCooldownHours}h | ` +
    `poll 3min / 1min (RSI≤${buyFastThreshold} ou ≥${sellFastThreshold} ou MA50 5m ≤${MA5M_FAST_MARGIN_PCT}%) | fase: ${row.phase} ===`,
  );
  if (!isActiveStopLoss(row.stop_loss)) {
    log(`${Y}⚠️  Stop loss não configurado — edite no painel 5m Trade (hist ou ma)${X}`);
  }
  if (row.phase === 'BOUGHT') {
    log(
      `♻️  Posição aberta — ${row.buy_count || 1} entrada(s) | ` +
      `qty=${parseFloat(row.buy_qty).toFixed(8)} | médio=${parseFloat(row.buy_price).toFixed(6)} | ` +
      `última compra: ${row.last_buy_time || row.buy_time}`,
    );
  }

  let lastPoll = null;
  let lastStop = null;
  let errCount = 0;

  const schedule = () => {
    const lastRsi = lastPoll?.rsi ?? null;
    const nearBuy  = lastRsi !== null && lastRsi <= buyFastThreshold;
    const nearSell = lastRsi !== null && lastRsi >= sellFastThreshold;
    const nearMa5m = lastPoll?.nearMa5m === true;
    const delay    = (nearBuy || nearSell || nearMa5m) ? FAST_POLL_MS : POLL_MS;
    setTimeout(run, delay);
  };

  const run = async () => {
    try {
      lastPoll = await tick(row.id, adapter, log, lastPoll, lastStop, s => { lastStop = s; });
      errCount = 0;
    } catch (err) {
      errCount++;
      if (errCount <= 3) log(`❌ Tick error: ${err.message}`);
      else if (errCount === 4) log(`❌ Erros repetidos — silenciando. Verifique o par na exchange.`);
    }
    schedule();
  };

  await run();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  await Promise.all([syncBinanceClock(), syncGateClock()]);
  setInterval(syncBinanceClock, 60 * 60_000);
  setInterval(syncGateClock,    60 * 60_000);

  const rows = await loadSymbols();
  if (!rows?.length) {
    console.error('❌ Nenhum símbolo em five_min_bot_state. Execute 5min-trade-bot.sql no Supabase.');
    process.exit(1);
  }

  console.log(`\n🤖 5min Trade Bot`);
  console.log(`   Entrada : RSI(${RSI_PERIOD}, ${INTERVAL}) < ${RSI_BUY}`);
  console.log(`   DCA     : RSI < ${RSI_BUY} após ≥ ${ENTRY_COOLDOWN_MS / 3_600_000}h da última entrada`);
  console.log(`   Saída   : RSI(${RSI_PERIOD}, ${INTERVAL}) > ${RSI_SELL} — venda total\n`);

  const toStart = [];

  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const color   = COLORS[i % COLORS.length];
    const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);

    let volFmt = 'n/a';
    let volOk  = true;
    try {
      const vol = await adapter.fetch24hVol();
      volFmt    = vol >= 1_000_000
        ? `$${(vol / 1_000_000).toFixed(2)}M`
        : `$${(vol / 1000).toFixed(1)}K`;
      volOk = vol >= VOL_MIN_USDT;
    } catch {}

    console.log(
      `   ${color}${row.symbol}${X}  exchange=${row.exchange ?? 'binance'}  ` +
      `capital/entrada=$${parseFloat(row.capital).toFixed(2)}  vol24h=${volFmt}  ` +
      `fase=${row.phase ?? 'WATCHING'}` +
      (row.phase === 'BOUGHT' ? `  entradas=${row.buy_count || 0}` : ''),
    );

    if (!volOk) {
      console.log(`   ${Y}⚠️  Volume < $1M — baixa liquidez${X}`);
      const resp = await askUser(`   Incluir ${row.symbol} mesmo assim? [s/N]: `);
      if (resp !== 's' && resp !== 'sim') {
        console.log(`   ⏭️  ${row.symbol} ignorado.\n`);
        continue;
      }
    }

    toStart.push({ row, color });
  }

  console.log();

  if (!toStart.length) {
    console.error('❌ Nenhum símbolo aprovado para iniciar.');
    process.exit(0);
  }

  const symbolList = toStart.map(({ row }) => row.symbol).join(', ');
  sendWhatsApp(`🤖 [5m Trade] Bot iniciado\nSímbolos: ${symbolList}`);

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
