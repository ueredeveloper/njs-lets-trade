'use strict';

/**
 * Trading RSI(14,1m) + MA50(1h) Bot — múltiplas moedas
 *
 * Regras:
 *   Filtro    : preço > MA50(1h)  — só opera em tendência de alta no horário
 *   Entrada   : RSI(14,1m) < 30  → aguarda queda de 0,1% (PENDING) → compra a mercado
 *   Saída     : RSI(14,1m) > 70  → vende a mercado
 *   Sem stop loss
 *   Poll      : 60s normal | 30s quando RSI(1m) ≥ 65 ou fase PENDING
 *
 * Estado: tabela ma50_bot_state (ver ma50-bot.sql)
 * Uso   : node backend/bot/trading-rsi-35-70-ma-50-1h.js
 */

const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { sendWhatsApp } = require('../whatsapp');

// ── Configuração ──────────────────────────────────────────────────────────────
const INTERVAL_RSI       = '1m';   // RSI calculado em 1 minuto
const INTERVAL_MA        = '1h';   // MA50 calculada em 1 hora
const MA_PERIOD          = 50;
const RSI_PERIOD         = 14;
const RSI_BUY            = 30;
const RSI_SELL           = 70;
const RSI_FAST_THRESHOLD = 65;     // ≥ 65 em 1m → poll a cada 30s
const CANDLE_LIMIT_RSI   = 100;    // 1m candles para RSI(14) + margem
const CANDLE_LIMIT_MA    = 55;     // 1h candles para MA50 + margem
const ENTRY_DISCOUNT     = 0.001;  // 0,1% abaixo do close quando RSI < 30
const PENDING_CANCEL_PCT = 0.002;  // cancela PENDING se preço subir 0,2% acima do gatilho
const PENDING_TIMEOUT_MS = 30 * 60_000; // cancela PENDING após 30 min (30 candles de 1m)
const POLL_MS            = 60_000;      // 60s — intervalo normal (1 candle de 1m)
const FAST_POLL_MS       = 30_000;      // 30s — quando RSI alto ou PENDING
const VOL_MIN_USDT       = 1_000_000;
const GATE_FEE_RATE      = 0.002;

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

function makeLogger(symbol, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-ma50.txt`);
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
  const order    = await binanceReq('POST', '/api/v3/order', {
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
    fetchCandles: (lim, iv)  => fetchBinanceCandles(symbol, lim, iv),
    marketBuy:    (usdt)     => binanceMarketBuy(symbol, usdt),
    marketSell:   (qty, _log)=> binanceMarketSell(symbol, qty),
    fetch24hVol:  ()         => binance24hVolume(symbol),
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

async function loadAllRows() {
  return sbReq('GET', 'ma50_bot_state', null, '?order=id.asc');
}

async function loadState(id) {
  const rows = await sbReq('GET', 'ma50_bot_state', null, `?id=eq.${id}&limit=1`);
  return rows?.[0] ?? null;
}

async function saveState(id, update) {
  await sbReq('PATCH', 'ma50_bot_state', { ...update, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
}

async function insertTrade(trade) {
  await sbReq('POST', 'ma50_bot_trades', trade);
}

// ── Tick ──────────────────────────────────────────────────────────────────────
// Retorna { rsi, phase } para que startSymbol ajuste o polling
async function tick(rowId, adapter, log, prevRsi = null) {
  // Busca candles de dois timeframes em paralelo
  const [candles1m, candles1h] = await Promise.all([
    adapter.fetchCandles(CANDLE_LIMIT_RSI, INTERVAL_RSI),
    adapter.fetchCandles(CANDLE_LIMIT_MA,  INTERVAL_MA),
  ]);

  const closes1m = candles1m.map(c => c.close);
  const closes1h = candles1h.map(c => c.close);

  if (closes1m.length < RSI_PERIOD + 2) {
    log('Dados 1m insuficientes.'); return { rsi: prevRsi, phase: 'WATCHING' };
  }
  if (closes1h.length < MA_PERIOD + 2) {
    log('Dados 1h insuficientes para MA50.'); return { rsi: prevRsi, phase: 'WATCHING' };
  }

  const rsiArr  = ti.RSI.calculate({ values: closes1m, period: RSI_PERIOD });
  const maArr   = ti.SMA.calculate({ values: closes1h, period: MA_PERIOD });

  const rsi    = rsiArr[rsiArr.length - 1];
  const ma50   = maArr[maArr.length - 1];
  const close  = closes1m[closes1m.length - 1]; // preço atual (último candle 1m)
  const bullish = close > ma50;

  if (rsi == null || ma50 == null) { log('Indicadores insuficientes.'); return { rsi: prevRsi, phase: 'WATCHING' }; }

  // Transição de velocidade de poll
  if (prevRsi !== null) {
    if (rsi >= RSI_FAST_THRESHOLD && prevRsi < RSI_FAST_THRESHOLD)
      log(`⚡ RSI(1m)=${rsi.toFixed(1)} ≥ ${RSI_FAST_THRESHOLD} — acelerando para 30s`);
    else if (rsi < RSI_FAST_THRESHOLD && prevRsi >= RSI_FAST_THRESHOLD)
      log(`🔄 RSI(1m)=${rsi.toFixed(1)} < ${RSI_FAST_THRESHOLD} — voltando a 60s`);
  }

  const state = await loadState(rowId);
  if (!state) { log('❌ Linha não encontrada no Supabase.'); return { rsi, phase: 'WATCHING' }; }

  const { phase, capital, symbol } = state;

  const trendStr = bullish
    ? `${G}↑ MA50=${fmtP(ma50)}${X}`
    : `${R}↓ MA50=${fmtP(ma50)}${X}`;

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    const rsiColor = rsi < RSI_BUY ? G : rsi >= RSI_FAST_THRESHOLD ? Y : '';
    const fastMark = rsi >= RSI_FAST_THRESHOLD ? ' ⚡' : '';
    log(`${rsiColor}RSI(1m)=${rsi.toFixed(1)}${rsiColor ? X : ''}${fastMark}  $${fmtP(close)}  ${trendStr}  capital=$${parseFloat(capital).toFixed(2)}  [WATCHING]`);

    if (rsi < RSI_BUY) {
      if (!bullish) {
        log(`${Y}⚠️  RSI(1m)=${rsi.toFixed(1)} < ${RSI_BUY} mas preço < MA50(1h)=$${fmtP(ma50)} — tendência baixa, bloqueado${X}`);
        sendWhatsApp(`⚠️ ${symbol} RSI(1m)<${RSI_BUY} mas abaixo MA50(1h)=$${fmtP(ma50)} — entrada bloqueada`);
        return { rsi, phase: 'WATCHING' };
      }
      const limitPrice = parseFloat((close * (1 - ENTRY_DISCOUNT)).toFixed(8));
      log(`${G}🎯 RSI(1m)=${rsi.toFixed(1)} < ${RSI_BUY} + acima MA50 → alvo $${fmtP(limitPrice)} (-${ENTRY_DISCOUNT * 100}%) [PENDING]${X}`);
      await saveState(rowId, {
        phase: 'PENDING',
        trigger_price: close, limit_price: limitPrice,
        trigger_rsi: rsi, pending_since: new Date().toISOString(),
      });
      sendWhatsApp(`🎯 ${symbol} MA50\nRSI(1m)=${rsi.toFixed(1)} < ${RSI_BUY}\nAlvo: $${fmtP(limitPrice)} (-${ENTRY_DISCOUNT * 100}%)\nMA50(1h): $${fmtP(ma50)}`);
      return { rsi, phase: 'PENDING' };
    }

    return { rsi, phase: 'WATCHING' };
  }

  // ── PENDING: aguardando queda de 0,1% ────────────────────────────────────
  if (phase === 'PENDING') {
    const limitPrice   = parseFloat(state.limit_price);
    const triggerPrice = parseFloat(state.trigger_price);
    const pendingMs    = Date.now() - new Date(state.pending_since).getTime();
    const distPct      = ((close - limitPrice) / limitPrice * 100).toFixed(2);
    const cancelLine   = triggerPrice * (1 + PENDING_CANCEL_PCT);

    log(`⏳ RSI(1m)=${rsi.toFixed(1)}  $${fmtP(close)}  alvo=$${fmtP(limitPrice)}  dist=${distPct}%  ${trendStr}  [PENDING ${fmtDur(pendingMs)}]`);

    // Cancela: preço subiu acima do threshold ou timeout
    if (close > cancelLine || pendingMs > PENDING_TIMEOUT_MS) {
      const reason = close > cancelLine
        ? `preço recuperou ($${fmtP(close)} > $${fmtP(triggerPrice)})`
        : `timeout ${fmtDur(PENDING_TIMEOUT_MS)}`;
      log(`❌ Cancelando PENDING — ${reason}`);
      await saveState(rowId, {
        phase: 'WATCHING',
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      return { rsi, phase: 'WATCHING' };
    }

    // Alvo atingido — compra a mercado
    if (close <= limitPrice) {
      log(`${G}✅ Alvo -${ENTRY_DISCOUNT * 100}% atingido! Comprando $${parseFloat(capital).toFixed(2)}...${X}`);
      let result;
      try {
        result = await adapter.marketBuy(parseFloat(capital));
      } catch (err) {
        log(`❌ Erro na compra: ${err.message}`);
        return { rsi, phase: 'PENDING' };
      }
      const { filledQty, quoteQty, avgPrice } = result;
      await saveState(rowId, {
        phase: 'BOUGHT',
        buy_price: avgPrice, buy_qty: filledQty, buy_usdt: quoteQty,
        buy_time: new Date().toISOString(), rsi_entry: rsi, ma50_entry: ma50,
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      log('─'.repeat(60));
      log(`${G}🟢 COMPRA${X}  preço=$${fmtP(avgPrice)}  qty=${filledQty}  USDT=$${quoteQty.toFixed(2)}`);
      log(`   RSI(1m)=${rsi.toFixed(1)}  MA50(1h)=$${fmtP(ma50)}  ${bullish ? '↑ ALTA' : '↓ BAIXA'}`);
      log('─'.repeat(60));
      sendWhatsApp(`🟢 ${symbol} COMPRA [${adapter.name}]\nPreço: $${fmtP(avgPrice)}\nQty: ${filledQty}\nUSDT: $${quoteQty.toFixed(2)}\nRSI(1m): ${rsi.toFixed(1)}\nMA50(1h): $${fmtP(ma50)}`);
      return { rsi, phase: 'BOUGHT' };
    }

    return { rsi, phase: 'PENDING' };
  }

  // ── BOUGHT: aguarda RSI(1m) > 70 ─────────────────────────────────────────
  if (phase === 'BOUGHT') {
    const buyPrice = parseFloat(state.buy_price);
    const pnlPct   = ((close - buyPrice) / buyPrice * 100).toFixed(2);
    const pnlColor = parseFloat(pnlPct) >= 0 ? G : R;
    const rsiColor = rsi >= RSI_FAST_THRESHOLD ? Y : rsi > RSI_SELL ? R : '';
    const fastMark = rsi >= RSI_FAST_THRESHOLD ? ' ⚡' : '';

    log(
      `${rsiColor}RSI(1m)=${rsi.toFixed(1)}${rsiColor ? X : ''}${fastMark}` +
      `  $${fmtP(close)}  buy=$${fmtP(buyPrice)}` +
      `  ${pnlColor}PnL=${pnlPct}%${X}` +
      `  ${trendStr}  [BOUGHT]`,
    );

    if (rsi > RSI_SELL) {
      log(`${R}📈 RSI(1m)=${rsi.toFixed(1)} > ${RSI_SELL} — vendendo${X}`);
      let result;
      try {
        result = await adapter.marketSell(parseFloat(state.buy_qty), log);
      } catch (err) {
        log(`❌ Erro na venda: ${err.message}`);
        return { rsi, phase: 'BOUGHT' };
      }

      const { soldQty, usdtOut, exitPrice } = result;
      const capitalBefore = parseFloat(capital);
      const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
      const capitalAfter  = capitalBefore + pnlUsdt;
      const pnlPctFinal   = (pnlUsdt / parseFloat(state.buy_usdt) * 100).toFixed(2);
      const pnlSign       = pnlUsdt >= 0 ? '+' : '';

      await insertTrade({
        symbol, exchange: state.exchange,
        entry_time: state.buy_time, exit_time: new Date().toISOString(),
        entry_price: buyPrice, exit_price: exitPrice,
        qty: soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: usdtOut,
        pnl_usdt: pnlUsdt, pnl_pct: parseFloat(pnlPctFinal),
        capital_before: capitalBefore, capital_after: capitalAfter,
        rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: rsi,
        ma50_entry: parseFloat(state.ma50_entry ?? ma50),
      });

      await saveState(rowId, {
        phase: 'WATCHING', capital: capitalAfter,
        buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null,
        rsi_entry: null, ma50_entry: null,
      });

      const icon = pnlUsdt >= 0 ? '🔴' : '❌';
      log('─'.repeat(60));
      log(`${icon} VENDA  preço=$${fmtP(exitPrice)}  qty=${soldQty}`);
      log(`   PnL    : ${pnlSign}$${pnlUsdt.toFixed(4)} (${pnlSign}${pnlPctFinal}%)`);
      log(`   RSI(1m): ${rsi.toFixed(1)}  MA50(1h): $${fmtP(ma50)}`);
      log(`   Capital: $${capitalBefore.toFixed(4)} → $${capitalAfter.toFixed(4)}`);
      log('─'.repeat(60));
      sendWhatsApp(`🔴 ${symbol} VENDA [${adapter.name}]\nPreço: $${fmtP(exitPrice)}\nPnL: ${pnlSign}$${pnlUsdt.toFixed(2)} (${pnlSign}${pnlPctFinal}%)\nCapital: $${capitalBefore.toFixed(2)} → $${capitalAfter.toFixed(2)}\nRSI(1m): ${rsi.toFixed(1)}`);
      return { rsi, phase: 'WATCHING' };
    }

    return { rsi, phase: 'BOUGHT' };
  }

  return { rsi: rsi ?? prevRsi, phase };
}

// ── Inicialização por símbolo ─────────────────────────────────────────────────
async function startSymbol(row, color) {
  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, color);

  log(
    `=== MA50 Bot | ${adapter.name} | ${adapter.pair}` +
    ` | RSI(${RSI_PERIOD},${INTERVAL_RSI}) | MA${MA_PERIOD}(${INTERVAL_MA})` +
    ` | entry -${ENTRY_DISCOUNT * 100}% | poll: ${POLL_MS / 1000}s/${FAST_POLL_MS / 1000}s | fase: ${row.phase} ===`,
  );

  if (row.phase === 'BOUGHT') {
    log(`♻️  Posição aberta — comprado a $${fmtP(row.buy_price)} | qty=${row.buy_qty}`);
  }
  if (row.phase === 'PENDING') {
    const pendingMs = Date.now() - new Date(row.pending_since).getTime();
    log(`♻️  PENDING — alvo=$${fmtP(row.limit_price)} | gatilho=$${fmtP(row.trigger_price)} | há ${fmtDur(pendingMs)}`);
  }

  let lastResult = { rsi: null, phase: row.phase };
  let errCount   = 0;

  const schedule = () => {
    const { phase, rsi } = lastResult;
    const fast  = phase === 'PENDING' || (rsi !== null && rsi >= RSI_FAST_THRESHOLD);
    const delay = fast ? FAST_POLL_MS : POLL_MS;
    setTimeout(run, delay);
  };

  const run = async () => {
    try {
      lastResult = await tick(row.id, adapter, log, lastResult.rsi);
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
  if (!SB_URL || !SB_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  await Promise.all([syncBinanceClock(), syncGateClock()]);
  setInterval(syncBinanceClock, 60 * 60_000);
  setInterval(syncGateClock,    60 * 60_000);

  const rows = await loadAllRows();
  if (!rows?.length) {
    console.error('❌ Nenhum símbolo em ma50_bot_state. Execute ma50-bot.sql no Supabase.');
    process.exit(1);
  }

  console.log('\n🤖 Trading RSI(1m) + MA50(1h) Bot');
  console.log(`   Filtro   : preço > MA${MA_PERIOD}(${INTERVAL_MA})`);
  console.log(`   Entrada  : RSI(${RSI_PERIOD},${INTERVAL_RSI}) < ${RSI_BUY} → aguarda -${ENTRY_DISCOUNT * 100}% (PENDING, máx ${PENDING_TIMEOUT_MS / 60_000}min)`);
  console.log(`   Saída    : RSI(${RSI_PERIOD},${INTERVAL_RSI}) > ${RSI_SELL}  (sem stop loss)`);
  console.log(`   Poll     : ${POLL_MS / 1000}s normal | ${FAST_POLL_MS / 1000}s (PENDING / RSI≥${RSI_FAST_THRESHOLD})\n`);

  const toStart = [];

  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const color   = COLORS[i % COLORS.length];
    const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);

    let volFmt = 'n/a';
    let volOk  = true;
    try {
      const vol = await adapter.fetch24hVol();
      volFmt    = vol >= 1_000_000 ? `$${(vol / 1_000_000).toFixed(2)}M` : `$${(vol / 1000).toFixed(1)}K`;
      volOk     = vol >= VOL_MIN_USDT;
    } catch {}

    console.log(`   ${color}${row.symbol}${X}  exchange=${row.exchange ?? 'binance'}  capital=$${parseFloat(row.capital).toFixed(2)}  vol24h=${volFmt}  fase=${row.phase}`);

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
  if (!toStart.length) { console.error('❌ Nenhum símbolo aprovado.'); process.exit(0); }

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
