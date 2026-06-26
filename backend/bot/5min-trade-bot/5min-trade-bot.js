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
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { sendWhatsApp } = require('../whatsapp');
const { checkMaFiltersLive, describeMaFilters } = require('./maFilter');

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
const COLORS = ['\x1b[94m','\x1b[93m','\x1b[95m','\x1b[96m','\x1b[92m','\x1b[91m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[34m'];

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

function formatCooldown(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
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
      name:         'Gate.io',
      pair,
      fetchCandles: (lim, iv)  => fetchGateCandles(pair, lim, iv),
      marketBuy:    (usdt)    => gateMarketBuy(pair, usdt),
      marketSell:   (qty, log) => gateMarketSell(pair, qty, log),
      fetch24hVol:  ()         => gate24hVolume(pair),
      getBalance:   ()         => gateGetTokenBalance(pair),
    };
  }
  return {
    name:         'Binance',
    pair:         symbol,
    fetchCandles: (lim, iv)  => fetchBinanceCandles(symbol, lim, iv),
    marketBuy:    (usdt)     => binanceMarketBuy(symbol, usdt),
    marketSell:   (qty, _log) => binanceMarketSell(symbol, qty),
    fetch24hVol:  ()          => binance24hVolume(symbol),
    getBalance:   async () => {
      const account = await binanceReq('GET', '/api/v3/account');
      const base    = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol.slice(0, -3);
      const asset   = account.balances.find(b => b.asset === base);
      return asset ? parseFloat(asset.free) : 0;
    },
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

// ── Compra (primeira ou DCA) ──────────────────────────────────────────────────
async function executeBuy(rowId, adapter, log, state, rsi, capitalPerEntry, isDca, rsiBuy) {
  const { symbol } = state;
  const usdtAmount = parseFloat(capitalPerEntry);

  log(`${G}📍 RSI(5m)=${rsi.toFixed(2)} < ${rsiBuy}${isDca ? ' [DCA]' : ''} — comprando ${usdtAmount.toFixed(4)} USDT${X}`);

  let result;
  try {
    result = await adapter.marketBuy(usdtAmount);
  } catch (err) {
    log(`❌ Erro na compra: ${err.message}`);
    return null;
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
  });

  log(`${'─'.repeat(60)}`);
  log(`${G}🟢 COMPRA${isDca ? ' DCA' : ''} #${buyCount}${X}`);
  log(`   Preço      : ${avgPrice.toFixed(6)}`);
  log(`   Qty +      : ${filledQty}  (total: ${newQty.toFixed(8)})`);
  log(`   USDT +     : ${quoteQty.toFixed(4)}  (total: ${newUsdt.toFixed(4)})`);
  log(`   Preço méd. : ${avgEntry.toFixed(6)}`);
  log(`   RSI        : ${rsi.toFixed(2)}`);
  log(`${'─'.repeat(60)}`);
  sendWhatsApp(
    `🟢 [5m Trade] ${symbol} COMPRA${isDca ? ' DCA' : ''} #${buyCount} [${adapter.name}]\n` +
    `Preço: ${avgPrice.toFixed(6)}\nQty+: ${filledQty}\nTotal qty: ${newQty.toFixed(8)}\n` +
    `USDT+: ${quoteQty.toFixed(4)} (total: ${newUsdt.toFixed(4)})\nRSI(5m): ${rsi.toFixed(2)}`,
  );

  return { newQty, newUsdt, buyCount };
}

function canBuyAgain(lastBuyTime) {
  if (!lastBuyTime) return true;
  const elapsed = Date.now() - new Date(lastBuyTime).getTime();
  return elapsed >= ENTRY_COOLDOWN_MS;
}

// ── Tick ──────────────────────────────────────────────────────────────────────
async function tick(rowId, adapter, log, prevRsi = null) {
  const candles = await adapter.fetchCandles(CANDLE_LIMIT, INTERVAL);
  const closes  = candles.map(c => c.close);

  if (closes.length < RSI_PERIOD + 2) { log('Dados insuficientes — aguardando.'); return prevRsi; }

  const rsiVals = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  const rsi     = rsiVals[rsiVals.length - 1];
  const close   = closes[closes.length - 1];

  if (rsi == null) { log('RSI insuficiente.'); return prevRsi; }

  const rows = await sbReq('GET', 'five_min_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) { log('❌ Linha não encontrada no Supabase.'); return rsi; }

  const rsiBuy           = Number(state.rsi_buy  ?? RSI_BUY);
  const rsiSell          = Number(state.rsi_sell ?? RSI_SELL);
  const buyFastThreshold  = rsiBuy  + RSI_FAST_MARGIN;
  const sellFastThreshold = rsiSell - RSI_FAST_MARGIN;

  if (prevRsi !== null) {
    const isNearNow  = rsi     <= buyFastThreshold || rsi     >= sellFastThreshold;
    const wasNearPrev = prevRsi <= buyFastThreshold || prevRsi >= sellFastThreshold;
    if (isNearNow && !wasNearPrev)
      log(`⚡ RSI=${rsi.toFixed(2)} próximo de limiar (≤${buyFastThreshold} ou ≥${sellFastThreshold}) — poll 1min`);
    else if (!isNearNow && wasNearPrev)
      log(`🔄 RSI=${rsi.toFixed(2)} longe dos limiares — poll 3min`);
  }

  const { phase, capital, symbol } = state;
  const capitalPerEntry = parseFloat(capital);
  const buyCount        = state.buy_count || 0;

  const rsiColor = rsi > rsiSell ? R : rsi < rsiBuy ? G : '';
  const nearBuy  = rsi <= buyFastThreshold;
  const nearSell = rsi >= sellFastThreshold;
  const fastMark = (nearBuy || nearSell) ? ' ⚡' : '';
  log(
    `${rsiColor}RSI=${rsi.toFixed(2)}${rsiColor ? X : ''}${fastMark}` +
    `  close=${close.toFixed(6)}` +
    `  limiar <${rsiBuy} >${rsiSell}` +
    (state.ma_filters?.enabled ? `  ${describeMaFilters(state.ma_filters)}` : '') +
    `  capital/entrada=${capitalPerEntry.toFixed(4)} USDT` +
    `  fase=${phase}` +
    (phase === 'BOUGHT' ? `  entradas=${buyCount}  qty=${parseFloat(state.buy_qty || 0).toFixed(6)}` : ''),
  );

  // ── WATCHING: primeira entrada ────────────────────────────────────────────
  if (phase === 'WATCHING') {
    if (rsi >= rsiBuy) return rsi;
    const maCheck = await checkMaFiltersLive(adapter, state.ma_filters, log);
    if (!maCheck.ok) return rsi;
    await executeBuy(rowId, adapter, log, state, rsi, capitalPerEntry, false, rsiBuy);
    return rsi;
  }

  // ── BOUGHT: venda total ou DCA ────────────────────────────────────────────
  if (phase === 'BOUGHT') {
    if (rsi > rsiSell) {
      const balance = await adapter.getBalance();
      const sellQty = Math.max(parseFloat(state.buy_qty || 0), balance);

      log(`${R}📈 RSI(5m)=${rsi.toFixed(2)} > ${rsiSell} — vendendo tudo (${sellQty.toFixed(8)} ${symbol})${X}`);

      let result;
      try {
        result = await adapter.marketSell(sellQty, log);
      } catch (err) {
        log(`❌ Erro na venda: ${err.message}`);
        return rsi;
      }

      const { soldQty, usdtOut, exitPrice } = result;
      const totalIn         = parseFloat(state.buy_usdt);
      const pnlUsdt         = usdtOut - totalIn;
      const pnlPct          = (pnlUsdt / totalIn) * 100;
      const capitalBefore   = capitalPerEntry;
      const capitalAfter    = capitalBefore + pnlUsdt;
      const pnlSign         = pnlUsdt >= 0 ? '+' : '';

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
      });

      log(`${'─'.repeat(60)}`);
      log(`${R}🔴 VENDA TOTAL (${buyCount} entrada${buyCount > 1 ? 's' : ''})${X}`);
      log(`   Preço médio saída : ${exitPrice.toFixed(6)}`);
      log(`   Qty vendida       : ${soldQty}`);
      log(`   USDT investido    : ${totalIn.toFixed(4)}`);
      log(`   USDT recebido     : ${usdtOut.toFixed(4)}`);
      log(`   PnL               : ${pnlSign}${pnlUsdt.toFixed(4)} USDT  (${pnlSign}${pnlPct.toFixed(2)}%)`);
      log(`   RSI saída         : ${rsi.toFixed(2)}`);
      log(`   Capital           : ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)} USDT`);
      log(`${'─'.repeat(60)}`);
      sendWhatsApp(
        `🔴 [5m Trade] ${symbol} VENDA TOTAL [${adapter.name}]\n` +
        `Entradas: ${buyCount}\nPreço saída: ${exitPrice.toFixed(6)}\n` +
        `USDT investido: ${totalIn.toFixed(4)}\nUSDT recebido: ${usdtOut.toFixed(4)}\n` +
        `PnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)\n` +
        `Capital: ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)} USDT\nRSI(5m): ${rsi.toFixed(2)}`,
      );
      return rsi;
    }

    if (rsi < rsiBuy) {
      if (!canBuyAgain(state.last_buy_time)) {
        const remaining = ENTRY_COOLDOWN_MS - (Date.now() - new Date(state.last_buy_time).getTime());
        log(`${Y}⏳ RSI < ${rsiBuy} mas cooldown DCA: faltam ${formatCooldown(remaining)}${X}`);
        return rsi;
      }
      const maCheck = await checkMaFiltersLive(adapter, state.ma_filters, log);
      if (!maCheck.ok) return rsi;
      await executeBuy(rowId, adapter, log, state, rsi, capitalPerEntry, true, rsiBuy);
    }
  }

  return rsi;
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
    `compra < ${rsiBuy} | venda > ${rsiSell} | DCA cooldown ${ENTRY_COOLDOWN_MS / 3_600_000}h | ` +
    `poll 3min / 1min (RSI≤${buyFastThreshold} ou ≥${sellFastThreshold}) | fase: ${row.phase} ===`,
  );
  if (row.phase === 'BOUGHT') {
    log(
      `♻️  Posição aberta — ${row.buy_count || 1} entrada(s) | ` +
      `qty=${parseFloat(row.buy_qty).toFixed(8)} | médio=${parseFloat(row.buy_price).toFixed(6)} | ` +
      `última compra: ${row.last_buy_time || row.buy_time}`,
    );
  }

  let lastRsi  = null;
  let errCount = 0;

  const schedule = () => {
    const nearBuy  = lastRsi !== null && lastRsi <= buyFastThreshold;
    const nearSell = lastRsi !== null && lastRsi >= sellFastThreshold;
    const delay    = (nearBuy || nearSell) ? FAST_POLL_MS : POLL_MS;
    setTimeout(run, delay);
  };

  const run = async () => {
    try {
      lastRsi  = await tick(row.id, adapter, log, lastRsi);
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

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
