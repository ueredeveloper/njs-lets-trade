'use strict';

/**
 * Trading RSI Multi-Intervalo Bot
 *
 * Estratégias com intervalos distintos de entrada e saída.
 *
 * Modo bot  : node backend/bot/rsi-ma50/trading-rsi-multi.js
 * Backtest  : node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest BTCUSDT [strategyId] [exchange] [capital]
 *             (omitir strategyId testa todas as estratégias)
 */

// ── Estratégias ───────────────────────────────────────────────────────────────
// Edite aqui para adicionar/modificar estratégias.
// strategy_id deve corresponder ao campo strategy_id em rsi_multi_bot_state.
const STRATEGIES = {
  'rsi5m30_15m70': {
    label: 'RSI(5m)<30 → RSI(15m)>70 + MA50(1h)',
    entry:    { interval: '5m',  rsiPeriod: 14, rsiBuy: 30 },
    exit:     { interval: '15m', rsiPeriod: 14, rsiSell: 70 },
    maFilter: {
      interval: '1h', period: 50, enabled: true,
      threeCandles: { enabled: true, abovePct: 5 }, // regra dos 3 candles quando >5% acima da MA
    },
    entryDiscount:    0.001,
    pendingTimeoutMs: 30 * 60_000,
    pendingCancelPct: 0.002,
    fastRsiThreshold: 60,
    pollMs:     60_000,
    fastPollMs: 30_000,
  },
  'rsi1h35_15m85': {
    label: 'RSI(1h)<35 → RSI(15m)>85 + MA50(1h)',
    entry:    { interval: '1h',  rsiPeriod: 14, rsiBuy: 35 },
    exit:     { interval: '15m', rsiPeriod: 14, rsiSell: 85 },
    maFilter: {
      interval: '1h', period: 50, enabled: true,
      threeCandles: { enabled: true, abovePct: 5 },
    },
    entryDiscount:    0.001,
    pendingTimeoutMs: 2 * 60 * 60_000,
    pendingCancelPct: 0.005,
    fastRsiThreshold: 75,
    pollMs:     5 * 60_000,
    fastPollMs: 60_000,
  },
  'rsi1m30_1m70': {
    label: 'RSI(1m)<30 → RSI(1m)>70',
    entry:    { interval: '1m', rsiPeriod: 14, rsiBuy: 30 },
    exit:     { interval: '1m', rsiPeriod: 14, rsiSell: 70 },
    maFilter: {
      interval: '1h', period: 50, enabled: false,
      threeCandles: { enabled: true, abovePct: 5 },
    },
    entryDiscount:    0.001,
    pendingTimeoutMs: 30 * 60_000,
    pendingCancelPct: 0.002,
    fastRsiThreshold: 60,
    pollMs:     60_000,
    fastPollMs: 30_000,
  },

  // Exemplo adicional — descomente para usar:
  // 'rsi15m32_1h72': {
  //   label: 'RSI(15m)<32 → RSI(1h)>72',
  //   entry: { interval: '15m', rsiPeriod: 14, rsiBuy: 32 },
  //   exit:  { interval: '1h',  rsiPeriod: 14, rsiSell: 72 },
  //   entryDiscount: 0.001, pendingTimeoutMs: 60 * 60_000, pendingCancelPct: 0.003,
  //   fastRsiThreshold: 65, pollMs: 2 * 60_000, fastPollMs: 60_000,
  // },
};

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

const GATE_FEE_RATE = 0.002;
const VOL_MIN_USDT  = 1_000_000;

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

async function binanceMarketSell(symbol, qty) {
  const info      = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const decimals  = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 0) : 0;
  const safeQty   = (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
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

async function gateMarketSell(pair, qty, log) {
  const actualBalance = await gateGetTokenBalance(pair);
  const sellQty       = Math.min(parseFloat(qty), actualBalance);
  if (sellQty <= 0) throw new Error(`Gate.io: saldo insuficiente (disponível: ${actualBalance})`);
  if (sellQty < parseFloat(qty)) log(`⚠️  Qty ajustada: ${qty} → ${sellQty} (saldo real)`);
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
      marketSell:   (qty, log) => gateMarketSell(pair, qty, log),
      fetch24hVol:  ()         => gate24hVolume(pair),
    };
  }
  return {
    name:        'Binance',
    pair:        symbol,
    fetchCandles: (lim, iv)   => fetchBinanceCandles(symbol, lim, iv),
    marketBuy:    (usdt)      => binanceMarketBuy(symbol, usdt),
    marketSell:   (qty, _log) => binanceMarketSell(symbol, qty),
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
async function saveState(id, u) { await sbReq('PATCH', 'rsi_multi_bot_state', { ...u, updated_at: new Date().toISOString() }, `?id=eq.${id}`); }
async function insertTrade(t)   { await sbReq('POST', 'rsi_multi_bot_trades', t); }

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

/**
 * Verifica se a entrada é permitida pelo filtro MA.
 * Retorna { allowed: boolean, reason: string | null }
 *
 * Regras (quando maFilter.enabled = true):
 *   close ≤ ma50                   → bloqueado (MA_BLOCKED)
 *   close entre ma50 e ma50×(1+%)  → permitido
 *   close > ma50×(1+%) + threeCandles.enabled
 *     → exige 3 últimos 1h candles fechados com close > open
 *     → senão: bloqueado (THREE_CANDLES_BLOCKED)
 *
 * @param {number}   close
 * @param {number}   ma50
 * @param {Array}    maCandles   — candles brutas do intervalo MA (para regra dos 3)
 * @param {object}   maFilter    — config da estratégia
 * @param {number}   entryTime   — openTime da candle de entrada (ms)
 */
function checkMaFilter(close, ma50, maCandles, maFilter, entryTime) {
  if (!maFilter?.enabled) return { allowed: true, reason: null };
  if (ma50 === null)       return { allowed: false, reason: 'MA_NO_DATA' };
  if (close <= ma50)       return { allowed: false, reason: 'MA_BLOCKED' };

  const tc = maFilter.threeCandles;
  const thresholdPct = tc?.abovePct ?? 5;
  const threshold    = ma50 * (1 + thresholdPct / 100);

  if (close <= threshold) return { allowed: true, reason: null }; // zona segura (0-5%)

  // Preço > MA50 + threshold% — aplica regra dos 3 candles se habilitada
  if (!tc?.enabled) return { allowed: true, reason: null };

  const intervalMs = 3600000; // 1h em ms
  const completed  = maCandles.filter(c => c.openTime + intervalMs <= entryTime);
  const last3      = completed.slice(-3);

  if (last3.length < 3 || !last3.every(c => c.close > c.open)) {
    return { allowed: false, reason: 'THREE_CANDLES_BLOCKED' };
  }
  return { allowed: true, reason: null };
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

// maEnabledOverride: true/false para sobrescrever strategy.maFilter.enabled via CLI; null = usa o padrão da estratégia
// threeCandlesOverride: true/false para sobrescrever threeCandles.enabled via CLI; null = usa o padrão da estratégia
async function backtest(symbol, strategyId, exchange = 'binance', capital = 100, maEnabledOverride = null, threeCandlesOverride = null) {
  const base = STRATEGIES[strategyId];
  if (!base) {
    console.error(`❌ Estratégia desconhecida: "${strategyId}". Disponíveis: ${Object.keys(STRATEGIES).join(', ')}`);
    return;
  }

  // Clona para não modificar o objeto global
  const baseMA = base.maFilter ?? null;
  const strategy = {
    ...base,
    maFilter: baseMA
      ? {
          ...baseMA,
          enabled: maEnabledOverride !== null ? maEnabledOverride : baseMA.enabled,
          threeCandles: baseMA.threeCandles
            ? { ...baseMA.threeCandles, enabled: threeCandlesOverride !== null ? threeCandlesOverride : baseMA.threeCandles.enabled }
            : baseMA.threeCandles,
        }
      : null,
  };

  const adapter = buildAdapter(exchange, symbol);
  const { maFilter } = strategy;
  const maActive = maFilter?.enabled;

  console.log(`\n${'─'.repeat(68)}`);
  console.log(`📊 Backtest: ${symbol} [${adapter.name}]  —  ${strategy.label}`);
  const tcActive = maActive && maFilter?.threeCandles?.enabled;
  console.log(`   MA${maFilter?.period}(${maFilter?.interval}): ${maActive ? '✅ ativo' : '❌ desativado'}${maActive ? `  |  Regra 3 candles: ${tcActive ? '✅ ativo' : '❌ desativado'}` : ''}`);

  // Tenta carregar de arquivo local antes de chamar a API
  const intervals = [...new Set([
    strategy.entry.interval,
    strategy.exit.interval,
    ...(maActive ? [maFilter.interval] : []),
  ])];

  const LIMIT = 1000;
  const cMap = {};
  for (const iv of intervals) {
    const local = loadLocalCandles(symbol, iv);
    if (local) {
      cMap[iv] = local;
      console.log(`   📂 ${iv}: arquivo local (${local.length} candles)`);
    }
  }

  // Busca via API os intervalos que não têm arquivo local
  const apiSpecs = [
    { interval: strategy.entry.interval, limit: LIMIT },
    { interval: strategy.exit.interval,  limit: LIMIT },
    ...(maActive ? [{ interval: maFilter.interval, limit: Math.max(LIMIT, maFilter.period + 10) }] : []),
  ].filter(s => !cMap[s.interval]);

  if (apiSpecs.length) {
    const fetched = await fetchCandleMap(adapter, apiSpecs);
    Object.assign(cMap, fetched);
  }

  const entryCandles = cMap[strategy.entry.interval];
  const exitCandles  = cMap[strategy.exit.interval];

  console.log(`   Candles  : ${entryCandles.length}×${strategy.entry.interval} entrada | ${exitCandles.length}×${strategy.exit.interval} saída`);
  console.log(`   Período  : ${fmtDate(entryCandles[0].openTime)} → ${fmtDate(entryCandles[entryCandles.length - 1].openTime)}`);

  const entrySeries = computeRsiSeries(entryCandles, strategy.entry.rsiPeriod);
  const exitSeries  = (strategy.entry.interval === strategy.exit.interval &&
                       strategy.entry.rsiPeriod === strategy.exit.rsiPeriod)
    ? entrySeries
    : computeRsiSeries(exitCandles, strategy.exit.rsiPeriod);
  const maCandles = maActive ? cMap[maFilter.interval] : null;
  const maSeries  = maActive ? computeMaSeries(maCandles, maFilter.period) : null;

  let phase = 'WATCHING';
  let buyPrice = null, buyQty = null, buyUsdt = null;
  let triggerPrice = null, limitPrice = null, pendingSince = null;
  const trades   = [];
  const signals  = [];
  const startCapital = capital;
  let maBlockedCount = 0;
  let pendingSignal  = null;
  let openSignalIdx  = null; // índice em signals[] do sinal que está em BOUGHT

  for (const { openTime, close, rsi: entryRsi } of entrySeries) {
    const exitRsi = exitRsiAt(exitSeries, openTime);
    const ma50    = maSeries ? maAt(maSeries, openTime) : null;

    if (phase === 'WATCHING') {
      if (entryRsi < strategy.entry.rsiBuy) {
        const maCheck = checkMaFilter(close, ma50, maCandles, maFilter, openTime);
        if (!maCheck.allowed) {
          maBlockedCount++;
          signals.push({ entryTime: openTime, entryRsi, entryPrice: close, result: maCheck.reason });
          continue;
        }
        triggerPrice  = close;
        limitPrice    = parseFloat((close * (1 - strategy.entryDiscount)).toFixed(8));
        pendingSince  = openTime;
        pendingSignal = { entryTime: openTime, entryRsi, entryPrice: close };
        phase = 'PENDING';
      }

    } else if (phase === 'PENDING') {
      const elapsedMs  = openTime - pendingSince;
      const cancelLine = triggerPrice * (1 + strategy.pendingCancelPct);

      if (close > cancelLine || elapsedMs > strategy.pendingTimeoutMs) {
        const reason = close > cancelLine ? 'CANCELLED_RECOVERY' : 'CANCELLED_TIMEOUT';
        if (pendingSignal) { signals.push({ ...pendingSignal, result: reason }); pendingSignal = null; }
        phase = 'WATCHING';
        triggerPrice = limitPrice = pendingSince = null;
      } else if (close <= limitPrice) {
        openSignalIdx = signals.length;
        signals.push({ ...pendingSignal, buyTime: openTime, buyPrice: close, result: 'BOUGHT' });
        pendingSignal = null;
        buyPrice = close;
        buyQty   = capital / close;
        buyUsdt  = capital;
        phase = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi });
        triggerPrice = limitPrice = pendingSince = null;
      }

    } else if (phase === 'BOUGHT') {
      if (exitRsi !== null && exitRsi > strategy.exit.rsiSell) {
        const usdtOut = buyQty * close;
        const pnl     = usdtOut - buyUsdt;
        capital += pnl;
        // preenche saída no sinal correspondente
        if (openSignalIdx !== null) {
          signals[openSignalIdx].exitTime  = openTime;
          signals[openSignalIdx].exitPrice = close;
          signals[openSignalIdx].exitRsi   = exitRsi;
          signals[openSignalIdx].pnlPct    = (pnl / buyUsdt) * 100;
          openSignalIdx = null;
        }
        trades.push({
          type: 'SELL', time: openTime, price: close, exitRsi,
          pnlUsdt: pnl, pnlPct: (pnl / buyUsdt) * 100,
          capitalAfter: capital,
        });
        phase = 'WATCHING';
        buyPrice = buyQty = buyUsdt = null;
      }
    }
  }
  if (pendingSignal) signals.push({ ...pendingSignal, result: 'PENDING_OPEN' });
  // posição ainda aberta ao fim do período
  if (phase === 'BOUGHT' && openSignalIdx !== null) {
    signals[openSignalIdx].result = 'POSITION_OPEN';
  }

  // ── Relatório ──────────────────────────────────────────────────────────────
  const sells    = trades.filter(t => t.type === 'SELL');
  const wins     = sells.filter(t => t.pnlUsdt >= 0).length;
  const totalPnl = sells.reduce((s, t) => s + t.pnlUsdt, 0);
  const winRate  = sells.length ? ((wins / sells.length) * 100).toFixed(1) : '—';
  const totalPct = ((capital / startCapital - 1) * 100).toFixed(2);
  const pSign    = totalPnl >= 0 ? '+' : '';

  console.log(`\n   Capital  : $${startCapital.toFixed(2)} → $${capital.toFixed(2)}  (${pSign}${totalPct}%)`);
  console.log(`   Trades   : ${sells.length}  |  Wins: ${wins}  Losses: ${sells.length - wins}  |  Win rate: ${winRate}%`);
  console.log(`   PnL total: ${pSign}$${totalPnl.toFixed(2)}`);
  if (maFilter?.enabled) console.log(`   Bloqueados MA${maFilter.period}(${maFilter.interval}): ${maBlockedCount} sinais ignorados (preço < MA)`);

  if (sells.length) {
    console.log('\n   Data/Hora              RSI-saída   PnL           Capital');
    console.log('   ' + '─'.repeat(60));
    for (const t of sells) {
      const s    = t.pnlUsdt >= 0 ? '+' : '';
      const icon = t.pnlUsdt >= 0 ? '🟢' : '🔴';
      console.log(
        `   ${icon} ${fmtDate(t.time).padEnd(22)}` +
        `  ${t.exitRsi.toFixed(1).padStart(5)}` +
        `   ${(s + '$' + t.pnlUsdt.toFixed(2)).padStart(9)}` +
        `  (${(s + t.pnlPct.toFixed(2) + '%').padStart(7)})` +
        `  $${t.capitalAfter.toFixed(2)}`,
      );
    }
    console.log('   ' + '─'.repeat(60));
  }

  if (phase === 'BOUGHT') {
    const lastClose  = entryCandles[entryCandles.length - 1].close;
    const unrealized = buyQty * lastClose - buyUsdt;
    const us = unrealized >= 0 ? '+' : '';
    console.log(`\n   ⚠️  Posição aberta: comprado a $${fmtP(buyPrice)}  PnL não realizado: ${us}$${unrealized.toFixed(2)}`);
  }

  // ── Sinais RSI detectados (para comparar com gráfico da exchange) ──────────
  if (signals.length) {
    const ICONS = {
      BOUGHT:                 '🟢',
      POSITION_OPEN:          '🟡',
      CANCELLED_RECOVERY:     '↩️ ',
      CANCELLED_TIMEOUT:      '⏱️ ',
      MA_BLOCKED:             '🚫',
      THREE_CANDLES_BLOCKED:  '📊',
      MA_NO_DATA:             '❓',
      PENDING_OPEN:           '⏳',
    };
    console.log(`\n   ── Sinais RSI(${strategy.entry.interval})<${strategy.entry.rsiBuy} detectados ─────────────────────────────────────────`);
    console.log(`   ${'Entrada'.padEnd(22)}  RSI   ${'Preço'.padEnd(10)}  ${'Saída'.padEnd(22)}  RSI    PnL%   Resultado`);
    console.log('   ' + '─'.repeat(100));
    for (const s of signals) {
      const entryCol = fmtDate(s.entryTime).padEnd(22);
      const rsiCol   = s.entryRsi.toFixed(1).padStart(5);
      const priceCol = ('$' + fmtP(s.entryPrice)).padEnd(10);

      let exitCol = '—'.padEnd(22), exitRsiCol = '  —  ', pnlCol = '   —  ';
      if (s.exitTime) {
        exitCol    = fmtDate(s.exitTime).padEnd(22);
        exitRsiCol = s.exitRsi.toFixed(1).padStart(5);
        const ps   = s.pnlPct >= 0 ? '+' : '';
        pnlCol     = (ps + s.pnlPct.toFixed(2) + '%').padStart(7);
      }

      const label = s.result === 'BOUGHT'                ? 'vendido'
                  : s.result === 'POSITION_OPEN'         ? 'posição aberta'
                  : s.result === 'CANCELLED_RECOVERY'    ? 'cancelado (preço subiu)'
                  : s.result === 'CANCELLED_TIMEOUT'     ? 'cancelado (timeout)'
                  : s.result === 'MA_BLOCKED'            ? 'bloqueado (abaixo MA50)'
                  : s.result === 'THREE_CANDLES_BLOCKED' ? 'bloqueado (3 candles 1h não bullish)'
                  : s.result === 'MA_NO_DATA'            ? 'bloqueado (sem dados MA)'
                  : s.result === 'PENDING_OPEN'          ? 'pendente'
                  : s.result;

      console.log(`   ${ICONS[s.result] ?? '?'} ${entryCol}  ${rsiCol}  ${priceCol}  ${exitCol}  ${exitRsiCol}  ${pnlCol}  ${label}`);
    }
    console.log('   ' + '─'.repeat(100));
  }
}

// ── Tick (loop ao vivo) ───────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, log, prevExitRsi = null) {
  const { entry, exit, maFilter } = strategy;
  const specs = [
    { interval: entry.interval, limit: entry.rsiPeriod + 50 },
    { interval: exit.interval,  limit: exit.rsiPeriod  + 50 },
    ...(maFilter?.enabled ? [{ interval: maFilter.interval, limit: maFilter.period + 10 }] : []),
  ];
  const cMap = await fetchCandleMap(adapter, specs);

  const entryCandles = cMap[entry.interval];
  const exitCandles  = cMap[exit.interval];
  const entryCloses  = entryCandles.map(c => c.close);
  const exitCloses   = exitCandles.map(c => c.close);

  if (entryCloses.length < entry.rsiPeriod + 2) { log('Dados de entrada insuficientes.'); return { entryRsi: null, exitRsi: prevExitRsi }; }
  if (exitCloses.length  < exit.rsiPeriod  + 2) { log('Dados de saída insuficientes.');   return { entryRsi: null, exitRsi: prevExitRsi }; }

  const entryRsiArr = ti.RSI.calculate({ values: entryCloses, period: entry.rsiPeriod });
  const exitRsiArr  = ti.RSI.calculate({ values: exitCloses,  period: exit.rsiPeriod  });

  const entryRsi = entryRsiArr[entryRsiArr.length - 1];
  const exitRsi  = exitRsiArr[exitRsiArr.length - 1];
  const close    = entryCloses[entryCloses.length - 1];

  // MA50 — último valor disponível
  let ma50 = null, maCandles = null;
  if (maFilter?.enabled) {
    maCandles   = cMap[maFilter.interval];
    const maArr = ti.SMA.calculate({ values: maCandles.map(c => c.close), period: maFilter.period });
    ma50        = maArr[maArr.length - 1] ?? null;
  }

  if (entryRsi == null || exitRsi == null) { log('Indicadores insuficientes.'); return { entryRsi, exitRsi: prevExitRsi }; }

  const state = await loadState(rowId);
  if (!state) { log('❌ Linha não encontrada no Supabase.'); return { entryRsi, exitRsi }; }

  const { phase, capital, symbol } = state;
  const exitColor = exitRsi >= strategy.fastRsiThreshold ? Y : '';

  // ── WATCHING ────────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    const bullish = ma50 !== null ? close > ma50 : true;
    const maStr   = ma50 !== null
      ? `  MA${maFilter.period}(${maFilter.interval})=$${fmtP(ma50)} ${bullish ? `${G}↑${X}` : `${R}↓${X}`}`
      : '';
    const eColor  = entryRsi < entry.rsiBuy ? G : '';
    log(
      `${eColor}RSI(${entry.interval})=${entryRsi.toFixed(1)}${eColor ? X : ''}` +
      `  ${exitColor}RSI(${exit.interval})=${exitRsi.toFixed(1)}${exitColor ? X : ''}` +
      `${maStr}  $${fmtP(close)}  capital=$${parseFloat(capital).toFixed(2)}  [WATCHING]`,
    );

    if (entryRsi < entry.rsiBuy) {
      const maCheck = checkMaFilter(close, ma50, maCandles, maFilter, Date.now());
      if (!maCheck.allowed) {
        const abovePct = ma50 ? ((close / ma50 - 1) * 100).toFixed(1) : '?';
        const reasons  = {
          MA_BLOCKED:           `preço abaixo MA${maFilter?.period}(${maFilter?.interval})=$${fmtP(ma50)}`,
          THREE_CANDLES_BLOCKED:`preço ${abovePct}% acima MA50 mas 3 candles 1h anteriores não são todos de alta`,
          MA_NO_DATA:           'sem dados de MA',
        };
        log(`${Y}⚠️  RSI(${entry.interval})=${entryRsi.toFixed(1)} < ${entry.rsiBuy} — bloqueado: ${reasons[maCheck.reason] ?? maCheck.reason}${X}`);
        return { entryRsi, exitRsi, phase: 'WATCHING' };
      }
      const limitPrice = parseFloat((close * (1 - strategy.entryDiscount)).toFixed(8));
      log(`${G}🎯 RSI(${entry.interval})=${entryRsi.toFixed(1)} < ${entry.rsiBuy} + acima MA${maFilter?.period ?? ''}(${maFilter?.interval ?? ''}) → alvo $${fmtP(limitPrice)} [PENDING]${X}`);
      await saveState(rowId, {
        phase: 'PENDING',
        trigger_price: close, limit_price: limitPrice,
        trigger_rsi: entryRsi, pending_since: new Date().toISOString(),
      });
      sendWhatsApp(`🎯 ${symbol}\nRSI(${entry.interval})=${entryRsi.toFixed(1)} < ${entry.rsiBuy}\nMA${maFilter?.period}(${maFilter?.interval}): $${fmtP(ma50)} ↑\nAlvo: $${fmtP(limitPrice)}`);
      return { entryRsi, exitRsi, phase: 'PENDING' };
    }
    return { entryRsi, exitRsi, phase: 'WATCHING' };
  }

  // ── PENDING ──────────────────────────────────────────────────────────────────
  if (phase === 'PENDING') {
    const limitPrice   = parseFloat(state.limit_price);
    const triggerPrice = parseFloat(state.trigger_price);
    const pendingMs    = Date.now() - new Date(state.pending_since).getTime();
    const distPct      = ((close - limitPrice) / limitPrice * 100).toFixed(2);
    const cancelLine   = triggerPrice * (1 + strategy.pendingCancelPct);

    log(
      `RSI(${entry.interval})=${entryRsi.toFixed(1)}` +
      `  ${exitColor}RSI(${exit.interval})=${exitRsi.toFixed(1)}${exitColor ? X : ''}` +
      `  $${fmtP(close)}  alvo=$${fmtP(limitPrice)}  dist=${distPct}%  [PENDING ${fmtDur(pendingMs)}]`,
    );

    if (close > cancelLine || pendingMs > strategy.pendingTimeoutMs) {
      const reason = close > cancelLine
        ? `preço recuperou ($${fmtP(close)} > $${fmtP(triggerPrice)})`
        : `timeout ${fmtDur(strategy.pendingTimeoutMs)}`;
      log(`❌ Cancelando PENDING — ${reason}`);
      await saveState(rowId, {
        phase: 'WATCHING',
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      return { entryRsi, exitRsi, phase: 'WATCHING' };
    }

    if (close <= limitPrice) {
      log(`${G}✅ Alvo atingido! Comprando $${parseFloat(capital).toFixed(2)}...${X}`);
      let result;
      try { result = await adapter.marketBuy(parseFloat(capital)); }
      catch (err) { log(`❌ Erro na compra: ${err.message}`); return { entryRsi, exitRsi, phase: 'PENDING' }; }

      const { filledQty, quoteQty, avgPrice } = result;
      await saveState(rowId, {
        phase: 'BOUGHT',
        buy_price: avgPrice, buy_qty: filledQty, buy_usdt: quoteQty,
        buy_time: new Date().toISOString(), rsi_entry: entryRsi,
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      log('─'.repeat(60));
      log(`${G}🟢 COMPRA${X}  preço=$${fmtP(avgPrice)}  qty=${filledQty}  USDT=$${quoteQty.toFixed(2)}`);
      log(`   RSI-entrada(${entry.interval})=${entryRsi.toFixed(1)}  RSI-saída(${exit.interval})=${exitRsi.toFixed(1)}`);
      log('─'.repeat(60));
      sendWhatsApp(`🟢 ${symbol} COMPRA [${adapter.name}]\nPreço: $${fmtP(avgPrice)}\nQty: ${filledQty}\nUSDT: $${quoteQty.toFixed(2)}\nRSI-entrada(${entry.interval}): ${entryRsi.toFixed(1)}`);
      return { entryRsi, exitRsi, phase: 'BOUGHT' };
    }

    return { entryRsi, exitRsi, phase: 'PENDING' };
  }

  // ── BOUGHT ───────────────────────────────────────────────────────────────────
  if (phase === 'BOUGHT') {
    const buyPrice = parseFloat(state.buy_price);
    const pnlPct   = ((close - buyPrice) / buyPrice * 100).toFixed(2);
    const pnlColor = parseFloat(pnlPct) >= 0 ? G : R;
    const fastMark = exitRsi >= strategy.fastRsiThreshold ? ' ⚡' : '';

    log(
      `RSI(${entry.interval})=${entryRsi.toFixed(1)}` +
      `  ${exitColor}RSI(${exit.interval})=${exitRsi.toFixed(1)}${exitColor ? X : ''}${fastMark}` +
      `  $${fmtP(close)}  buy=$${fmtP(buyPrice)}  ${pnlColor}PnL=${pnlPct}%${X}  [BOUGHT]`,
    );

    if (exitRsi > exit.rsiSell) {
      log(`${R}📈 RSI(${exit.interval})=${exitRsi.toFixed(1)} > ${exit.rsiSell} — vendendo${X}`);
      let result;
      try { result = await adapter.marketSell(parseFloat(state.buy_qty), log); }
      catch (err) { log(`❌ Erro na venda: ${err.message}`); return { entryRsi, exitRsi, phase: 'BOUGHT' }; }

      const { soldQty, usdtOut, exitPrice } = result;
      const capitalBefore = parseFloat(capital);
      const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
      const capitalAfter  = capitalBefore + pnlUsdt;
      const pnlPctFinal   = (pnlUsdt / parseFloat(state.buy_usdt) * 100).toFixed(2);
      const pnlSign       = pnlUsdt >= 0 ? '+' : '';

      await insertTrade({
        symbol, exchange: state.exchange, strategy_id: state.strategy_id,
        entry_time: state.buy_time, exit_time: new Date().toISOString(),
        entry_price: buyPrice, exit_price: exitPrice,
        qty: soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: usdtOut,
        pnl_usdt: pnlUsdt, pnl_pct: parseFloat(pnlPctFinal),
        capital_before: capitalBefore, capital_after: capitalAfter,
        rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: exitRsi,
      });

      await saveState(rowId, {
        phase: 'WATCHING', capital: capitalAfter,
        buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
      });

      const icon = pnlUsdt >= 0 ? '🔴' : '❌';
      log('─'.repeat(60));
      log(`${icon} VENDA  preço=$${fmtP(exitPrice)}  qty=${soldQty}`);
      log(`   PnL    : ${pnlSign}$${pnlUsdt.toFixed(4)} (${pnlSign}${pnlPctFinal}%)`);
      log(`   RSI(${exit.interval}): ${exitRsi.toFixed(1)}`);
      log(`   Capital: $${capitalBefore.toFixed(4)} → $${capitalAfter.toFixed(4)}`);
      log('─'.repeat(60));
      sendWhatsApp(`🔴 ${symbol} VENDA [${adapter.name}]\nPreço: $${fmtP(exitPrice)}\nPnL: ${pnlSign}$${pnlUsdt.toFixed(2)} (${pnlSign}${pnlPctFinal}%)\nCapital: $${capitalBefore.toFixed(2)} → $${capitalAfter.toFixed(2)}\nRSI(${exit.interval}): ${exitRsi.toFixed(1)}`);
      return { entryRsi, exitRsi, phase: 'WATCHING' };
    }

    return { entryRsi, exitRsi, phase: 'BOUGHT' };
  }

  return { entryRsi, exitRsi, phase };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color) {
  const strategy = STRATEGIES[row.strategy_id];
  if (!strategy) {
    console.error(`❌ strategy_id "${row.strategy_id}" desconhecida para ${row.symbol}`);
    return;
  }

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, color);

  log(
    `=== RSI Multi Bot | ${adapter.name} | ${adapter.pair}` +
    ` | ${strategy.label}` +
    ` | poll: ${strategy.pollMs / 1000}s/${strategy.fastPollMs / 1000}s | fase: ${row.phase} ===`,
  );

  if (row.phase === 'BOUGHT')
    log(`♻️  Posição aberta — comprado a $${fmtP(row.buy_price)} | qty=${row.buy_qty}`);
  if (row.phase === 'PENDING') {
    const ms = Date.now() - new Date(row.pending_since).getTime();
    log(`♻️  PENDING — alvo=$${fmtP(row.limit_price)} | gatilho=$${fmtP(row.trigger_price)} | há ${fmtDur(ms)}`);
  }

  let lastResult = { entryRsi: null, exitRsi: null, phase: row.phase };
  let errCount   = 0;

  const schedule = () => {
    const { phase, exitRsi } = lastResult;
    const fast  = phase === 'PENDING' || (exitRsi !== null && exitRsi >= strategy.fastRsiThreshold);
    setTimeout(run, fast ? strategy.fastPollMs : strategy.pollMs);
  };

  const run = async () => {
    try {
      lastResult = await tick(row.id, adapter, strategy, log, lastResult.exitRsi);
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // ── Modo backtest ──────────────────────────────────────────────────────────
  if (args[0] === '--backtest') {
    const symbol     = args[1];
    const strategyId = args[2];
    const exchange   = args[3] ?? 'binance';
    const capital    = parseFloat(args[4] ?? '100');
    // args[5]: 'true' | 'false' — sobrescreve maFilter.enabled da estratégia; omitir = usa o padrão
    // args[6]: 'true' | 'false' — sobrescreve threeCandles.enabled; omitir = usa o padrão
    const maOverride           = args[5] === 'true' ? true : args[5] === 'false' ? false : null;
    const threeCandlesOverride = args[6] === 'true' ? true : args[6] === 'false' ? false : null;

    if (!symbol) {
      console.log('Uso: node trading-rsi-multi.js --backtest <SYMBOL> [strategyId] [exchange] [capital] [ma50=true|false] [3candles=true|false]');
      console.log('\nEstratégias disponíveis:');
      for (const [id, s] of Object.entries(STRATEGIES))
        console.log(`  ${id.padEnd(22)} ${s.label}  (MA padrão: ${s.maFilter?.enabled ?? false})`);
      process.exit(0);
    }

    await Promise.all([syncBinanceClock(), syncGateClock()]);

    const toTest = (strategyId && STRATEGIES[strategyId])
      ? [strategyId]
      : Object.keys(STRATEGIES);

    for (const sid of toTest) await backtest(symbol, sid, exchange, capital, maOverride, threeCandlesOverride);
    console.log();
    process.exit(0);
  }

  // ── Modo bot ───────────────────────────────────────────────────────────────
  if (!SB_URL || !SB_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  await Promise.all([syncBinanceClock(), syncGateClock()]);
  setInterval(syncBinanceClock, 60 * 60_000);
  setInterval(syncGateClock,    60 * 60_000);

  const rows = await loadAllRows();
  if (!rows?.length) {
    console.error('❌ Nenhum símbolo em rsi_multi_bot_state. Execute rsi-multi-bot.sql no Supabase.');
    process.exit(1);
  }

  console.log('\n🤖 Trading RSI Multi-Intervalo Bot');
  console.log('   Estratégias carregadas:');
  for (const [id, s] of Object.entries(STRATEGIES))
    console.log(`   • ${id}: ${s.label}`);
  console.log();

  const toStart = [];

  for (let i = 0; i < rows.length; i++) {
    const row      = rows[i];
    const strategy = STRATEGIES[row.strategy_id];
    const adapter  = buildAdapter(row.exchange ?? 'binance', row.symbol);
    const color    = COLORS[i % COLORS.length];

    if (!strategy) {
      console.log(`   ⚠️  ${row.symbol}: strategy_id="${row.strategy_id}" desconhecida — ignorado`);
      continue;
    }

    let volFmt = 'n/a', volOk = true;
    try {
      const vol = await adapter.fetch24hVol();
      volFmt    = vol >= 1_000_000 ? `$${(vol / 1_000_000).toFixed(2)}M` : `$${(vol / 1000).toFixed(1)}K`;
      volOk     = vol >= VOL_MIN_USDT;
    } catch {}

    console.log(
      `   ${color}${row.symbol}${X}  exchange=${row.exchange ?? 'binance'}` +
      `  strategy=${row.strategy_id}  capital=$${parseFloat(row.capital).toFixed(2)}` +
      `  vol24h=${volFmt}  fase=${row.phase}`,
    );

    if (!volOk) {
      console.log(`   ${Y}⚠️  Volume < $1M — baixa liquidez${X}`);
      const resp = await askUser(`   Incluir ${row.symbol} mesmo assim? [s/N]: `);
      if (resp !== 's' && resp !== 'sim') { console.log(`   ⏭️  ${row.symbol} ignorado.\n`); continue; }
    }

    toStart.push({ row, color });
  }

  console.log();
  if (!toStart.length) { console.error('❌ Nenhum símbolo aprovado.'); process.exit(0); }

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
