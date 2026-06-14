'use strict';

/**
 * Name Every Trading (NET) Bot — múltiplas moedas
 *
 * Regras:
 *   Entrada  : RSI(14,1h) < 30 → aguarda queda de 3% (PENDING) → compra a mercado
 *   Stop loss: 3% abaixo do preço de compra (saída automática)
 *   Saída    : RSI(14,1h) > 70 → vende a mercado
 *   Sem filtro EMA200
 *   Poll rápido (1 min): fase PENDING | RSI >= 68 (BOUGHT) | próximo do stop
 *   Poll normal (5 min): demais situações
 *
 * Estado: tabela net_bot_state (ver net-bot.sql)
 * Uso: node backend/bot/nameEveryTrading.js
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
const INTERVAL           = '1h';
const RSI_PERIOD         = 14;
const RSI_BUY            = 30;
const RSI_SELL           = 70;
const RSI_FAST_THRESHOLD = 68;
const ENTRY_DISCOUNT     = 0.01;   // compra 1% abaixo do close quando RSI < 30
const STOP_LOSS_PCT      = 0.03;   // stop loss 3% abaixo do preço de compra
const PENDING_CANCEL_PCT = 0.005;  // cancela PENDING se preço subir 0.5% acima do gatilho
const PENDING_TIMEOUT_MS = 24 * 60 * 60_000; // cancela PENDING após 24 horas
const CANDLE_LIMIT       = 250;
const POLL_MS            = 5 * 60_000;
const FAST_POLL_MS       = 60_000;
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
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtP(n) {
  if (n == null) return '—';
  return n < 0.01 ? Number(n).toFixed(6) : n < 1 ? Number(n).toFixed(4) : Number(n).toFixed(2);
}

function makeLogger(symbol, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-net.txt`);
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
  const soldQty  = parseFloat(order.executedQty);
  const usdtOut  = parseFloat(order.cummulativeQuoteQty);
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
  return sbReq('GET', 'net_bot_state', null, '?order=id.asc');
}

async function loadState(id) {
  const rows = await sbReq('GET', 'net_bot_state', null, `?id=eq.${id}&limit=1`);
  return rows?.[0] ?? null;
}

async function saveState(id, update) {
  await sbReq('PATCH', 'net_bot_state', { ...update, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
}

async function insertTrade(trade) {
  await sbReq('POST', 'net_bot_trades', trade);
}

// ── Tick ──────────────────────────────────────────────────────────────────────
// Retorna { rsi, phase, nearStop } para que startSymbol ajuste o polling
async function tick(rowId, adapter, log, prevRsi = null) {
  const candles = await adapter.fetchCandles(CANDLE_LIMIT, INTERVAL);
  const closes  = candles.map(c => c.close);
  if (closes.length < RSI_PERIOD + 10) { log('Dados insuficientes — aguardando.'); return { rsi: prevRsi, phase: 'WATCHING', nearStop: false }; }

  const rsiArr = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  const rsi    = rsiArr[rsiArr.length - 1];
  const close  = closes[closes.length - 1];
  if (rsi == null) { log('RSI insuficiente.'); return { rsi: prevRsi, phase: 'WATCHING', nearStop: false }; }

  if (prevRsi !== null) {
    if (rsi >= RSI_FAST_THRESHOLD && prevRsi < RSI_FAST_THRESHOLD)
      log(`⚡ RSI=${rsi.toFixed(1)} ≥ ${RSI_FAST_THRESHOLD} — acelerando para 1 min`);
    else if (rsi < RSI_FAST_THRESHOLD && prevRsi >= RSI_FAST_THRESHOLD)
      log(`🔄 RSI=${rsi.toFixed(1)} < ${RSI_FAST_THRESHOLD} — voltando a ${POLL_MS / 60_000} min`);
  }

  const state = await loadState(rowId);
  if (!state) { log('❌ Linha não encontrada no Supabase.'); return { rsi, phase: 'WATCHING', nearStop: false }; }

  const { phase, capital, symbol } = state;

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    const rsiColor = rsi < RSI_BUY ? G : '';
    const fastMark = rsi >= RSI_FAST_THRESHOLD ? ' ⚡' : '';
    log(`${rsiColor}RSI=${rsi.toFixed(1)}${rsiColor ? X : ''}${fastMark}  $${fmtP(close)}  capital=$${parseFloat(capital).toFixed(2)}  [WATCHING]`);

    if (rsi < RSI_BUY) {
      const limitPrice = parseFloat((close * (1 - ENTRY_DISCOUNT)).toFixed(8));
      log(`${G}🎯 RSI=${rsi.toFixed(1)} < ${RSI_BUY} → alvo: $${fmtP(limitPrice)} (-${ENTRY_DISCOUNT * 100}%)  [aguardando PENDING]${X}`);
      await saveState(rowId, {
        phase: 'PENDING',
        trigger_price: close, limit_price: limitPrice,
        trigger_rsi: rsi, pending_since: new Date().toISOString(),
      });
      sendWhatsApp(`🎯 ${symbol} NET\nRSI=${rsi.toFixed(1)} < ${RSI_BUY}\nAlvo: $${fmtP(limitPrice)} (-${ENTRY_DISCOUNT * 100}%)\nAtual: $${fmtP(close)}`);
      return { rsi, phase: 'PENDING', nearStop: false };
    }

    return { rsi, phase: 'WATCHING', nearStop: false };
  }

  // ── PENDING: aguardando queda até limit_price ─────────────────────────────
  if (phase === 'PENDING') {
    const limitPrice   = parseFloat(state.limit_price);
    const triggerPrice = parseFloat(state.trigger_price);
    const pendingMs    = Date.now() - new Date(state.pending_since).getTime();
    const distPct      = ((close - limitPrice) / limitPrice * 100).toFixed(1);
    const cancelLine   = triggerPrice * (1 + PENDING_CANCEL_PCT);

    log(`⏳ RSI=${rsi.toFixed(1)}  $${fmtP(close)}  alvo=$${fmtP(limitPrice)}  dist=${distPct}%  [PENDING ${fmtDur(pendingMs)}]`);

    // Cancela: preço subiu acima do gatilho ou timeout
    if (close > cancelLine || pendingMs > PENDING_TIMEOUT_MS) {
      const reason = close > cancelLine
        ? `preço recuperou ($${fmtP(close)} > $${fmtP(triggerPrice)})`
        : `timeout ${fmtDur(PENDING_TIMEOUT_MS)}`;
      log(`❌ Cancelando PENDING — ${reason}`);
      await saveState(rowId, {
        phase: 'WATCHING',
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      sendWhatsApp(`❌ ${symbol} NET — PENDING cancelado\nMotivo: ${reason}`);
      return { rsi, phase: 'WATCHING', nearStop: false };
    }

    // Alvo atingido: compra a mercado
    if (close <= limitPrice) {
      log(`${G}✅ Alvo -${ENTRY_DISCOUNT * 100}% atingido! Comprando...${X}`);
      let result;
      try {
        result = await adapter.marketBuy(parseFloat(capital));
      } catch (err) {
        log(`❌ Erro na compra: ${err.message}`);
        return { rsi, phase: 'PENDING', nearStop: false };
      }
      const { filledQty, quoteQty, avgPrice } = result;
      const stopLoss = parseFloat((avgPrice * (1 - STOP_LOSS_PCT)).toFixed(8));
      await saveState(rowId, {
        phase: 'BOUGHT',
        buy_price: avgPrice, buy_qty: filledQty, buy_usdt: quoteQty,
        buy_time: new Date().toISOString(), stop_loss: stopLoss, rsi_entry: rsi,
        trigger_price: null, limit_price: null, trigger_rsi: null, pending_since: null,
      });
      log('─'.repeat(60));
      log(`${G}🟢 COMPRA EXECUTADA${X}`);
      log(`   Preço médio : $${fmtP(avgPrice)}`);
      log(`   Qty         : ${filledQty}`);
      log(`   USDT gasto  : $${quoteQty.toFixed(4)}`);
      log(`   Stop loss   : $${fmtP(stopLoss)} (-${STOP_LOSS_PCT * 100}%)`);
      log(`   RSI entrada : ${rsi.toFixed(1)}`);
      log('─'.repeat(60));
      sendWhatsApp(`🟢 ${symbol} COMPRA [${adapter.name}]\nPreço: $${fmtP(avgPrice)}\nQty: ${filledQty}\nUSDT: $${quoteQty.toFixed(2)}\nStop: $${fmtP(stopLoss)}\nRSI: ${rsi.toFixed(1)}`);
      return { rsi, phase: 'BOUGHT', nearStop: false };
    }

    return { rsi, phase: 'PENDING', nearStop: false };
  }

  // ── BOUGHT: monitora RSI > 70 e stop loss ────────────────────────────────
  if (phase === 'BOUGHT') {
    const buyPrice = parseFloat(state.buy_price);
    const stopLoss = parseFloat(state.stop_loss);
    const pnlPct   = ((close - buyPrice) / buyPrice * 100).toFixed(1);
    const nearStop = close <= stopLoss * 1.01;
    const pnlColor = parseFloat(pnlPct) >= 0 ? G : R;
    const rsiColor = rsi >= RSI_FAST_THRESHOLD ? Y : rsi > RSI_SELL ? R : '';
    const fastMark = rsi >= RSI_FAST_THRESHOLD ? ' ⚡' : '';
    const stopMark = nearStop ? ` ${R}⚠️ PRÓXIMO STOP${X}` : '';

    log(
      `${rsiColor}RSI=${rsi.toFixed(1)}${rsiColor ? X : ''}${fastMark}` +
      `  $${fmtP(close)}  buy=$${fmtP(buyPrice)}` +
      `  ${pnlColor}PnL=${pnlPct}%${X}` +
      `  stop=$${fmtP(stopLoss)}` +
      `  [BOUGHT]${stopMark}`,
    );

    let exitReason = null;
    if (close <= stopLoss) {
      exitReason = 'STOP_LOSS';
      log(`${R}🛑 STOP LOSS! close=$${fmtP(close)} ≤ stop=$${fmtP(stopLoss)}${X}`);
    } else if (rsi > RSI_SELL) {
      exitReason = 'RSI_SELL';
      log(`${R}📈 RSI=${rsi.toFixed(1)} > ${RSI_SELL} — saindo${X}`);
    }

    if (exitReason) {
      let result;
      try {
        result = await adapter.marketSell(parseFloat(state.buy_qty), log);
      } catch (err) {
        log(`❌ Erro na venda: ${err.message}`);
        return { rsi, phase: 'BOUGHT', nearStop };
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
        exit_reason: exitReason,
      });

      await saveState(rowId, {
        phase: 'WATCHING', capital: capitalAfter,
        buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null,
        stop_loss: null, rsi_entry: null,
      });

      const icon = exitReason === 'STOP_LOSS' ? '🛑' : '🔴';
      log('─'.repeat(60));
      log(`${icon} VENDA (${exitReason})`);
      log(`   Preço médio : $${fmtP(exitPrice)}`);
      log(`   Qty         : ${soldQty}`);
      log(`   USDT rec.   : $${usdtOut.toFixed(4)}`);
      log(`   PnL         : ${pnlSign}$${pnlUsdt.toFixed(4)} (${pnlSign}${pnlPctFinal}%)`);
      log(`   RSI saída   : ${rsi.toFixed(1)}`);
      log(`   Capital     : $${capitalBefore.toFixed(4)} → $${capitalAfter.toFixed(4)}`);
      log('─'.repeat(60));
      sendWhatsApp(`${icon} ${symbol} VENDA (${exitReason}) [${adapter.name}]\nPreço: $${fmtP(exitPrice)}\nUSDT rec.: $${usdtOut.toFixed(2)}\nPnL: ${pnlSign}$${pnlUsdt.toFixed(2)} (${pnlSign}${pnlPctFinal}%)\nCapital: $${capitalBefore.toFixed(2)} → $${capitalAfter.toFixed(2)}\nRSI: ${rsi.toFixed(1)}`);

      return { rsi, phase: 'WATCHING', nearStop: false };
    }

    return { rsi, phase: 'BOUGHT', nearStop };
  }

  return { rsi: rsi ?? prevRsi, phase, nearStop: false };
}

// ── Inicialização por símbolo ─────────────────────────────────────────────────
async function startSymbol(row, color) {
  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, color);

  log(
    `=== NET Bot iniciado | ${adapter.name} | ${adapter.pair}` +
    ` | RSI(${RSI_PERIOD},${INTERVAL}) | entry -${ENTRY_DISCOUNT * 100}% | stop -${STOP_LOSS_PCT * 100}%` +
    ` | poll: ${POLL_MS / 60_000}min normal / 1min rápido | fase: ${row.phase} ===`,
  );
  if (row.phase === 'BOUGHT') {
    log(`♻️  Posição aberta — comprado a $${fmtP(row.buy_price)} | qty=${row.buy_qty} | stop=$${fmtP(row.stop_loss)}`);
  }
  if (row.phase === 'PENDING') {
    const pendingMs = Date.now() - new Date(row.pending_since).getTime();
    log(`♻️  PENDING — alvo=$${fmtP(row.limit_price)} | gatilho=$${fmtP(row.trigger_price)} | há ${fmtDur(pendingMs)}`);
  }

  let lastResult = { rsi: null, phase: row.phase, nearStop: false };
  let errCount   = 0;

  const schedule = () => {
    const { phase, rsi, nearStop } = lastResult;
    const fast  = phase === 'PENDING' || nearStop || (rsi !== null && rsi >= RSI_FAST_THRESHOLD);
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
    console.error('❌ Nenhum símbolo em net_bot_state. Execute net-bot.sql no Supabase.');
    process.exit(1);
  }

  console.log('\n🤖 Name Every Trading (NET) Bot');
  console.log(`   Entrada  : RSI(${RSI_PERIOD}, ${INTERVAL}) < ${RSI_BUY} → aguarda -${ENTRY_DISCOUNT * 100}% (PENDING)`);
  console.log(`   Stop loss: -${STOP_LOSS_PCT * 100}% do preço de compra`);
  console.log(`   Saída    : RSI(${RSI_PERIOD}, ${INTERVAL}) > ${RSI_SELL}`);
  console.log(`   Poll     : ${POLL_MS / 60_000}min normal | 1min (PENDING / RSI≥${RSI_FAST_THRESHOLD} / próx. stop)\n`);

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
