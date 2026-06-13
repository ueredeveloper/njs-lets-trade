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
 *   node backend/bot/stgBot.js BTCUSDT 100
 *   node backend/bot/stgBot.js ALGOUSDT
 */

const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const ti = require('technicalindicators');
const { fetchBinanceCandles } = require('./prices');
const { sendWhatsApp }        = require('./whatsapp');

// ── Argumentos ────────────────────────────────────────────────────────────────
const SYMBOL           = (process.argv[2] || 'STGUSDT').toUpperCase();
const INITIAL_CAPITAL  = parseFloat(process.argv[3] || '40');

// ── Configuração ──────────────────────────────────────────────────────────────
const INTERVAL_RSI  = '5m';
const INTERVAL_EMA  = '1h';
const EMA_PERIOD    = 200;
const RSI_PERIOD    = 14;
const RSI_BUY       = 30;
const RSI_SELL      = 70;
const FEE_RATE      = 0.001;    // 0.1% por lado (maker Binance)
const CANDLE_RSI    = 100;      // candles 5m para RSI
const CANDLE_EMA    = 250;      // candles 1h para EMA200 (200 + warmup)
const POLL_MS       = 60_000;   // verifica a cada 60 s

// ── Binance ───────────────────────────────────────────────────────────────────
const BINANCE_BASE = 'https://api.binance.com';
const API_KEY      = process.env.BINANCE_API_KEY;
const SECRET_KEY   = process.env.BINANCE_SECRET_KEY;

let clockOffsetMs = 0;

async function syncClock() {
  try {
    const res  = await fetch(`${BINANCE_BASE}/api/v3/time`);
    const data = await res.json();
    clockOffsetMs = data.serverTime - Date.now();
  } catch {}
}

function binanceSign(params) {
  const qs  = new URLSearchParams(params).toString();
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(qs).digest('hex');
  return `${qs}&signature=${sig}`;
}

async function binanceReq(method, endpoint, params = {}) {
  const ts     = Date.now() + clockOffsetMs;
  const signed = binanceSign({ ...params, timestamp: ts, recvWindow: 10000 });
  const url    = method === 'GET'
    ? `${BINANCE_BASE}${endpoint}?${signed}`
    : `${BINANCE_BASE}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method !== 'GET' ? signed : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Binance ${method} ${endpoint} ${res.status}: ${data?.msg ?? text}`);
  return data;
}

// Compra a mercado com quoteOrderQty (USDT)
async function marketBuy(usdtAmount) {
  return binanceReq('POST', '/api/v3/order', {
    symbol:        SYMBOL,
    side:          'BUY',
    type:          'MARKET',
    quoteOrderQty: usdtAmount.toFixed(2),
  });
}

// Venda a mercado com quantity (tokens)
async function marketSell(qty) {
  const info      = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${SYMBOL}`).then(r => r.json());
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const decimals  = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 0) : 0;
  const safeQty   = (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
  return binanceReq('POST', '/api/v3/order', {
    symbol:   SYMBOL,
    side:     'SELL',
    type:     'MARKET',
    quantity: safeQty,
  });
}

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
  const rows = await sbReq('GET', 'dedicated_bot_state', null, `?symbol=eq.${SYMBOL}&limit=1`);
  if (!rows?.length) {
    // Cria linha inicial se não existir
    const created = await sbReq('POST', 'dedicated_bot_state', {
      symbol:          SYMBOL,
      initial_capital: INITIAL_CAPITAL,
      capital:         INITIAL_CAPITAL,
      phase:           'WATCHING',
    });
    return Array.isArray(created) ? created[0] : created;
  }
  return rows[0];
}

async function saveState(update) {
  await sbReq('PATCH', 'dedicated_bot_state', { ...update, updated_at: new Date().toISOString() }, `?symbol=eq.${SYMBOL}`);
}

async function saveTrade(trade) {
  await sbReq('POST', 'dedicated_bot_trades', trade);
}

// ── Logging ───────────────────────────────────────────────────────────────────
const LOG_DIR  = path.join(__dirname, '../data/bot');
const LOG_FILE = path.join(LOG_DIR, `log-${SYMBOL}-dedicated.txt`);
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
  const msg    = `[${nowFmt()}] [${SYMBOL}] ${args.join(' ')}`;
  const noAnsi = msg.replace(/\x1b\[[0-9;]*m/g, '');
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, noAnsi + '\n'); } catch {}
}

// ── Indicadores ───────────────────────────────────────────────────────────────
async function computeRsi() {
  const candles = await fetchBinanceCandles(SYMBOL, CANDLE_RSI, INTERVAL_RSI);
  const closes  = candles.map(c => c.close);
  const rsiVals = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  return {
    rsi:        rsiVals.length ? rsiVals[rsiVals.length - 1] : null,
    closePrice: closes[closes.length - 1],
  };
}

async function computeEma200() {
  const candles = await fetchBinanceCandles(SYMBOL, CANDLE_EMA, INTERVAL_EMA);
  const closes  = candles.map(c => c.close);
  if (closes.length < EMA_PERIOD) return { ema200: null, closePrice1h: null, bullish: null };
  const emaVals     = ti.EMA.calculate({ values: closes, period: EMA_PERIOD });
  const ema200      = emaVals[emaVals.length - 1];
  const closePrice1h = closes[closes.length - 1];
  return {
    ema200,
    closePrice1h,
    bullish: closePrice1h > ema200,
  };
}

// ── Tick principal ────────────────────────────────────────────────────────────
async function tick() {
  // Busca RSI(5m) e EMA200(1h) em paralelo
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

    let order;
    try {
      order = await marketBuy(parseFloat(capital));
    } catch (err) {
      log(`❌ Erro na compra: ${err.message}`);
      return;
    }

    const filledQty  = parseFloat(order.executedQty);
    const quoteQty   = parseFloat(order.cummulativeQuoteQty);
    const avgPrice   = quoteQty / filledQty;

    await saveState({
      phase:        'BOUGHT',
      buy_price:    avgPrice,
      buy_qty:      filledQty,
      buy_usdt:     quoteQty,
      buy_time:     nowFull(),
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
      `🟢 ${SYMBOL} COMPRA\nPreço: ${avgPrice.toFixed(6)}\nQty: ${filledQty}\nUSDT: ${quoteQty.toFixed(4)}\nRSI: ${rsi.toFixed(2)}\nEMA200(1h): ${ema200.toFixed(4)}\nCapital: ${parseFloat(capital).toFixed(4)}`,
    );

  // ── BOUGHT: aguarda RSI > 70 (sem filtro de tendência na saída) ───────────
  } else if (phase === 'BOUGHT') {
    if (rsi <= RSI_SELL) {
      // Alerta se tendência virou para baixa enquanto em posição
      if (!bullish) {
        log(`${Y}⚠️  Em posição. Tendência virou BAIXA (EMA200=${ema200.toFixed(4)}) — aguardando RSI>${RSI_SELL} para sair${X}`);
      }
      return;
    }

    log(`${R}📈 RSI(5m)=${rsi.toFixed(2)} > ${RSI_SELL} — vendendo ${state.buy_qty} ${SYMBOL}${X}`);

    let order;
    try {
      order = await marketSell(parseFloat(state.buy_qty));
    } catch (err) {
      log(`❌ Erro na venda: ${err.message}`);
      return;
    }

    const soldQty       = parseFloat(order.executedQty);
    const usdtOut       = parseFloat(order.cummulativeQuoteQty);
    const exitPrice     = usdtOut / soldQty;
    const capitalBefore = parseFloat(capital);
    const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
    const pnlPct        = (pnlUsdt / capitalBefore) * 100;
    const capitalAfter  = capitalBefore + pnlUsdt;
    const pnlSign       = pnlUsdt >= 0 ? '+' : '';

    await saveTrade({
      symbol:         SYMBOL,
      entry_time:     state.buy_time,
      exit_time:      nowFull(),
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
      `🔴 ${SYMBOL} VENDA\nPreço: ${exitPrice.toFixed(6)}\nUSDT rec.: ${usdtOut.toFixed(4)}\nPnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)\nCapital: ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)}\nRSI: ${rsi.toFixed(2)}`,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY || !SECRET_KEY) { console.error('❌ BINANCE_API_KEY / BINANCE_SECRET_KEY ausentes no .env'); process.exit(1); }
  if (!SB_URL  || !SB_KEY)     { console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env'); process.exit(1); }

  await syncClock();
  setInterval(syncClock, 60 * 60_000);

  const state = await loadState();
  console.log(`\n🤖 Dedicated Bot`);
  console.log(`   Símbolo    : ${SYMBOL}`);
  console.log(`   Entrada    : RSI(${RSI_PERIOD}, ${INTERVAL_RSI}) < ${RSI_BUY}  +  preço > EMA${EMA_PERIOD}(${INTERVAL_EMA})`);
  console.log(`   Saída      : RSI(${RSI_PERIOD}, ${INTERVAL_RSI}) > ${RSI_SELL}  (sem stop-loss)`);
  console.log(`   Capital    : ${parseFloat(state.capital).toFixed(4)} USDT  (inicial: ${parseFloat(state.initial_capital).toFixed(4)})`);
  console.log(`   Fase       : ${state.phase}`);
  console.log(`   Poll       : ${POLL_MS / 1000}s\n`);

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
