'use strict';

/**
 * Dedicated Bot — trade dedicado por moeda com capital reservado acumulado
 *
 * Filtro tendência : EMA200(1h) — só compra se preço > EMA200(1h) (alta confirmada)
 * Entrada          : RSI(14) 5m < 30
 * Saída            : RSI(14) 5m > 70  (sem stop-loss)
 * Capital          : reservado e acumulado por moeda no Supabase
 * Estado           : Supabase — acessível por qualquer computador
 *
 * Uso:
 *   node backend/bot/stgBot.js STGUSDT 40
 *   node backend/bot/stgBot.js HEMIUSDT 40 gate
 *   node backend/bot/stgBot.js BTCUSDT 100 binance
 */

const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol }  = require('../../utils/toGateSymbol');
const { sendWhatsApp }  = require('../whatsapp');

// ── Argumentos ────────────────────────────────────────────────────────────────
const SYMBOL           = (process.argv[2] || 'STGUSDT').toUpperCase();
const INITIAL_CAPITAL  = parseFloat(process.argv[3] || '40');
const EXCHANGE         = (process.argv[4] || 'binance').toLowerCase(); // 'binance' | 'gate'

// STATE_KEY: Gate.io usa sufixo _GATE para não conflitar com Binance no Supabase
const STATE_KEY = EXCHANGE === 'gate' ? `${SYMBOL}_GATE` : SYMBOL;

// ── Configuração ──────────────────────────────────────────────────────────────
const INTERVAL_RSI = '5m';
const INTERVAL_EMA = '1h';
const EMA_PERIOD   = 200;
const RSI_PERIOD   = 14;
const RSI_BUY      = 30;
const RSI_SELL     = 70;
const CANDLE_RSI   = 100;   // candles 5m para RSI
const CANDLE_EMA   = 250;   // candles 1h para EMA200 (200 + warmup)
const POLL_MS      = 60_000; // verifica a cada 60 s

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

// Retorna { filledQty, quoteQty, avgPrice }
async function binanceMarketBuy(usdtAmount) {
  const order    = await binanceReq('POST', '/api/v3/order', {
    symbol: SYMBOL, side: 'BUY', type: 'MARKET', quoteOrderQty: usdtAmount.toFixed(2),
  });
  const filledQty = parseFloat(order.executedQty);
  const quoteQty  = parseFloat(order.cummulativeQuoteQty);
  return { filledQty, quoteQty, avgPrice: quoteQty / filledQty };
}

// Retorna { soldQty, usdtOut, exitPrice }
async function binanceMarketSell(qty) {
  const info      = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${SYMBOL}`).then(r => r.json());
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const decimals  = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 0) : 0;
  const safeQty   = (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
  const order     = await binanceReq('POST', '/api/v3/order', {
    symbol: SYMBOL, side: 'SELL', type: 'MARKET', quantity: safeQty,
  });
  const soldQty = parseFloat(order.executedQty);
  const usdtOut = parseFloat(order.cummulativeQuoteQty);
  return { soldQty, usdtOut, exitPrice: usdtOut / soldQty };
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
    const offset = Math.floor(data.server_time / 1000) - Math.floor(Date.now() / 1000);
    gateClockOffsetSec = offset;
    if (Math.abs(offset) > 2)
      console.log(`⏱️  Gate.io clock offset: ${offset > 0 ? '+' : ''}${offset}s`);
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
        console.log(`⏱️  Gate.io clock auto-corrigido: offset=${gateClockOffsetSec}s — repetindo ${method}…`);
        return gateReq(method, endpointPath, params, false);
      }
    }
    throw new Error(`Gate ${method} ${endpointPath} ${res.status}: ${msg}`);
  }
  return data;
}

const GATE_FEE_RATE = 0.002; // 0.2% Gate.io taker — taxa cobrada em tokens na compra

// Retorna saldo disponível do token base do par (ex: UNA_USDT → saldo de UNA)
async function gateGetTokenBalance(pair) {
  const base     = pair.split('_')[0];
  const accounts = await gateReq('GET', '/spot/accounts');
  const acc      = accounts.find(a => a.currency === base);
  return acc ? parseFloat(acc.available) : 0;
}

// Limit IOC 0.5% acima do mercado — preenche imediatamente como market order
// Retorna { filledQty, quoteQty, avgPrice } — filledQty já líquido de taxa
async function gateMarketBuy(pair, usdtAmount) {
  const tickerUrl = `${GATE_BASE}/spot/tickers?currency_pair=${pair}`;
  const ticker    = await fetch(tickerUrl).then(r => r.json());
  const price     = parseFloat(ticker[0]?.last);
  if (!price) throw new Error(`Gate.io: preço inválido para ${pair}`);

  const limitPrice = parseFloat((price * 1.005).toFixed(8));
  const qty        = parseFloat((usdtAmount / limitPrice).toFixed(8));

  const order = await gateReq('POST', '/spot/orders', {
    currency_pair: pair,
    side:          'buy',
    type:          'limit',
    price:         String(limitPrice),
    amount:        String(qty),
    time_in_force: 'ioc',
  });

  // Para IOC, aguarda 1s e busca status final
  await new Promise(r => setTimeout(r, 1000));
  const filled = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });

  const grossQty = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const quoteQty = parseFloat(filled.filled_total || 0);
  const avgPrice = parseFloat(filled.avg_deal_price || limitPrice);

  if (grossQty <= 0) throw new Error(`Gate.io: compra não preenchida (status=${filled.status})`);

  // Gate.io cobra 0.2% de taxa em tokens na compra — salvar qty líquida evita "Not enough balance" na venda
  const netQty = parseFloat((grossQty * (1 - GATE_FEE_RATE)).toFixed(8));
  return { filledQty: netQty, quoteQty: quoteQty || grossQty * avgPrice, avgPrice };
}

// Market order de venda — fallback para limit IOC 5% abaixo se o par não suportar market
// Retorna { soldQty, usdtOut, exitPrice }
async function gateMarketSell(pair, qty) {
  // Usa saldo real para evitar "Not enough balance" (ex: state salvo antes do fix da taxa)
  const actualBalance = await gateGetTokenBalance(pair);
  const sellQty       = Math.min(parseFloat(qty), actualBalance);
  if (sellQty <= 0) throw new Error(`Gate.io: saldo insuficiente para vender ${pair} (disponível: ${actualBalance})`);
  if (sellQty < parseFloat(qty))
    log(`⚠️  Qty ajustada: ${qty} → ${sellQty} (saldo real na Gate.io)`);

  const safeQty = sellQty.toFixed(8);

  const order = await gateReq('POST', '/spot/orders', {
    currency_pair: pair,
    side:          'sell',
    type:          'market',
    amount:        safeQty,
  });

  await new Promise(r => setTimeout(r, 2000));
  const filled    = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  const soldQty   = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const usdtOut   = parseFloat(filled.filled_total || 0);
  const exitPrice = parseFloat(filled.avg_deal_price || 0);

  if (soldQty <= 0) throw new Error(`Gate.io: venda não preenchida (status=${filled.status})`);
  return { soldQty, usdtOut: usdtOut || soldQty * exitPrice, exitPrice };
}

// ── Adapter ───────────────────────────────────────────────────────────────────
function buildAdapter() {
  if (EXCHANGE === 'gate') {
    const pair = toGateSymbol(SYMBOL);
    return {
      name:         'Gate.io',
      pair,
      syncClock:    syncGateClock,
      fetchCandles: (limit, iv) => fetchGateCandles(pair, limit, iv),
      marketBuy:    (usdt)      => gateMarketBuy(pair, usdt),
      marketSell:   (qty)       => gateMarketSell(pair, qty),
    };
  }
  return {
    name:         'Binance',
    pair:         SYMBOL,
    syncClock:    syncBinanceClock,
    fetchCandles: (limit, iv) => fetchBinanceCandles(SYMBOL, limit, iv),
    marketBuy:    (usdt)      => binanceMarketBuy(usdt),
    marketSell:   (qty)       => binanceMarketSell(qty),
  };
}

const adapter = buildAdapter();

// ── Supabase ──────────────────────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbReq(method, table, body, query = '') {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey':        SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${table} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function loadState() {
  const rows = await sbReq('GET', 'dedicated_bot_state', null, `?symbol=eq.${STATE_KEY}&limit=1`);
  if (!rows?.length) {
    const created = await sbReq('POST', 'dedicated_bot_state', {
      symbol:          STATE_KEY,
      initial_capital: INITIAL_CAPITAL,
      capital:         INITIAL_CAPITAL,
      phase:           'WATCHING',
    });
    return Array.isArray(created) ? created[0] : created;
  }
  return rows[0];
}

async function saveState(update) {
  await sbReq('PATCH', 'dedicated_bot_state', { ...update, updated_at: new Date().toISOString() }, `?symbol=eq.${STATE_KEY}`);
}

async function saveTrade(trade) {
  await sbReq('POST', 'dedicated_bot_trades', trade);
}

// ── Logging ───────────────────────────────────────────────────────────────────
const LOG_DIR  = path.join(__dirname, '../../data/bot');
const LOG_FILE = path.join(LOG_DIR, `log-${STATE_KEY}-dedicated.txt`);
fs.mkdirSync(LOG_DIR, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';

function nowFmt() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function nowFull() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function log(...args) {
  const msg    = `[${nowFmt()}] [${STATE_KEY}] ${args.join(' ')}`;
  const noAnsi = msg.replace(/\x1b\[[0-9;]*m/g, '');
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, noAnsi + '\n'); } catch {}
}

// ── Volume 24h ────────────────────────────────────────────────────────────────
async function fetch24hVolume() {
  try {
    if (EXCHANGE === 'gate') {
      const data = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${adapter.pair}`).then(r => r.json());
      return parseFloat(data[0]?.quote_volume || 0);
    } else {
      const data = await fetch(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${SYMBOL}`).then(r => r.json());
      return parseFloat(data.quoteVolume || 0);
    }
  } catch { return null; }
}

function askUser(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

// ── Indicadores ───────────────────────────────────────────────────────────────
async function computeRsi() {
  const candles = await adapter.fetchCandles(CANDLE_RSI, INTERVAL_RSI);
  const closes  = candles.map(c => c.close);
  const rsiVals = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  return {
    rsi:        rsiVals.length ? rsiVals[rsiVals.length - 1] : null,
    closePrice: closes[closes.length - 1],
  };
}

async function computeEma200() {
  const candles = await adapter.fetchCandles(CANDLE_EMA, INTERVAL_EMA);
  const closes  = candles.map(c => c.close);
  if (closes.length < EMA_PERIOD) return { ema200: null, closePrice1h: null, bullish: null };
  const emaVals      = ti.EMA.calculate({ values: closes, period: EMA_PERIOD });
  const ema200       = emaVals[emaVals.length - 1];
  const closePrice1h = closes[closes.length - 1];
  return {
    ema200,
    closePrice1h,
    bullish: closePrice1h > ema200,
  };
}

// ── Tick principal ────────────────────────────────────────────────────────────
async function tick() {
  const [rsiData, emaData] = await Promise.all([computeRsi(), computeEma200()]);
  const { rsi, closePrice } = rsiData;
  const { ema200, bullish } = emaData;

  if (rsi === null || ema200 === null) { log('Dados insuficientes — aguardando.'); return; }

  const state              = await loadState();
  const { phase, capital } = state;

  const rsiColor   = rsi > RSI_SELL ? R : rsi < RSI_BUY ? G : '';
  const trendColor = bullish ? G : R;
  const trendLabel = bullish ? '↑ ALTA' : '↓ BAIXA';
  log(
    `${rsiColor}RSI=${rsi.toFixed(2)}${rsiColor ? X : ''}` +
    `  close=${closePrice.toFixed(4)}` +
    `  EMA200=${ema200.toFixed(4)}` +
    `  ${trendColor}[${trendLabel}]${X}` +
    `  capital=${parseFloat(capital).toFixed(4)} USDT` +
    `  fase=${phase}`,
  );

  // ── WATCHING: aguarda RSI < 30 + EMA200 confirmando alta ─────────────────
  if (phase === 'WATCHING') {
    if (rsi >= RSI_BUY) return;

    if (!bullish) {
      log(`${Y}⚠️  RSI(5m)=${rsi.toFixed(2)} < ${RSI_BUY} mas preço abaixo da EMA200(1h) (${ema200.toFixed(4)}) — tendência de baixa, entrada bloqueada${X}`);
      sendWhatsApp(`⚠️ ${SYMBOL} RSI<${RSI_BUY} mas tendência BAIXA (preço ${closePrice.toFixed(4)} < EMA200 ${ema200.toFixed(4)}) — entrada bloqueada`);
      return;
    }

    log(`${G}📍 RSI(5m)=${rsi.toFixed(2)} < ${RSI_BUY} + EMA200 confirmando ALTA — comprando ${parseFloat(capital).toFixed(4)} USDT${X}`);

    let result;
    try {
      result = await adapter.marketBuy(parseFloat(capital));
    } catch (err) {
      log(`❌ Erro na compra: ${err.message}`);
      return;
    }

    const { filledQty, quoteQty, avgPrice } = result;

    await saveState({
      phase:        'BOUGHT',
      buy_price:    avgPrice,
      buy_qty:      filledQty,
      buy_usdt:     quoteQty,
      buy_time:     new Date().toISOString(),
      rsi_entry:    rsi,
      ema200_entry: ema200,
    });

    log(`${'─'.repeat(60)}`);
    log(`${G}🟢 COMPRA EXECUTADA${X}`);
    log(`   Preço médio  : ${avgPrice.toFixed(6)}`);
    log(`   Qty          : ${filledQty}`);
    log(`   USDT gasto   : ${quoteQty.toFixed(4)}`);
    log(`   RSI entrada  : ${rsi.toFixed(2)}`);
    log(`   EMA200(1h)   : ${ema200.toFixed(4)}  (preço ${((closePrice/ema200-1)*100).toFixed(2)}% acima)`);
    log(`   Capital usado: ${parseFloat(capital).toFixed(4)} USDT`);
    log(`${'─'.repeat(60)}`);
    sendWhatsApp(
      `🟢 ${SYMBOL} COMPRA [${adapter.name}]\nPreço: ${avgPrice.toFixed(6)}\nQty: ${filledQty}\nUSDT: ${quoteQty.toFixed(4)}\nRSI: ${rsi.toFixed(2)}\nEMA200(1h): ${ema200.toFixed(4)}\nCapital: ${parseFloat(capital).toFixed(4)}`,
    );

  // ── BOUGHT: aguarda RSI > 70 ───────────────────────────────────────────────
  } else if (phase === 'BOUGHT') {
    if (rsi <= RSI_SELL) {
      if (!bullish) {
        log(`${Y}⚠️  Em posição. Tendência virou BAIXA (EMA200=${ema200.toFixed(4)}) — aguardando RSI>${RSI_SELL} para sair${X}`);
      }
      return;
    }

    log(`${R}📈 RSI(5m)=${rsi.toFixed(2)} > ${RSI_SELL} — vendendo ${state.buy_qty} ${SYMBOL}${X}`);

    let result;
    try {
      result = await adapter.marketSell(parseFloat(state.buy_qty));
    } catch (err) {
      log(`❌ Erro na venda: ${err.message}`);
      return;
    }

    const { soldQty, usdtOut, exitPrice } = result;
    const capitalBefore = parseFloat(capital);
    const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
    const pnlPct        = (pnlUsdt / capitalBefore) * 100;
    const capitalAfter  = capitalBefore + pnlUsdt;
    const pnlSign       = pnlUsdt >= 0 ? '+' : '';

    await saveTrade({
      symbol:         STATE_KEY,
      entry_time:     state.buy_time,
      exit_time:      new Date().toISOString(),
      entry_price:    parseFloat(state.buy_price),
      exit_price:     exitPrice,
      qty:            soldQty,
      usdt_in:        parseFloat(state.buy_usdt),
      usdt_out:       usdtOut,
      pnl_usdt:       pnlUsdt,
      pnl_pct:        pnlPct,
      capital_before: capitalBefore,
      capital_after:  capitalAfter,
      rsi_entry:      parseFloat(state.rsi_entry ?? 0),
      rsi_exit:       rsi,
      ema200:         parseFloat(state.ema200_entry ?? ema200),
      trend_bullish:  bullish,
    });

    await saveState({
      capital:      capitalAfter,
      phase:        'WATCHING',
      buy_price:    null,
      buy_qty:      null,
      buy_usdt:     null,
      buy_time:     null,
      rsi_entry:    null,
      ema200_entry: null,
    });

    log(`${'─'.repeat(60)}`);
    log(`${R}🔴 VENDA EXECUTADA${X}`);
    log(`   Preço médio : ${exitPrice.toFixed(6)}`);
    log(`   Qty         : ${soldQty}`);
    log(`   USDT rec.   : ${usdtOut.toFixed(4)}`);
    log(`   PnL         : ${pnlSign}${pnlUsdt.toFixed(4)} USDT  (${pnlSign}${pnlPct.toFixed(2)}%)`);
    log(`   RSI saída   : ${rsi.toFixed(2)}`);
    log(`   Capital     : ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)} USDT`);
    log(`${'─'.repeat(60)}`);
    sendWhatsApp(
      `🔴 ${SYMBOL} VENDA [${adapter.name}]\nPreço: ${exitPrice.toFixed(6)}\nUSDT rec.: ${usdtOut.toFixed(4)}\nPnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)\nCapital: ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)}\nRSI: ${rsi.toFixed(2)}`,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (EXCHANGE === 'gate') {
    if (!GATE_API_KEY || !GATE_SECRET_KEY) { console.error('❌ GATEIO_API_KEY / GATEIO_SECRET_KEY ausentes no .env'); process.exit(1); }
  } else {
    if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) { console.error('❌ BINANCE_API_KEY / BINANCE_SECRET_KEY ausentes no .env'); process.exit(1); }
  }
  if (!SB_URL || !SB_KEY) { console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env'); process.exit(1); }

  await adapter.syncClock();
  setInterval(adapter.syncClock, 60 * 60_000);

  const state = await loadState();
  console.log(`\n🤖 Dedicated Bot`);
  console.log(`   Exchange   : ${adapter.name}`);
  console.log(`   Símbolo    : ${SYMBOL}  (par: ${adapter.pair})`);
  console.log(`   Entrada    : RSI(${RSI_PERIOD}, ${INTERVAL_RSI}) < ${RSI_BUY}  +  preço > EMA${EMA_PERIOD}(${INTERVAL_EMA})`);
  console.log(`   Saída      : RSI(${RSI_PERIOD}, ${INTERVAL_RSI}) > ${RSI_SELL}  (sem stop-loss)`);
  console.log(`   Capital    : ${parseFloat(state.capital).toFixed(4)} USDT  (inicial: ${parseFloat(state.initial_capital).toFixed(4)})`);
  console.log(`   Fase       : ${state.phase}`);
  console.log(`   Poll       : ${POLL_MS / 1000}s`);

  const vol = await fetch24hVolume();
  if (vol !== null) {
    const volFmt = vol >= 1_000_000
      ? `$${(vol / 1_000_000).toFixed(2)}M`
      : `$${(vol / 1000).toFixed(1)}K`;
    console.log(`   Volume 24h : ${volFmt}`);
    if (vol < 1_000_000) {
      console.log(`\n${Y}⚠️  Volume 24h abaixo de $1M — par com baixa liquidez, ordens podem não preencher.${X}`);
      const resp = await askUser('   Deseja continuar mesmo assim? [s/N]: ');
      if (resp !== 's' && resp !== 'sim') {
        console.log('❌ Operação cancelada.');
        process.exit(0);
      }
    }
  }
  console.log();

  if (state.phase === 'BOUGHT') {
    log(`♻️  Posição aberta — comprado a ${parseFloat(state.buy_price).toFixed(6)} em ${state.buy_time} | qty=${state.buy_qty}`);
  }

  const run = async () => {
    try { await tick(); }
    catch (err) { log(`❌ Tick error: ${err.message}`); }
  };

  await run();
  setInterval(run, POLL_MS);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
