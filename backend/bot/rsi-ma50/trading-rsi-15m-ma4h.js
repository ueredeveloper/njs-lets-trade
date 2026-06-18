'use strict';

/**
 * Trading RSI 15m + MA50(4h) Adaptive Bot
 *
 * Entrada : RSI(15m) < 30 — alvo 1% abaixo do preço de gatilho
 *           Preço > MA50(4h)                        [filtro irrestrito]
 *           Preço > MA50(1h) OU dentro do threshold adaptativo de dip
 *             (threshold calculado por símbolo a partir do histórico)
 * Saída   : RSI(15m) > 70
 * Stop    : Preço < MA50(4h)                        [irrestrito]
 *
 * Modo bot   : node backend/bot/rsi-ma50/trading-rsi-15m-ma4h.js
 * Backtest   : node backend/bot/rsi-ma50/trading-rsi-15m-ma4h.js --backtest BTCUSDT [strategyId] [exchange] [capital]
 */

// ── Estratégias ───────────────────────────────────────────────────────────────
const STRATEGIES = {
  'rsi15m_4h': {
    label: 'RSI(15m)<30 → RSI(15m)>70 | MA50(4h) estrito | MA50(1h) adaptativo',
    entry:    { interval: '15m', rsiPeriod: 14, rsiBuy: 30 },
    exit:     { interval: '15m', rsiPeriod: 14, rsiSell: 70 },
    ma4h:     { interval: '4h', period: 50 },
    ma1h:     { interval: '1h', period: 50 },
    stopLoss: { interval: '4h', period: 50 },
    adaptiveDefault: 3.0,   // % padrão se não há dados suficientes
    adaptiveMax:     8.0,   // % cap máximo
    adaptiveMin:     0.5,   // % mínimo significativo
    entryDiscount:    0.01,           // 1% abaixo do preço de gatilho
    pendingTimeoutMs: 2 * 60 * 60_000,
    pendingCancelPct: 0.005,          // cancela se preço sobe 0.5% acima do gatilho
    fastRsiThreshold: 60,
    pollMs:           5 * 60_000,
    fastPollMs:       2 * 60_000,
  },
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
  const logFile = path.join(BOT_DIR, `log-${symbol}-15m4h.txt`);
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

async function loadAllRows()    { return sbReq('GET', 'rsi_multi_bot_state', null, '?order=id.asc'); }
async function loadState(id)    { const r = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${id}&limit=1`); return r?.[0] ?? null; }
async function saveState(id, u) { await sbReq('PATCH', 'rsi_multi_bot_state', { ...u, updated_at: new Date().toISOString() }, `?id=eq.${id}`); }
async function insertTrade(t)   { await sbReq('POST', 'rsi_multi_bot_trades', t); }

// ── Indicadores ───────────────────────────────────────────────────────────────

function computeRsiSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period });
  return rsiArr.map((rsi, i) => ({
    openTime: candles[period + i].openTime,
    close:    candles[period + i].close,
    rsi,
  }));
}

function exitRsiAt(exitSeries, entryTime) {
  let best = null;
  for (let i = 0; i < exitSeries.length; i++) {
    if (exitSeries[i].openTime <= entryTime) best = exitSeries[i].rsi;
    else break;
  }
  return best;
}

function computeMaSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const maArr  = ti.SMA.calculate({ values: closes, period });
  return maArr.map((ma, i) => ({ openTime: candles[period - 1 + i].openTime, ma }));
}

function maAt(maSeries, time) {
  let best = null;
  for (const point of maSeries) {
    if (point.openTime <= time) best = point.ma;
    else break;
  }
  return best;
}

/**
 * Calcula o threshold adaptativo de dip abaixo da MA50(1h) por símbolo.
 *
 * Identifica episódios de dip: sequências de candles onde close < MA,
 * precedidas e seguidas de candles acima da MA (recuperação confirmada).
 * Calcula o máximo % de dip de cada episódio e retorna a média.
 *
 * Isso responde: "em média, quanto % abaixo da MA50(1h) esse ativo costuma
 * cair antes de recuperar?"
 */
function computeAdaptiveDipPct(candles, period, defaultPct, maxPct, minPct) {
  if (candles.length < period + 10) return defaultPct;

  const closes = candles.map(c => c.close);
  const maArr  = ti.SMA.calculate({ values: closes, period });
  // maArr[i] alinha com closes[period - 1 + i]
  const aligned = maArr.map((ma, i) => ({ close: closes[period - 1 + i], ma }));

  const dips = [];
  let inDip    = false;
  let dipStart = -1;

  for (let i = 0; i < aligned.length; i++) {
    const below = aligned[i].close < aligned[i].ma;

    if (below && !inDip) {
      // Inicia episódio de dip somente se o candle anterior estava acima da MA
      if (i > 0 && aligned[i - 1].close >= aligned[i - 1].ma) {
        inDip    = true;
        dipStart = i;
      }
    } else if (!below && inDip) {
      // Fim do episódio — preço voltou acima da MA
      let maxDipPct = 0;
      for (let j = dipStart; j < i; j++) {
        const pct = (aligned[j].ma - aligned[j].close) / aligned[j].ma * 100;
        if (pct > maxDipPct) maxDipPct = pct;
      }
      dips.push(maxDipPct);
      inDip = false;
    }
  }

  if (dips.length < 3) return defaultPct; // poucos episódios — não estatisticamente confiável

  const avg = dips.reduce((s, d) => s + d, 0) / dips.length;
  return Math.max(minPct, Math.min(maxPct, parseFloat(avg.toFixed(2))));
}

/**
 * Verifica se a entrada é permitida:
 *   close > ma4h                                     → obrigatório
 *   close >= ma1h * (1 - adaptiveDipPct/100)         → obrigatório (acima ou dentro do dip histórico)
 */
function checkEntry(close, ma4h, ma1h, adaptiveDipPct) {
  if (ma4h === null) return { allowed: false, reason: 'MA4H_NO_DATA' };
  if (close <= ma4h) return { allowed: false, reason: 'MA4H_BLOCKED' };
  if (ma1h === null) return { allowed: false, reason: 'MA1H_NO_DATA' };
  const floor = ma1h * (1 - adaptiveDipPct / 100);
  if (close < floor) return { allowed: false, reason: 'MA1H_BLOCKED' };
  return { allowed: true, reason: null };
}

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

async function backtest(symbol, strategyId, exchange = 'binance', capital = 100) {
  const strategy = STRATEGIES[strategyId];
  if (!strategy) {
    console.error(`❌ Estratégia desconhecida: "${strategyId}". Disponíveis: ${Object.keys(STRATEGIES).join(', ')}`);
    return;
  }

  const adapter = buildAdapter(exchange, symbol);
  const { entry, exit, ma4h, ma1h, adaptiveDefault, adaptiveMax, adaptiveMin } = strategy;

  console.log(`\n${'─'.repeat(68)}`);
  console.log(`📊 Backtest: ${symbol} [${adapter.name}]  —  ${strategy.label}`);

  const intervals = [...new Set([entry.interval, ma4h.interval, ma1h.interval])];
  const LIMIT     = 1000;

  const cMap = {};
  for (const iv of intervals) {
    const local = loadLocalCandles(symbol, iv);
    if (local) { cMap[iv] = local; console.log(`   📂 ${iv}: arquivo local (${local.length} candles)`); }
  }

  const apiSpecs = intervals.filter(iv => !cMap[iv]).map(iv => ({ interval: iv, limit: LIMIT }));
  if (apiSpecs.length) {
    const fetched = await fetchCandleMap(adapter, apiSpecs);
    Object.assign(cMap, fetched);
  }

  const candles15m = cMap[entry.interval];
  const candles4h  = cMap[ma4h.interval];
  const candles1h  = cMap[ma1h.interval];

  console.log(`   Candles  : ${candles15m.length}×15m  |  ${candles4h.length}×4h  |  ${candles1h.length}×1h`);
  console.log(`   Período  : ${fmtDate(candles15m[0].openTime)} → ${fmtDate(candles15m[candles15m.length - 1].openTime)}`);

  const adaptiveDipPct = computeAdaptiveDipPct(candles1h, ma1h.period, adaptiveDefault, adaptiveMax, adaptiveMin);
  const dipEpisodesMsg = adaptiveDipPct === adaptiveDefault ? '(padrão — poucos episódios)' : '';
  console.log(`   Dip adapt: MA50(1h) threshold = ${adaptiveDipPct.toFixed(2)}% abaixo da MA ${dipEpisodesMsg}`);

  const entrySeries = computeRsiSeries(candles15m, entry.rsiPeriod);
  const exitSeries  = entrySeries; // mesmo intervalo e período
  const ma4hSeries  = computeMaSeries(candles4h, ma4h.period);
  const ma1hSeries  = computeMaSeries(candles1h, ma1h.period);
  const slMaSeries  = ma4hSeries; // stop loss = MA50(4h)

  let phase = 'WATCHING';
  let buyPrice = null, buyQty = null, buyUsdt = null;
  let triggerPrice = null, limitPrice = null, pendingSince = null;
  const trades      = [];
  const signals     = [];
  const startCapital = capital;
  let blockedCount   = 0;
  let pendingSignal  = null;
  let openSignalIdx  = null;

  for (const { openTime, close, rsi } of entrySeries) {
    const exitRsi = exitRsiAt(exitSeries, openTime);
    const ma4hVal = maAt(ma4hSeries, openTime);
    const ma1hVal = maAt(ma1hSeries, openTime);

    if (phase === 'WATCHING') {
      if (rsi < entry.rsiBuy) {
        const check = checkEntry(close, ma4hVal, ma1hVal, adaptiveDipPct);
        if (!check.allowed) {
          blockedCount++;
          signals.push({ entryTime: openTime, entryRsi: rsi, entryPrice: close, result: check.reason });
          continue;
        }
        triggerPrice  = close;
        limitPrice    = parseFloat((close * (1 - strategy.entryDiscount)).toFixed(8));
        pendingSince  = openTime;
        pendingSignal = { entryTime: openTime, entryRsi: rsi, entryPrice: close };
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
        phase    = 'BOUGHT';
        trades.push({ type: 'BUY', time: openTime, price: close, entryRsi: rsi });
        triggerPrice = limitPrice = pendingSince = null;
      }

    } else if (phase === 'BOUGHT') {
      const slMa        = slMaSeries ? maAt(slMaSeries, openTime) : null;
      const stopLossHit = slMa !== null && close < slMa;
      const rsiExitHit  = exitRsi !== null && exitRsi > exit.rsiSell;

      if (stopLossHit || rsiExitHit) {
        const usdtOut = buyQty * close;
        const pnl     = usdtOut - buyUsdt;
        capital += pnl;
        if (openSignalIdx !== null) {
          signals[openSignalIdx].exitTime  = openTime;
          signals[openSignalIdx].exitPrice = close;
          signals[openSignalIdx].exitRsi   = exitRsi;
          signals[openSignalIdx].pnlPct    = (pnl / buyUsdt) * 100;
          if (stopLossHit) signals[openSignalIdx].result = 'STOP_LOSS_MA';
          openSignalIdx = null;
        }
        trades.push({
          type: 'SELL', time: openTime, price: close, exitRsi,
          stopLoss: stopLossHit,
          pnlUsdt: pnl, pnlPct: (pnl / buyUsdt) * 100,
          capitalAfter: capital,
        });
        phase    = 'WATCHING';
        buyPrice = buyQty = buyUsdt = null;
      }
    }
  }

  if (pendingSignal) signals.push({ ...pendingSignal, result: 'PENDING_OPEN' });
  if (phase === 'BOUGHT' && openSignalIdx !== null) signals[openSignalIdx].result = 'POSITION_OPEN';

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
  console.log(`   Bloqueados: ${blockedCount} sinais ignorados`);

  const slCount = sells.filter(t => t.stopLoss).length;
  if (slCount) console.log(`   Stop Loss MA50(4h): ${slCount} saída(s)`);

  if (sells.length) {
    console.log('\n   Data/Hora              RSI-saída   PnL           Capital');
    console.log('   ' + '─'.repeat(60));
    for (const t of sells) {
      const s    = t.pnlUsdt >= 0 ? '+' : '';
      const icon = t.stopLoss ? '🛑' : (t.pnlUsdt >= 0 ? '🟢' : '🔴');
      console.log(
        `   ${icon} ${fmtDate(t.time).padEnd(22)}` +
        `  ${(t.exitRsi != null ? t.exitRsi.toFixed(1) : '—').padStart(5)}` +
        `   ${(s + '$' + t.pnlUsdt.toFixed(2)).padStart(9)}` +
        `  (${(s + t.pnlPct.toFixed(2) + '%').padStart(7)})` +
        `  $${t.capitalAfter.toFixed(2)}` +
        (t.stopLoss ? '  SL' : ''),
      );
    }
    console.log('   ' + '─'.repeat(60));
  }

  if (phase === 'BOUGHT') {
    const lastClose  = candles15m[candles15m.length - 1].close;
    const unrealized = buyQty * lastClose - buyUsdt;
    const us = unrealized >= 0 ? '+' : '';
    console.log(`\n   ⚠️  Posição aberta: comprado a $${fmtP(buyPrice)}  PnL não realizado: ${us}$${unrealized.toFixed(2)}`);
  }

  // ── Sinais detectados ──────────────────────────────────────────────────────
  if (signals.length) {
    const ICONS = {
      BOUGHT:             '🟢',
      STOP_LOSS_MA:       '🛑',
      POSITION_OPEN:      '🟡',
      CANCELLED_RECOVERY: '↩️ ',
      CANCELLED_TIMEOUT:  '⏱️ ',
      MA4H_BLOCKED:       '🚫',
      MA1H_BLOCKED:       '📉',
      MA4H_NO_DATA:       '❓',
      MA1H_NO_DATA:       '❓',
      PENDING_OPEN:       '⏳',
    };
    console.log(`\n   ── Sinais RSI(15m)<${entry.rsiBuy} detectados ──────────────────────────────────────────`);
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

      const label = s.result === 'BOUGHT'             ? 'vendido'
                  : s.result === 'STOP_LOSS_MA'       ? 'stop loss (abaixo MA50(4h))'
                  : s.result === 'POSITION_OPEN'      ? 'posição aberta'
                  : s.result === 'CANCELLED_RECOVERY' ? 'cancelado (preço subiu)'
                  : s.result === 'CANCELLED_TIMEOUT'  ? 'cancelado (timeout 2h)'
                  : s.result === 'MA4H_BLOCKED'       ? 'bloqueado (abaixo MA50(4h))'
                  : s.result === 'MA1H_BLOCKED'       ? `bloqueado (dip > ${adaptiveDipPct}% abaixo MA50(1h))`
                  : s.result === 'MA4H_NO_DATA'       ? 'bloqueado (sem dados MA4H)'
                  : s.result === 'MA1H_NO_DATA'       ? 'bloqueado (sem dados MA1H)'
                  : s.result === 'PENDING_OPEN'       ? 'pendente'
                  : s.result;

      console.log(`   ${ICONS[s.result] ?? '?'} ${entryCol}  ${rsiCol}  ${priceCol}  ${exitCol}  ${exitRsiCol}  ${pnlCol}  ${label}`);
    }
    console.log('   ' + '─'.repeat(100));
  }
}

// ── Tick (loop ao vivo) ───────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, adaptiveDipPct, log) {
  const { entry, exit, ma4h, ma1h } = strategy;

  const specs = [
    { interval: entry.interval, limit: entry.rsiPeriod + 50 }, // 15m
    { interval: ma4h.interval,  limit: ma4h.period  + 10 },    // 4h (também stop loss)
    { interval: ma1h.interval,  limit: ma1h.period  + 10 },    // 1h
  ];

  const cMap    = await fetchCandleMap(adapter, specs);
  const closes  = cMap[entry.interval].map(c => c.close);

  if (closes.length < entry.rsiPeriod + 2) {
    log('Dados insuficientes.');
    return { rsi: null, phase: null };
  }

  const rsiArr = ti.RSI.calculate({ values: closes, period: entry.rsiPeriod });
  const rsi    = rsiArr[rsiArr.length - 1];
  const close  = closes[closes.length - 1];

  const ma4hArr = ti.SMA.calculate({ values: cMap[ma4h.interval].map(c => c.close), period: ma4h.period });
  const ma4hVal = ma4hArr[ma4hArr.length - 1] ?? null;

  const ma1hArr = ti.SMA.calculate({ values: cMap[ma1h.interval].map(c => c.close), period: ma1h.period });
  const ma1hVal = ma1hArr[ma1hArr.length - 1] ?? null;

  const stopLossMa = ma4hVal; // stop loss = MA50(4h)

  if (rsi == null) { log('RSI insuficiente.'); return { rsi: null, phase: null }; }

  const state = await loadState(rowId);
  if (!state) { log('❌ Linha não encontrada no Supabase.'); return { rsi, phase: null }; }

  const { phase, capital, symbol } = state;

  // Strings de log para as MAs
  const above4h  = ma4hVal !== null ? close > ma4hVal : null;
  const dip1hPct = ma1hVal !== null ? (ma1hVal - close) / ma1hVal * 100 : null; // positivo = abaixo da MA
  const ma4hStr  = ma4hVal !== null
    ? `  MA50(4h)=$${fmtP(ma4hVal)} ${above4h ? `${G}↑${X}` : `${R}↓${X}`}`
    : '';
  const dipLabel = dip1hPct !== null
    ? (dip1hPct > 0 ? `-${dip1hPct.toFixed(1)}%` : `+${Math.abs(dip1hPct).toFixed(1)}%`)
    : '';
  const ma1hStr  = ma1hVal !== null
    ? `  MA50(1h)=$${fmtP(ma1hVal)} ${dip1hPct !== null && dip1hPct <= 0 ? `${G}↑${X}` : `${R}↓${X}`}(${dipLabel}/lim:-${adaptiveDipPct}%)`
    : '';
  const fastMark = rsi >= strategy.fastRsiThreshold ? ' ⚡' : '';
  const eColor   = rsi < entry.rsiBuy ? G : '';

  // ── WATCHING ────────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    log(
      `${eColor}RSI(15m)=${rsi.toFixed(1)}${eColor ? X : ''}${fastMark}` +
      `${ma4hStr}${ma1hStr}  $${fmtP(close)}  capital=$${parseFloat(capital).toFixed(2)}  [WATCHING]`,
    );

    if (rsi < entry.rsiBuy) {
      const check = checkEntry(close, ma4hVal, ma1hVal, adaptiveDipPct);
      if (!check.allowed) {
        const reasons = {
          MA4H_BLOCKED: `preço $${fmtP(close)} abaixo MA50(4h) $${fmtP(ma4hVal)}`,
          MA1H_BLOCKED: `preço $${fmtP(close)} é ${dip1hPct?.toFixed(1)}% abaixo MA50(1h) $${fmtP(ma1hVal)} (máx: ${adaptiveDipPct}%)`,
          MA4H_NO_DATA: 'sem dados MA50(4h)',
          MA1H_NO_DATA: 'sem dados MA50(1h)',
        };
        log(`${Y}⚠️  RSI(15m)=${rsi.toFixed(1)} < ${entry.rsiBuy} — bloqueado: ${reasons[check.reason] ?? check.reason}${X}`);
        return { rsi, phase: 'WATCHING' };
      }
      const limitPrice = parseFloat((close * (1 - strategy.entryDiscount)).toFixed(8));
      log(`${G}🎯 RSI(15m)=${rsi.toFixed(1)} < ${entry.rsiBuy} → alvo $${fmtP(limitPrice)} (-1%) [PENDING]${X}`);
      await saveState(rowId, {
        phase: 'PENDING',
        trigger_price: close, limit_price: limitPrice,
        trigger_rsi: rsi, pending_since: new Date().toISOString(),
      });
      sendWhatsApp(
        `🎯 ${symbol} RSI(15m)=${rsi.toFixed(1)} < ${entry.rsiBuy}\n` +
        `MA50(4h): $${fmtP(ma4hVal)} ↑\nAlvo: $${fmtP(limitPrice)} (-1%)`,
      );
      return { rsi, phase: 'PENDING' };
    }
    return { rsi, phase: 'WATCHING' };
  }

  // ── PENDING ──────────────────────────────────────────────────────────────────
  if (phase === 'PENDING') {
    const limitPriceDb   = parseFloat(state.limit_price);
    const triggerPriceDb = parseFloat(state.trigger_price);
    const pendingMs      = Date.now() - new Date(state.pending_since).getTime();
    const distPct        = ((close - limitPriceDb) / limitPriceDb * 100).toFixed(2);
    const cancelLine     = triggerPriceDb * (1 + strategy.pendingCancelPct);

    log(
      `RSI(15m)=${rsi.toFixed(1)}${ma4hStr}  $${fmtP(close)}` +
      `  alvo=$${fmtP(limitPriceDb)}  dist=${distPct}%  [PENDING ${fmtDur(pendingMs)}]`,
    );

    if (close > cancelLine || pendingMs > strategy.pendingTimeoutMs) {
      const reason = close > cancelLine
        ? `preço recuperou ($${fmtP(close)} > $${fmtP(triggerPriceDb)})`
        : `timeout ${fmtDur(strategy.pendingTimeoutMs)}`;
      log(`❌ Cancelando PENDING — ${reason}`);
      await saveState(rowId, {
        phase: 'WATCHING',
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      return { rsi, phase: 'WATCHING' };
    }

    if (close <= limitPriceDb) {
      log(`${G}✅ Alvo atingido! Comprando $${parseFloat(capital).toFixed(2)}...${X}`);
      let result;
      try { result = await adapter.marketBuy(parseFloat(capital)); }
      catch (err) { log(`❌ Erro na compra: ${err.message}`); return { rsi, phase: 'PENDING' }; }

      const { filledQty, quoteQty, avgPrice } = result;
      await saveState(rowId, {
        phase: 'BOUGHT',
        buy_price: avgPrice, buy_qty: filledQty, buy_usdt: quoteQty,
        buy_time: new Date().toISOString(), rsi_entry: rsi,
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      log('─'.repeat(60));
      log(`${G}🟢 COMPRA${X}  preço=$${fmtP(avgPrice)}  qty=${filledQty}  USDT=$${quoteQty.toFixed(2)}`);
      log(`   RSI(15m)=${rsi.toFixed(1)}  MA50(4h)=$${fmtP(ma4hVal)}`);
      log('─'.repeat(60));
      sendWhatsApp(
        `🟢 ${symbol} COMPRA [${adapter.name}]\nPreço: $${fmtP(avgPrice)}\nQty: ${filledQty}\n` +
        `USDT: $${quoteQty.toFixed(2)}\nRSI(15m): ${rsi.toFixed(1)}`,
      );
      return { rsi, phase: 'BOUGHT' };
    }

    return { rsi, phase: 'PENDING' };
  }

  // ── BOUGHT ───────────────────────────────────────────────────────────────────
  if (phase === 'BOUGHT') {
    const buyPrice    = parseFloat(state.buy_price);
    const pnlPct      = ((close - buyPrice) / buyPrice * 100).toFixed(2);
    const pnlColor    = parseFloat(pnlPct) >= 0 ? G : R;
    const stopLossHit = stopLossMa !== null && close < stopLossMa;
    const rsiExitHit  = rsi > exit.rsiSell;
    const rsiColor    = rsi >= strategy.fastRsiThreshold ? Y : '';

    log(
      `${rsiColor}RSI(15m)=${rsi.toFixed(1)}${rsiColor ? X : ''}${fastMark}` +
      `  $${fmtP(close)}  buy=$${fmtP(buyPrice)}  ${pnlColor}PnL=${pnlPct}%${X}` +
      `  ${R}SL(MA50 4h)=$${fmtP(stopLossMa)}${X}  [BOUGHT]`,
    );

    if (stopLossHit || rsiExitHit) {
      if (stopLossHit) log(`${R}🛑 STOP LOSS: preço $${fmtP(close)} < MA50(4h) $${fmtP(stopLossMa)} — vendendo${X}`);
      else             log(`${G}📈 RSI(15m)=${rsi.toFixed(1)} > ${exit.rsiSell} — vendendo${X}`);

      let result;
      try { result = await adapter.marketSell(parseFloat(state.buy_qty), log); }
      catch (err) { log(`❌ Erro na venda: ${err.message}`); return { rsi, phase: 'BOUGHT' }; }

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
        rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: rsi,
      });

      await saveState(rowId, {
        phase: 'WATCHING', capital: capitalAfter,
        buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
      });

      const icon = stopLossHit ? '🛑' : (pnlUsdt >= 0 ? '🟢' : '🔴');
      log('─'.repeat(60));
      log(`${icon} VENDA${stopLossHit ? ' [STOP LOSS MA50(4h)]' : ''}  preço=$${fmtP(exitPrice)}  qty=${soldQty}`);
      log(`   PnL    : ${pnlSign}$${pnlUsdt.toFixed(4)} (${pnlSign}${pnlPctFinal}%)`);
      log(`   RSI(15m): ${rsi.toFixed(1)}`);
      log(`   Capital: $${capitalBefore.toFixed(4)} → $${capitalAfter.toFixed(4)}`);
      log('─'.repeat(60));
      sendWhatsApp(
        `${stopLossHit ? '🛑' : (pnlUsdt >= 0 ? '🟢' : '🔴')} ${symbol} VENDA [${adapter.name}]\n` +
        `Razão: ${stopLossHit ? `Stop Loss MA50(4h) $${fmtP(stopLossMa)}` : `RSI(15m)=${rsi.toFixed(1)}`}\n` +
        `Preço: $${fmtP(exitPrice)}\nPnL: ${pnlSign}$${pnlUsdt.toFixed(2)} (${pnlSign}${pnlPctFinal}%)\n` +
        `Capital: $${capitalBefore.toFixed(2)} → $${capitalAfter.toFixed(2)}`,
      );
      return { rsi, phase: 'WATCHING' };
    }

    return { rsi, phase: 'BOUGHT' };
  }

  return { rsi, phase };
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
    `=== RSI 15m+MA50(4h) Bot | ${adapter.name} | ${adapter.pair}` +
    ` | ${strategy.label}` +
    ` | poll: ${strategy.pollMs / 1000}s/${strategy.fastPollMs / 1000}s | fase: ${row.phase} ===`,
  );

  // Calcula threshold adaptativo de dip para este símbolo a partir de 300 candles 1h
  let adaptiveDipPct = strategy.adaptiveDefault;
  try {
    const candles1h = await adapter.fetchCandles(300, strategy.ma1h.interval);
    adaptiveDipPct = computeAdaptiveDipPct(
      candles1h, strategy.ma1h.period,
      strategy.adaptiveDefault, strategy.adaptiveMax, strategy.adaptiveMin,
    );
    log(`📐 Dip adaptativo MA50(1h): ${adaptiveDipPct.toFixed(2)}% (analisados ${candles1h.length} candles 1h)`);
  } catch (err) {
    log(`⚠️  Dip adaptativo: erro ao calcular (${err.message}) — usando padrão ${adaptiveDipPct}%`);
  }

  // Atualiza o threshold adaptativo a cada 24h
  setInterval(async () => {
    try {
      const candles1h = await adapter.fetchCandles(300, strategy.ma1h.interval);
      adaptiveDipPct = computeAdaptiveDipPct(
        candles1h, strategy.ma1h.period,
        strategy.adaptiveDefault, strategy.adaptiveMax, strategy.adaptiveMin,
      );
      log(`📐 Dip adaptativo atualizado: ${adaptiveDipPct.toFixed(2)}%`);
    } catch {}
  }, 24 * 60 * 60_000);

  if (row.phase === 'BOUGHT')
    log(`♻️  Posição aberta — comprado a $${fmtP(row.buy_price)} | qty=${row.buy_qty}`);
  if (row.phase === 'PENDING') {
    const ms = Date.now() - new Date(row.pending_since).getTime();
    log(`♻️  PENDING — alvo=$${fmtP(row.limit_price)} | gatilho=$${fmtP(row.trigger_price)} | há ${fmtDur(ms)}`);
  }

  let lastRsi  = null;
  let errCount = 0;

  const schedule = () => {
    const fast = lastRsi !== null && lastRsi >= strategy.fastRsiThreshold;
    setTimeout(run, fast ? strategy.fastPollMs : strategy.pollMs);
  };

  const run = async () => {
    try {
      const result = await tick(row.id, adapter, strategy, adaptiveDipPct, log);
      lastRsi  = result.rsi;
      errCount = 0;
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
    const strategyId = args[2] ?? 'rsi15m_4h';
    const exchange   = args[3] ?? 'binance';
    const capital    = parseFloat(args[4] ?? '100');

    if (!symbol) {
      console.log('Uso: node trading-rsi-15m-ma4h.js --backtest <SYMBOL> [strategyId] [exchange] [capital]');
      console.log('\nEstratégias disponíveis:');
      for (const [id, s] of Object.entries(STRATEGIES))
        console.log(`  ${id.padEnd(22)} ${s.label}`);
      process.exit(0);
    }

    await Promise.all([syncBinanceClock(), syncGateClock()]);

    const toTest = STRATEGIES[strategyId] ? [strategyId] : Object.keys(STRATEGIES);
    for (const sid of toTest) await backtest(symbol, sid, exchange, capital);
    console.log();
    process.exit(0);
  }

  // ── Modo bot ───────────────────────────────────────────────────────────────
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
    console.error('❌ Nenhum símbolo em rsi_multi_bot_state.');
    process.exit(1);
  }

  // Este bot só gerencia suas próprias estratégias
  const knownIds = new Set(Object.keys(STRATEGIES));
  rows = rows.filter(r => knownIds.has(r.strategy_id));

  if (symbolFilter) {
    rows = rows.filter(r => r.symbol.toUpperCase() === symbolFilter);
    if (!rows.length) {
      console.error(`❌ Símbolo "${symbolFilter}" com estratégia deste bot não encontrado.`);
      process.exit(1);
    }
    console.log(`   🔎 Filtrando apenas: ${symbolFilter}`);
  }

  if (!rows.length) {
    console.error(`❌ Nenhuma linha com strategy_id deste bot. Suportados: ${[...knownIds].join(', ')}`);
    process.exit(1);
  }

  console.log('\n🤖 RSI 15m + MA50(4h) Adaptive Bot');
  console.log('   Estratégias:');
  for (const [id, s] of Object.entries(STRATEGIES))
    console.log(`   • ${id}: ${s.label}`);
  console.log();

  const toStart = [];

  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
    const color   = COLORS[i % COLORS.length];

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
      if (!symbolFilter) {
        const resp = await askUser(`   Incluir ${row.symbol} mesmo assim? [s/N]: `);
        if (resp !== 's' && resp !== 'sim') { console.log(`   ⏭️  ${row.symbol} ignorado.\n`); continue; }
      } else {
        console.log(`   ℹ️  Incluindo mesmo assim (símbolo solicitado via --symbol)`);
      }
    }

    toStart.push({ row, color });
  }

  console.log();
  if (!toStart.length) { console.error('❌ Nenhum símbolo aprovado.'); process.exit(0); }

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
