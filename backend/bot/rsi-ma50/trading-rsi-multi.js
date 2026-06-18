'use strict';

/**
 * Bot único AMAP — Adaptive MA Pullback
 *
 * Toda estratégia é trade_config (Supabase) ou preset nomeado (strategyPresets.js).
 * Motor: strategyEngine.js
 *
 * Modo bot     : node backend/bot/rsi-ma50/trading-rsi-multi.js
 * Filtrar      : node backend/bot/rsi-ma50/trading-rsi-multi.js --symbol BTCUSDT
 * Backtest     : node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest BTCUSDT [saved|presetId] [exchange] [capital]
 *                (omitir preset ou usar saved/flex → config do Supabase)
 * Adaptativo   : node backend/bot/rsi-ma50/trading-rsi-multi.js --adaptive-test BTCUSDT binance 1h 4h
 *
 * Presets: flex, rsi15m_4h, rsi5m30_15m70, rsi1h35_15m85, rsi1m30_1m70, rsi1m30_1m70_ma, rsi1m30_1m80
 */

// ─────────────────────────────────────────────────────────────────────────────

const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { sendWhatsApp } = require('../whatsapp');
const {
  buildTradeConfig, getRequiredSpecs, computeAdaptiveDips, buildMaSnapshot, buildAdaptiveReport,
  evaluateEntry, evaluateExit, getStopLossMa, checkRsi, checkMinVolume, needsMarketSell, maKey,
} = require('./strategyEngine');
const { fmtVolumeUsdt } = require('../volume24h');
const {
  configFromPreset, configFromRow, resolveStrategy, hasAdaptiveFilters, listPresetsForCli, presetIds,
} = require('./strategyPresets');

const DB_BACKTEST_SOURCES = new Set(['saved', 'db', 'supabase', 'flex']);
const EXCHANGES           = new Set(['binance', 'gate']);

function parseBacktestArgs(argv) {
  const symbol = argv[1]?.toUpperCase();
  const a2     = argv[2];

  if (!a2) {
    return { symbol, fromDb: true, exchange: null, capital: null, presetId: null };
  }
  if (DB_BACKTEST_SOURCES.has(a2)) {
    let exchange = null;
    let capital  = null;
    if (argv[3]) {
      if (EXCHANGES.has(argv[3])) {
        exchange = argv[3];
        if (argv[4]) capital = parseFloat(argv[4]);
      } else {
        capital = parseFloat(argv[3]);
      }
    }
    return { symbol, fromDb: true, exchange, capital, presetId: null };
  }
  if (EXCHANGES.has(a2)) {
    return { symbol, fromDb: true, exchange: a2, capital: argv[3] ? parseFloat(argv[3]) : null, presetId: null };
  }
  if (presetIds().includes(a2)) {
    return {
      symbol, fromDb: false, presetId: a2,
      exchange: argv[3] ?? 'binance',
      capital:  parseFloat(argv[4] ?? '100'),
    };
  }
  return { error: a2 };
}

async function backtestFromSupabase(symbol, exchangeHint, capitalHint) {
  if (!SB_URL || !SB_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  const row = await loadSavedBacktestRow(symbol, exchangeHint);
  if (!row) {
    console.error(`❌ ${symbol} não encontrado no Supabase (rsi_multi_bot_state / multitrade_favorites).`);
    console.error('   Salve no painel Multi-Trade ou use um preset: --backtest SYM rsi5m30_15m70 binance 100');
    process.exit(1);
  }

  const config = configFromRow(row);
  if (!config) {
    console.error(`❌ ${symbol}: sem trade_config nem preset válido (strategy_id=${row.strategy_id})`);
    process.exit(1);
  }

  const exchange = exchangeHint ?? row.exchange ?? 'binance';
  const capital  = capitalHint ?? parseFloat(row.capital ?? 100);
  const source   = row.trade_config ? 'trade_config' : `preset:${row.strategy_id}`;

  console.log(`\n📦 Supabase: ${symbol} [${exchange}]  strategy=${row.strategy_id ?? 'flex'}  (${source})`);
  console.log(`   Capital: $${capital}`);
  await backtest(symbol, config, exchange, capital);
}

async function refreshAdaptiveDips(adapter, config) {
  const specs = getRequiredSpecs(config).map(s => ({ ...s, limit: Math.max(s.limit, 300) }));
  const cMap  = await fetchCandleMap(adapter, specs);
  return computeAdaptiveDips(cMap, config);
}

async function getCached24hVolume(adapter, session) {
  const now = Date.now();
  if (session.volCache && now - session.volCache.ts < VOL_CACHE_MS) {
    return session.volCache.volumeUsdt;
  }
  const volumeUsdt = await adapter.fetch24hVol();
  session.volCache = { ts: now, volumeUsdt };
  return volumeUsdt;
}

async function checkEntryVolume(adapter, config, session) {
  try {
    const volumeUsdt = await getCached24hVolume(adapter, session);
    return { ...checkMinVolume(volumeUsdt, config), volumeUsdt };
  } catch {
    return { allowed: true, reason: null, volumeUsdt: null };
  }
}

async function executeMarketSell(adapter, config, session, qty, log) {
  let aggressive = !!config.allowLowVolume;
  if (!aggressive) {
    try {
      const vol = await getCached24hVolume(adapter, session);
      aggressive = needsMarketSell(config, vol);
    } catch {}
  }
  return adapter.marketSell(qty, log, { aggressive });
}

const GATE_FEE_RATE = 0.002;
const VOL_CACHE_MS  = 5 * 60_000;

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';
const COLORS = ['\x1b[94m','\x1b[93m','\x1b[95m','\x1b[96m','\x1b[92m','\x1b[91m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[34m'];

function nowFmt() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtDur(ms) {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}min` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

function fmtP(n) {
  if (n == null) return '—';
  return n < 0.01 ? Number(n).toFixed(6) : n < 1 ? Number(n).toFixed(4) : Number(n).toFixed(2);
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function makeLogger(symbol, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-multi.txt`);
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
    const data = await fetch(`${BINANCE_BASE}/api/v3/time`).then(r => r.json());
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
  const res  = await fetch(url, {
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

async function binanceMarketSell(symbol, qty, log, { aggressive = false } = {}) {
  const info      = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const decimals  = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 0) : 0;
  const safeQty   = (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
  if (aggressive && log) log(`📉 Venda MARKET (baixa liquidez) qty=${safeQty}`);
  const order     = await binanceReq('POST', '/api/v3/order', {
    symbol, side: 'SELL', type: 'MARKET', quantity: safeQty,
  });
  const soldQty = parseFloat(order.executedQty);
  const usdtOut = parseFloat(order.cummulativeQuoteQty);
  return { soldQty, usdtOut, exitPrice: soldQty > 0 ? usdtOut / soldQty : 0 };
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
    const data = await fetch(`${GATE_BASE}/spot/time`).then(r => r.json());
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
  let url = `${GATE_BASE}${endpointPath}`;
  let qs  = '';
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

async function gateMarketBuy(pair, usdtAmount) {
  const ticker     = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  const price      = parseFloat(ticker[0]?.last);
  if (!price) throw new Error(`Gate.io: preço inválido para ${pair}`);
  const limitPrice = parseFloat((price * 1.005).toFixed(8));
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
  if (grossQty <= 0) throw new Error(`Gate.io: compra não preenchida (status=${filled.status})`);
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
        log(`📉 Venda IOC no bid $${fmtP(bid)} (baixa liquidez)`);
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
    currency_pair: pair, side: 'sell', type: 'market', amount: sellQty.toFixed(8),
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
      name:        'Gate.io',
      pair,
      fetchCandles: (lim, iv)  => fetchGateCandles(pair, lim, iv),
      marketBuy:    (usdt)     => gateMarketBuy(pair, usdt),
      marketSell:   (qty, log, opts) => gateMarketSell(pair, qty, log, opts),
      fetch24hVol:  ()         => gate24hVolume(pair),
    };
  }
  return {
    name:        'Binance',
    pair:        symbol,
    fetchCandles: (lim, iv)   => fetchBinanceCandles(symbol, lim, iv),
    marketBuy:    (usdt)      => binanceMarketBuy(symbol, usdt),
    marketSell:   (qty, log, opts) => binanceMarketSell(symbol, qty, log, opts),
    fetch24hVol:  ()          => binance24hVolume(symbol),
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

async function loadAllRows()  { return sbReq('GET', 'rsi_multi_bot_state', null, '?order=id.asc'); }
async function loadState(id)  { const r = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${id}&limit=1`); return r?.[0] ?? null; }

/** Carrega config salva no Supabase (bot state → multitrade favorites) */
async function loadSavedBacktestRow(symbol, exchange = null) {
  const sym = symbol.toUpperCase();
  const botQ = exchange
    ? `?symbol=eq.${sym}&exchange=eq.${exchange}&order=updated_at.desc&limit=1`
    : `?symbol=eq.${sym}&order=updated_at.desc&limit=1`;
  const botRows = await sbReq('GET', 'rsi_multi_bot_state', null, botQ);
  if (botRows?.[0]) return botRows[0];

  const favQ = exchange
    ? `?symbol=eq.${sym}&exchange=eq.${exchange}&order=updated_at.desc&limit=1`
    : `?symbol=eq.${sym}&order=updated_at.desc&limit=1`;
  const favRows = await sbReq('GET', 'multitrade_favorites', null, favQ);
  return favRows?.[0] ?? null;
}

async function saveState(id, u) { await sbReq('PATCH', 'rsi_multi_bot_state', { ...u, updated_at: new Date().toISOString() }, `?id=eq.${id}`); }

async function insertEntrySignal(data) {
  try {
    const r = await sbReq('POST', 'rsi_multi_entry_signals', data);
    return r?.[0]?.id ?? null;
  } catch (err) { console.warn(`[${data.symbol}] insertEntrySignal:`, err.message); return null; }
}

async function patchEntrySignal(id, data) {
  if (!id) return;
  try { await sbReq('PATCH', 'rsi_multi_entry_signals', data, `?id=eq.${id}`); }
  catch (err) { console.warn(`[entry#${id}] patchEntrySignal:`, err.message); }
}

async function insertExitSignal(data) {
  try {
    const r = await sbReq('POST', 'rsi_multi_exit_signals', data);
    return r?.[0]?.id ?? null;
  } catch (err) { console.warn(`[${data.symbol}] insertExitSignal:`, err.message); return null; }
}

async function patchExitSignal(id, data) {
  if (!id) return;
  try { await sbReq('PATCH', 'rsi_multi_exit_signals', data, `?id=eq.${id}`); }
  catch (err) { console.warn(`[exit#${id}] patchExitSignal:`, err.message); }
}

async function insertTrade(t) {
  try {
    const r = await sbReq('POST', 'rsi_multi_bot_trades', t);
    return r?.[0]?.id ?? null;
  } catch (err) { console.warn(`[${t.symbol}] insertTrade:`, err.message); return null; }
}

function entrySignalFields(state, rowId, { price, entryRsi, exitRsi, ma50, ma2, candleOpenTime }) {
  return {
    symbol:           state.symbol,
    exchange:         state.exchange ?? 'binance',
    strategy_id:      state.strategy_id,
    state_id:         rowId,
    candle_open_time: candleOpenTime ? new Date(candleOpenTime).toISOString() : null,
    price,
    rsi_entry:        entryRsi,
    rsi_exit:         exitRsi,
    ma50,
    ma2,
    above_ma_pct:     ma50 ? parseFloat(((price / ma50 - 1) * 100).toFixed(4)) : null,
  };
}

// ── Indicadores ───────────────────────────────────────────────────────────────

// Retorna [{openTime, close, rsi}] alinhado às candles que têm RSI válido.
function computeRsiSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period });
  return rsiArr.map((rsi, i) => ({
    openTime: candles[period + i].openTime,
    close:    candles[period + i].close,
    rsi,
  }));
}

// RSI de saída mais recente que ainda não ultrapassa entryTime.
// exitSeries deve estar ordenado por openTime crescente.
function exitRsiAt(exitSeries, entryTime) {
  let best = null;
  for (let i = 0; i < exitSeries.length; i++) {
    if (exitSeries[i].openTime <= entryTime) best = exitSeries[i].rsi;
    else break;
  }
  return best;
}

// Retorna [{openTime, ma}] — SMA[i] cobre closes[0..period-1+i].
function computeMaSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const maArr  = ti.SMA.calculate({ values: closes, period });
  return maArr.map((ma, i) => ({ openTime: candles[period - 1 + i].openTime, ma }));
}

// MA mais recente disponível em ou antes de `time`.
function maAt(maSeries, time) {
  let best = null;
  for (const point of maSeries) {
    if (point.openTime <= time) best = point.ma;
    else break;
  }
  return best;
}

// Busca candles de múltiplos intervalos em paralelo, sem duplicar fetches.
// specs: [{interval, limit}, ...]  — usa o maior limit por intervalo.
async function fetchCandleMap(adapter, specs) {
  const maxLimits = {};
  for (const { interval, limit } of specs) {
    maxLimits[interval] = Math.max(maxLimits[interval] || 0, limit);
  }
  const entries = await Promise.all(
    Object.entries(maxLimits).map(async ([iv, lim]) => [iv, await adapter.fetchCandles(lim, iv)]),
  );
  return Object.fromEntries(entries);
}

// ── Backtest ──────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '../../data/candlestick');

// Carrega arquivo local se existir: backend/data/candlestick/{SYMBOL}-{interval}.json
// Retorna null se não existir.
function loadLocalCandles(symbol, interval) {
  const filePath = path.join(DATA_DIR, `${symbol}-${interval}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const arr = Array.isArray(raw) ? raw : Object.values(raw)[0];
  return arr.map(c => ({
    openTime: Number(c.openTime ?? c[0]),
    open:  parseFloat(c.open  ?? c[1]),
    high:  parseFloat(c.high  ?? c[2]),
    low:   parseFloat(c.low   ?? c[3]),
    close: parseFloat(c.close ?? c[4]),
  }));
}

function maSnapAt(cMap, config, openTime) {
  const snap = {};
  const add = (key, period, interval) => {
    const candles = (cMap[interval] ?? []).filter(c => c.openTime <= openTime);
    if (!candles.length) return;
    const series = computeMaSeries(candles, period);
    const ma = maAt(series, openTime);
    snap[key] = { ma, candles, period, interval };
  };
  for (const f of config.maFilters ?? []) {
    add(maKey(f.period, f.interval), f.period, f.interval);
  }
  if (config.extension?.enabled) {
    const iv = config.extension.maInterval;
    if (!snap[maKey(50, iv)]) add(maKey(50, iv), 50, iv);
  }
  const sl = config.stopLoss;
  if (sl) add(`sl_${maKey(sl.period, sl.interval)}`, sl.period, sl.interval);
  return snap;
}

async function backtest(symbol, config, exchange = 'binance', capital = 100) {
  const adapter = buildAdapter(exchange, symbol);
  const specs   = getRequiredSpecs(config);
  const LIMIT   = 1000;

  console.log(`\n${'─'.repeat(68)}`);
  console.log(`📊 Backtest AMAP: ${symbol} [${adapter.name}]  —  ${config.label ?? 'flex'}`);
  console.log(`   Entrada: RSI(${config.entryRsi.interval})${config.entryRsi.operator}${config.entryRsi.value}`);
  console.log(`   Saída  : RSI(${config.exitRsi.interval})${config.exitRsi.operator}${config.exitRsi.value}`);
  console.log(`   Stop   : MA${config.stopLoss.period}(${config.stopLoss.interval})`);
  console.log(`   Vol mín: ${fmtVolumeUsdt(config.minVolumeUsdt ?? 1_000_000)} 24h (não simulado no histórico)`);

  const cMap = {};
  for (const { interval, limit } of specs) {
    const local = loadLocalCandles(symbol, interval);
    cMap[interval] = local ?? await adapter.fetchCandles(Math.max(limit, LIMIT), interval);
    console.log(`   ${interval}: ${cMap[interval].length} candles`);
  }

  const entryCandles = cMap[config.entryRsi.interval];
  const exitCandles  = cMap[config.exitRsi.interval];
  if (!entryCandles?.length) { console.error('   ❌ Sem candles de entrada'); return; }

  const entrySeries = computeRsiSeries(entryCandles, config.entryRsi.period);
  const exitSeries  = config.entryRsi.interval === config.exitRsi.interval && config.entryRsi.period === config.exitRsi.period
    ? entrySeries
    : computeRsiSeries(exitCandles, config.exitRsi.period);

  const adaptiveDips = computeAdaptiveDips(cMap, config);

  let phase = 'WATCHING';
  let buyPrice = null, buyQty = null, buyUsdt = null;
  let triggerPrice = null, limitPrice = null, pendingSince = null;
  const trades = [], signals = [];
  const startCapital = capital;
  let blockedCount = 0;
  let pendingSignal = null;
  let openSignalIdx = null;

  const botOpts = {
    entryDiscount:    config.entryDiscount    ?? 0.001,
    immediateEntry:   config.immediateEntry   ?? false,
    pendingTimeoutMs: config.pendingTimeoutMs ?? 30 * 60_000,
    pendingCancelPct: config.pendingCancelPct ?? 0.002,
  };

  for (const { openTime, close, rsi: entryRsi } of entrySeries) {
    const exitRsi  = exitRsiAt(exitSeries, openTime);
    const maSnap   = maSnapAt(cMap, config, openTime);
    const stopLossMa = getStopLossMa(maSnap, config);

    if (phase === 'WATCHING') {
      if (!checkRsi(entryRsi, config.entryRsi)) continue;

      const entryCheck = evaluateEntry({
        entryRsi, close, entryTimeMs: openTime, config, maSnap, adaptiveDips,
      });
      if (!entryCheck.allowed) {
        blockedCount++;
        signals.push({ entryTime: openTime, entryRsi, entryPrice: close, result: entryCheck.reason });
        continue;
      }

      if (botOpts.immediateEntry) {
        openSignalIdx = signals.length;
        signals.push({ entryTime: openTime, entryRsi, entryPrice: close, buyTime: openTime, buyPrice: close, result: 'BOUGHT' });
        buyPrice = close; buyQty = capital / close; buyUsdt = capital;
        phase = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi });
      } else {
        triggerPrice = close;
        limitPrice   = parseFloat((close * (1 - botOpts.entryDiscount)).toFixed(8));
        pendingSince = openTime;
        pendingSignal = { entryTime: openTime, entryRsi, entryPrice: close };
        phase = 'PENDING';
      }

    } else if (phase === 'PENDING') {
      const elapsedMs  = openTime - pendingSince;
      const cancelLine = triggerPrice * (1 + botOpts.pendingCancelPct);
      if (close > cancelLine || elapsedMs > botOpts.pendingTimeoutMs) {
        const reason = close > cancelLine ? 'CANCELLED_RECOVERY' : 'CANCELLED_TIMEOUT';
        if (pendingSignal) { signals.push({ ...pendingSignal, result: reason }); pendingSignal = null; }
        phase = 'WATCHING';
        triggerPrice = limitPrice = pendingSince = null;
      } else if (close <= limitPrice) {
        openSignalIdx = signals.length;
        signals.push({ ...pendingSignal, buyTime: openTime, buyPrice: close, result: 'BOUGHT' });
        pendingSignal = null;
        buyPrice = close; buyQty = capital / close; buyUsdt = capital;
        phase = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi });
        triggerPrice = limitPrice = pendingSince = null;
      }

    } else if (phase === 'BOUGHT') {
      const exitEval = evaluateExit({ close, exitRsi, stopLossMa, config });
      if (exitEval.exit) {
        const usdtOut = buyQty * close;
        const pnl     = usdtOut - buyUsdt;
        capital += pnl;
        if (openSignalIdx !== null) {
          signals[openSignalIdx].exitTime  = openTime;
          signals[openSignalIdx].exitPrice = close;
          signals[openSignalIdx].exitRsi   = exitRsi;
          signals[openSignalIdx].pnlPct    = (pnl / buyUsdt) * 100;
          if (exitEval.reason === 'stop_loss_ma') signals[openSignalIdx].result = 'STOP_LOSS_MA';
          openSignalIdx = null;
        }
        trades.push({
          type: 'SELL', time: openTime, price: close, exitRsi,
          stopLoss: exitEval.reason === 'stop_loss_ma',
          pnlUsdt: pnl, pnlPct: (pnl / buyUsdt) * 100, capitalAfter: capital,
        });
        phase = 'WATCHING';
        buyPrice = buyQty = buyUsdt = null;
      }
    }
  }

  if (pendingSignal) signals.push({ ...pendingSignal, result: 'PENDING_OPEN' });
  if (phase === 'BOUGHT' && openSignalIdx !== null) signals[openSignalIdx].result = 'POSITION_OPEN';

  const sells    = trades.filter(t => t.type === 'SELL');
  const wins     = sells.filter(t => t.pnlUsdt >= 0).length;
  const totalPnl = sells.reduce((s, t) => s + t.pnlUsdt, 0);
  const winRate  = sells.length ? ((wins / sells.length) * 100).toFixed(1) : '—';
  const totalPct = ((capital / startCapital - 1) * 100).toFixed(2);
  const pSign    = totalPnl >= 0 ? '+' : '';

  console.log(`\n   Capital  : $${startCapital.toFixed(2)} → $${capital.toFixed(2)}  (${pSign}${totalPct}%)`);
  console.log(`   Trades   : ${sells.length}  |  Wins: ${wins}  Losses: ${sells.length - wins}  |  Win rate: ${winRate}%`);
  console.log(`   PnL total: ${pSign}$${totalPnl.toFixed(2)}`);
  if (blockedCount) console.log(`   Bloqueados (MA/extensão): ${blockedCount} sinais`);
  if (sells.filter(t => t.stopLoss).length) {
    console.log(`   Stop Loss (MA): ${sells.filter(t => t.stopLoss).length} saída(s)`);
  }
}

// ── Tick (loop ao vivo) ───────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, log, prevExitRsi, session) {
  const { config } = strategy;
  const specs = getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);

  const entryIv  = config.entryRsi.interval;
  const exitIv   = config.exitRsi.interval;
  const entryCandles = cMap[entryIv];
  const exitCandles  = cMap[exitIv];
  if (!entryCandles?.length || !exitCandles?.length) {
    log('Dados insuficientes.'); return { entryRsi: null, exitRsi: prevExitRsi };
  }

  const entryCloses = entryCandles.map(c => c.close);
  const exitCloses  = exitCandles.map(c => c.close);
  const entryRsiArr = ti.RSI.calculate({ values: entryCloses, period: config.entryRsi.period });
  const exitRsiArr  = ti.RSI.calculate({ values: exitCloses,  period: config.exitRsi.period });
  const entryRsi    = entryRsiArr[entryRsiArr.length - 1];
  const exitRsi     = exitRsiArr[exitRsiArr.length - 1];
  const close       = entryCloses[entryCloses.length - 1];
  const candleMs    = entryCandles[entryCandles.length - 1]?.openTime ?? null;

  if (entryRsi == null || exitRsi == null) return { entryRsi, exitRsi: prevExitRsi };

  const adaptiveDips = session.adaptiveDips ?? computeAdaptiveDips(cMap, config);
  const maSnap       = buildMaSnapshot(cMap, config);
  const stopLossMa   = getStopLossMa(maSnap, config);

  const state = await loadState(rowId);
  if (!state) { log('❌ Linha não encontrada.'); return { entryRsi, exitRsi }; }

  const { phase, capital, symbol } = state;
  const exitColor = exitRsi >= strategy.fastRsiThreshold ? Y : '';
  const rsiEntryHit = checkRsi(entryRsi, config.entryRsi);

  if (phase === 'WATCHING') {
    log(
      `${rsiEntryHit ? G : ''}RSI(${entryIv})=${entryRsi.toFixed(1)}${rsiEntryHit ? X : ''}` +
      `  ${exitColor}RSI(${exitIv})=${exitRsi.toFixed(1)}${exitColor ? X : ''}` +
      `  $${fmtP(close)}  capital=$${parseFloat(capital).toFixed(2)}  [WATCHING|AMAP]`,
    );

    if (rsiEntryHit) {
      const sigBase = () => entrySignalFields(state, rowId, {
        price: close, entryRsi, exitRsi, ma50: null, ma2: null, candleOpenTime: candleMs,
      });
      const newCandle = session.entryCandleMs !== candleMs;
      const entryCheck = evaluateEntry({
        entryRsi, close, entryTimeMs: Date.now(), config, maSnap, adaptiveDips,
      });

      if (!entryCheck.allowed) {
        const reasons = {
          MA_BLOCKED:            'preço abaixo da MA (fixo)',
          MA_ADAPTIVE_BLOCKED:   `preço abaixo do piso adaptativo (−${entryCheck.dipPct?.toFixed(1) ?? '?'}%)`,
          THREE_CANDLES_BLOCKED: 'extensão acima da MA sem confirmação 3/4 candles',
          MA_NO_DATA:            'sem dados de MA',
          RSI_NOT_MET:           'RSI não atende',
        };
        log(`${Y}⚠️  Entrada bloqueada: ${reasons[entryCheck.reason] ?? entryCheck.reason}${X}`);
        if (newCandle) {
          session.entryCandleMs = candleMs;
          await insertEntrySignal({ ...sigBase(), status: 'blocked', block_reason: entryCheck.reason });
        }
        return { entryRsi, exitRsi, phase: 'WATCHING' };
      }

      const volCheck = await checkEntryVolume(adapter, config, session);
      if (!volCheck.allowed) {
        log(`${Y}⚠️  Entrada bloqueada: volume 24h ${fmtVolumeUsdt(volCheck.volumeUsdt)} < mínimo ${fmtVolumeUsdt(volCheck.minVolumeUsdt)}${X}`);
        if (newCandle) {
          session.entryCandleMs = candleMs;
          await insertEntrySignal({ ...sigBase(), status: 'blocked', block_reason: 'VOLUME_LOW' });
        }
        return { entryRsi, exitRsi, phase: 'WATCHING' };
      }

      if (newCandle) session.entryCandleMs = candleMs;

      if (strategy.immediateEntry) {
        let result;
        try { result = await adapter.marketBuy(parseFloat(capital)); }
        catch (err) { log(`❌ Erro na compra: ${err.message}`); return { entryRsi, exitRsi, phase: 'WATCHING' }; }
        const { filledQty, quoteQty, avgPrice } = result;
        const now = new Date().toISOString();
        session.activeEntrySignalId = await insertEntrySignal({
          ...sigBase(), status: 'executed', immediate_entry: true,
          executed_at: now, executed_price: avgPrice, executed_qty: filledQty, executed_usdt: quoteQty,
        });
        await saveState(rowId, {
          phase: 'BOUGHT', buy_price: avgPrice, buy_qty: filledQty, buy_usdt: quoteQty,
          buy_time: now, rsi_entry: entryRsi,
          trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
        });
        log(`${G}🟢 COMPRA IMEDIATA [AMAP]${X}  $${fmtP(avgPrice)}`);
        return { entryRsi, exitRsi, phase: 'BOUGHT' };
      }

      const limitPrice = parseFloat((close * (1 - strategy.entryDiscount)).toFixed(8));
      const pendingSince = new Date().toISOString();
      session.activeEntrySignalId = await insertEntrySignal({
        ...sigBase(), status: 'pending',
        trigger_price: close, limit_price: limitPrice, pending_since: pendingSince,
      });
      await saveState(rowId, {
        phase: 'PENDING', trigger_price: close, limit_price: limitPrice,
        trigger_rsi: entryRsi, pending_since: pendingSince,
      });
      log(`${G}🎯 PENDING [AMAP] alvo $${fmtP(limitPrice)}${X}`);
      return { entryRsi, exitRsi, phase: 'PENDING' };
    }
    return { entryRsi, exitRsi, phase: 'WATCHING' };
  }

  if (phase === 'PENDING') {
    const limitPrice   = parseFloat(state.limit_price);
    const triggerPrice = parseFloat(state.trigger_price);
    const pendingMs    = Date.now() - new Date(state.pending_since).getTime();
    const cancelLine   = triggerPrice * (1 + strategy.pendingCancelPct);

    if (close > cancelLine || pendingMs > strategy.pendingTimeoutMs) {
      const blockReason = close > cancelLine ? 'CANCELLED_RECOVERY' : 'CANCELLED_TIMEOUT';
      await patchEntrySignal(session.activeEntrySignalId, { status: 'cancelled', block_reason: blockReason, pending_until: new Date().toISOString() });
      session.activeEntrySignalId = null;
      await saveState(rowId, { phase: 'WATCHING', trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null });
      return { entryRsi, exitRsi, phase: 'WATCHING' };
    }
    if (close <= limitPrice) {
      const volCheck = await checkEntryVolume(adapter, config, session);
      if (!volCheck.allowed) {
        log(`${Y}⚠️  Compra bloqueada: volume 24h ${fmtVolumeUsdt(volCheck.volumeUsdt)} < mínimo ${fmtVolumeUsdt(volCheck.minVolumeUsdt)}${X}`);
        return { entryRsi, exitRsi, phase: 'PENDING' };
      }
      let result;
      try { result = await adapter.marketBuy(parseFloat(capital)); }
      catch (err) { log(`❌ Erro na compra: ${err.message}`); return { entryRsi, exitRsi, phase: 'PENDING' }; }
      const { filledQty, quoteQty, avgPrice } = result;
      const now = new Date().toISOString();
      await patchEntrySignal(session.activeEntrySignalId, {
        status: 'executed', pending_until: now,
        executed_at: now, executed_price: avgPrice, executed_qty: filledQty, executed_usdt: quoteQty,
      });
      await saveState(rowId, {
        phase: 'BOUGHT', buy_price: avgPrice, buy_qty: filledQty, buy_usdt: quoteQty,
        buy_time: now, rsi_entry: entryRsi,
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      return { entryRsi, exitRsi, phase: 'BOUGHT' };
    }
    return { entryRsi, exitRsi, phase: 'PENDING' };
  }

  if (phase === 'BOUGHT') {
    const buyPrice  = parseFloat(state.buy_price);
    const exitEval  = evaluateExit({ close, exitRsi, stopLossMa, config });
    const pnlPct    = ((close - buyPrice) / buyPrice * 100).toFixed(2);

    log(
      `RSI(${entryIv})=${entryRsi.toFixed(1)}  RSI(${exitIv})=${exitRsi.toFixed(1)}` +
      `  $${fmtP(close)}  PnL=${pnlPct}%  [BOUGHT|AMAP]`,
    );

    if (exitEval.exit) {
      const stopLossHit = exitEval.reason === 'stop_loss_ma';
      let result;
      try { result = await executeMarketSell(adapter, config, session, parseFloat(state.buy_qty), log); }
      catch (err) { log(`❌ Erro na venda: ${err.message}`); return { entryRsi, exitRsi, phase: 'BOUGHT' }; }

      const { soldQty, usdtOut, exitPrice } = result;
      const capitalBefore = parseFloat(capital);
      const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
      const capitalAfter  = capitalBefore + pnlUsdt;
      const exitTime      = new Date().toISOString();
      const durationMs    = state.buy_time ? Date.now() - new Date(state.buy_time).getTime() : null;

      const exitSignalId = await insertExitSignal({
        symbol, exchange: state.exchange ?? 'binance', strategy_id: state.strategy_id ?? 'flex',
        state_id: rowId, entry_signal_id: session.activeEntrySignalId ?? null,
        signal_type: stopLossHit ? 'stop_loss' : 'rsi', price: close, rsi_exit: exitRsi,
        stop_loss_ma: stopLossMa, buy_price: buyPrice, status: 'executed',
        executed_at: exitTime, executed_price: exitPrice, executed_qty: soldQty, executed_usdt: usdtOut,
      });

      const tradeId = await insertTrade({
        symbol, exchange: state.exchange, strategy_id: state.strategy_id ?? 'flex',
        entry_time: state.buy_time, exit_time: exitTime,
        entry_price: buyPrice, exit_price: exitPrice,
        qty: soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: usdtOut,
        pnl_usdt: pnlUsdt, pnl_pct: parseFloat((pnlUsdt / parseFloat(state.buy_usdt) * 100).toFixed(2)),
        capital_before: capitalBefore, capital_after: capitalAfter,
        rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: exitRsi,
        exit_reason: exitEval.reason, duration_ms: durationMs,
        entry_signal_id: session.activeEntrySignalId, exit_signal_id: exitSignalId,
      });

      if (session.activeEntrySignalId) await patchEntrySignal(session.activeEntrySignalId, { trade_id: tradeId });
      session.activeEntrySignalId = null;
      await saveState(rowId, {
        phase: 'WATCHING', capital: capitalAfter,
        buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
      });
      log(`${stopLossHit ? '🛑' : '🔴'} VENDA [AMAP] PnL=$${pnlUsdt.toFixed(2)}`);
      return { entryRsi, exitRsi, phase: 'WATCHING' };
    }
    return { entryRsi, exitRsi, phase: 'BOUGHT' };
  }

  return { entryRsi, exitRsi, phase };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color) {
  const strategy = resolveStrategy(row);
  if (!strategy) {
    console.error(`❌ strategy_id "${row.strategy_id}" desconhecida para ${row.symbol}`);
    return;
  }

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, color);

  log(
    `=== AMAP Bot | ${adapter.name} | ${adapter.pair}` +
    ` | ${strategy.label}` +
    ` | poll: ${strategy.pollMs / 1000}s/${strategy.fastPollMs / 1000}s | fase: ${row.phase} ===`,
  );

  if (row.phase === 'BOUGHT')
    log(`♻️  Posição aberta — comprado a $${fmtP(row.buy_price)} | qty=${row.buy_qty}`);
  if (row.phase === 'PENDING') {
    const ms = Date.now() - new Date(row.pending_since).getTime();
    log(`♻️  PENDING — alvo=$${fmtP(row.limit_price)} | gatilho=$${fmtP(row.trigger_price)} | há ${fmtDur(ms)}`);
  }
  if (strategy.config.allowLowVolume) {
    log(`ℹ️  Volume baixo autorizado — saída sempre a mercado`);
  }

  let lastResult = { entryRsi: null, exitRsi: null, phase: row.phase };
  let errCount   = 0;
  const session  = { entryCandleMs: null, activeEntrySignalId: null, adaptiveDips: null };

  if (hasAdaptiveFilters(strategy.config)) {
    try {
      session.adaptiveDips = await refreshAdaptiveDips(adapter, strategy.config);
      const dips = Object.entries(session.adaptiveDips).map(([k, v]) => `${k}:${v}%`).join(' ');
      log(`📐 Dips adaptativos: ${dips || 'nenhum'}`);
      setInterval(async () => {
        try { session.adaptiveDips = await refreshAdaptiveDips(adapter, strategy.config); }
        catch {}
      }, 24 * 60 * 60_000);
    } catch (err) {
      log(`⚠️  Dips adaptativos: ${err.message}`);
    }
  }

  const schedule = () => {
    const { phase, exitRsi } = lastResult;
    const fast  = phase === 'PENDING' || (exitRsi !== null && exitRsi >= strategy.fastRsiThreshold);
    setTimeout(run, fast ? strategy.fastPollMs : strategy.pollMs);
  };

  const run = async () => {
    try {
      lastResult = await tick(row.id, adapter, strategy, log, lastResult.exitRsi, session);
      errCount   = 0;
    } catch (err) {
      errCount++;
      if (errCount <= 3) log(`❌ Tick error: ${err.message}`);
      else if (errCount === 4) log(`❌ Erros repetidos — verifique se ${adapter.pair} existe na ${adapter.name}.`);
    }
    schedule();
  };

  await run();
}

async function runAdaptiveTest(symbol, exchange, intervals) {
  const adapter = buildAdapter(exchange, symbol);
  const config  = buildTradeConfig({
    maConditions: intervals.map(iv => ({ period: 50, interval: iv, adaptive: true })),
  });
  const specs = getRequiredSpecs(config);
  const cMap  = {};
  await Promise.all(specs.map(async ({ interval, limit }) => {
    cMap[interval] = await adapter.fetchCandles(Math.max(limit, 300), interval);
  }));

  console.log(`\n${'─'.repeat(68)}`);
  console.log(`📐 AMAP — Teste adaptativo: ${symbol} [${adapter.name}]`);

  const reports = buildAdaptiveReport(cMap, config);
  if (!reports.length) {
    console.log('   Nenhum filtro MA adaptativo na config.');
    return;
  }

  for (const r of reports) {
    const candles = cMap[r.interval];
    const close   = candles[candles.length - 1].close;
    const ma      = r.currentMa;
    const floor   = ma != null ? ma * (1 - r.dipPct / 100) : null;
    const dipNow  = ma != null ? (ma - close) / ma * 100 : null;

    console.log(`\n   ── MA${r.period}(${r.interval}) ─────────────────────────────────────`);
    console.log(`   Episódios         : ${r.episodeCount ?? r.episodes?.length ?? 0}`);
    if (r.usedDefault) {
      console.log(`   Threshold         : ${r.dipPct}% (padrão — ${r.reason})`);
    } else {
      console.log(`   Média dos dips    : ${r.avgRaw}%`);
      console.log(`   Threshold (clamp) : ${r.dipPct}%`);
    }
    if (r.episodes?.length) {
      const top = [...r.episodes].sort((a, b) => b.maxDipPct - a.maxDipPct).slice(0, 5);
      console.log('   Maiores dips:');
      for (const ep of top) {
        console.log(`     ${fmtDate(ep.startTime).padEnd(22)}  ${ep.maxDipPct.toFixed(2)}%`);
      }
    }
    console.log(`   Preço atual       : $${fmtP(close)}`);
    console.log(`   MA atual          : $${fmtP(ma)}  (dip agora: ${dipNow?.toFixed(2) ?? '—'}%)`);
    console.log(`   Piso adaptativo   : $${fmtP(floor)}  (MA − ${r.dipPct}%)`);
    console.log(`   Entrada MA OK?    : ${floor != null && close >= floor ? '✅' : '❌'}`);
  }
  console.log('─'.repeat(68));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--adaptive-test') {
    const symbol    = args[1]?.toUpperCase();
    const exchange  = args[2] ?? 'binance';
    const intervals = args.length > 3 ? args.slice(3) : ['1h', '4h'];

    if (!symbol) {
      console.log('Uso: node trading-rsi-multi.js --adaptive-test <SYMBOL> [exchange] [intervals...]');
      console.log('Ex:  node trading-rsi-multi.js --adaptive-test BTCUSDT binance 1h 4h');
      process.exit(0);
    }

    await Promise.all([syncBinanceClock(), syncGateClock()]);
    await runAdaptiveTest(symbol, exchange, intervals);
    console.log();
    process.exit(0);
  }

  // ── Modo backtest ──────────────────────────────────────────────────────────
  if (args[0] === '--backtest') {
    const parsed = parseBacktestArgs(args);

    if (!parsed.symbol) {
      console.log('Uso: node trading-rsi-multi.js --backtest <SYMBOL> [saved|presetId] [exchange] [capital]');
      console.log('\n  saved / flex / (omitir) → trade_config do Supabase (painel Multi-Trade)');
      console.log('  <presetId>              → preset local (strategyPresets.js)');
      console.log('\nExemplos:');
      console.log('  node trading-rsi-multi.js --backtest BTCUSDT');
      console.log('  node trading-rsi-multi.js --backtest BTCUSDT saved binance 40');
      console.log('  node trading-rsi-multi.js --backtest BTCUSDT rsi5m30_15m70 binance 100');
      console.log('\nPresets:');
      for (const { id, label } of listPresetsForCli())
        console.log(`  ${id.padEnd(22)} ${label}`);
      process.exit(0);
    }

    if (parsed.error) {
      console.error(`❌ Opção desconhecida: "${parsed.error}". Use saved ou: ${presetIds().join(', ')}`);
      process.exit(1);
    }

    await Promise.all([syncBinanceClock(), syncGateClock()]);

    if (parsed.fromDb) {
      await backtestFromSupabase(parsed.symbol, parsed.exchange, parsed.capital);
    } else {
      const rule3 = args[5] === 'true' ? true : args[5] === 'false' ? false : null;
      const rule4 = args[6] === 'true' ? true : args[6] === 'false' ? false : null;
      const overrides = {};
      if (rule3 !== null) overrides.rule3candles = rule3;
      if (rule4 !== null) overrides.rule4candles = rule4;
      const config = configFromPreset(parsed.presetId, overrides);
      if (!config) {
        console.error(`❌ Preset "${parsed.presetId}" inválido`);
        process.exit(1);
      }
      await backtest(parsed.symbol, config, parsed.exchange, parsed.capital);
    }
    console.log();
    process.exit(0);
  }

  // ── Modo bot ───────────────────────────────────────────────────────────────
  // Filtro opcional: node trading-rsi-multi.js --symbol AVNTUSDT
  const symbolFilter = (() => {
    const idx = args.indexOf('--symbol');
    return idx !== -1 ? args[idx + 1]?.toUpperCase() : null;
  })();

  if (!SB_URL || !SB_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  await Promise.all([syncBinanceClock(), syncGateClock()]);
  setInterval(syncBinanceClock, 60 * 60_000);
  setInterval(syncGateClock,    60 * 60_000);

  let rows = await loadAllRows();
  if (!rows?.length) {
    console.error('❌ Nenhum símbolo em rsi_multi_bot_state. Execute rsi-multi-bot.sql no Supabase.');
    process.exit(1);
  }
  if (symbolFilter) {
    rows = rows.filter(r => r.symbol.toUpperCase() === symbolFilter);
    if (!rows.length) {
      console.error(`❌ Símbolo "${symbolFilter}" não encontrado em rsi_multi_bot_state.`);
      process.exit(1);
    }
    console.log(`   🔎 Filtrando apenas: ${symbolFilter}`);
  }

  console.log('\n🤖 Bot AMAP — trading-rsi-multi.js');
  console.log('   Config: trade_config (Supabase) ou preset em strategyPresets.js');
  for (const { id, label } of listPresetsForCli())
    console.log(`   • ${id}: ${label}`);
  console.log();

  const toStart = [];

  for (let i = 0; i < rows.length; i++) {
    const row      = rows[i];
    const strategy = resolveStrategy(row);
    const adapter  = buildAdapter(row.exchange ?? 'binance', row.symbol);
    const color    = COLORS[i % COLORS.length];

    if (!strategy) {
      console.log(`   ⚠️  ${row.symbol}: strategy_id="${row.strategy_id}" desconhecida — ignorado`);
      continue;
    }

    let volFmt = 'n/a', volOk = true;
    const minVol = strategy.config.minVolumeUsdt ?? 1_000_000;
    try {
      const vol = await adapter.fetch24hVol();
      volFmt    = fmtVolumeUsdt(vol);
      volOk     = vol >= minVol;
    } catch {}

    console.log(
      `   ${color}${row.symbol}${X}  exchange=${row.exchange ?? 'binance'}` +
      `  strategy=${row.strategy_id}  capital=$${parseFloat(row.capital).toFixed(2)}` +
      `  vol24h=${volFmt}  min=${fmtVolumeUsdt(minVol)}  fase=${row.phase}`,
    );

    if (!volOk && !strategy.config.allowLowVolume) {
      console.log(`   ${Y}⚠️  Volume abaixo do mínimo (${fmtVolumeUsdt(minVol)})${X}`);
      if (!symbolFilter) {
        const resp = await askUser(`   Incluir ${row.symbol} mesmo assim? [s/N]: `);
        if (resp !== 's' && resp !== 'sim') { console.log(`   ⏭️  ${row.symbol} ignorado.\n`); continue; }
      } else {
        console.log(`   ℹ️  Incluindo mesmo assim (símbolo solicitado via --symbol)`);
      }
    } else if (!volOk && strategy.config.allowLowVolume) {
      console.log(`   ${Y}ℹ️  Volume baixo — autorizado no painel (venda a mercado)${X}`);
    }

    toStart.push({ row, color });
  }

  console.log();
  if (!toStart.length) { console.error('❌ Nenhum símbolo aprovado.'); process.exit(0); }

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
