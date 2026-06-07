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

// ── Configuração ──────────────────────────────────────────────────────────────

const RSI_PERIOD     = 14;
const RSI_BUY        = 30;
const RSI_SELL       = 70;
const VARIATION_MIN  = 1;            // % variação mínima do candle para confirmar sinal
const BUY_DISCOUNT   = 0.02;         // limit order 2% abaixo do close
const FEE_RATE       = 0.002;        // 0.2% taxa Gate.io (maker e taker)
const POLL_MS        = 5 * 60 * 1000; // verifica a cada 5 min
const CANDLE_LIMIT   = 200;

const API_KEY    = process.env.GATEIO_API_KEY;
const SECRET_KEY = process.env.GATEIO_SECRET_KEY;
const BASE_URL   = 'https://api.gateio.ws/api/v4';

const FAVORITES_FILE = path.join(__dirname, '../data/favorites-trade.json');
const BOT_DATA_DIR   = path.join(__dirname, '../data/bot');

// ── Gate.io API autenticada ───────────────────────────────────────────────────

function gateSign(method, endpointPath, queryString, bodyStr) {
  const timestamp  = Math.floor(Date.now() / 1000).toString();
  const hashedBody = crypto.createHash('sha512').update(bodyStr || '').digest('hex');
  const msg        = [method.toUpperCase(), `/api/v4${endpointPath}`, queryString, hashedBody, timestamp].join('\n');
  const sign       = crypto.createHmac('sha512', SECRET_KEY).update(msg).digest('hex');
  return { timestamp, sign };
}

async function gateReq(method, endpointPath, params = {}) {
  let url  = `${BASE_URL}${endpointPath}`;
  let qs   = '';
  let body = '';

  // GET e DELETE passam params como query string; POST/PUT como body JSON
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
    throw new Error(`Gate ${method} ${endpointPath} ${res.status}: ${msg}`);
  }
  return data;
}

// ── Candles públicos ──────────────────────────────────────────────────────────

async function fetchCandles(gatePair, limit = CANDLE_LIMIT) {
  const url = `${BASE_URL}/spot/candlesticks?currency_pair=${gatePair}&interval=30m&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Candles ${gatePair}: HTTP ${res.status}`);
  const raw = await res.json();
  // Gate.io: [timestamp_s, vol_base, close, high, low, open, vol_quote]
  return raw.map(c => ({
    openTime: Number(c[0]) * 1000,
    open:  parseFloat(c[5]),
    high:  parseFloat(c[3]),
    low:   parseFloat(c[4]),
    close: parseFloat(c[2]),
  }));
}

// ── Logging ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(',', '');
}

function makeLogger(symbol) {
  const logFile = path.join(BOT_DATA_DIR, `log-${symbol}.txt`);
  return function log(...args) {
    const line = `[${now()}] [${symbol}] ${args.join(' ')}`;
    console.log(line);
    try { fs.appendFileSync(logFile, line + '\n'); } catch {}
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

async function getUsdtBalance() {
  const accounts = await gateReq('GET', '/spot/accounts');
  const usdt = accounts.find(a => a.currency === 'USDT');
  return usdt ? parseFloat(usdt.available) : 0;
}

const MAX_USDT_PER_COIN = 40; // teto por moeda

/** Coloca limit buy 2% abaixo do close. Usa até MAX_USDT_PER_COIN ou saldo disponível. */
async function placeLimitBuy(gatePair, closePrice, log) {
  const balance    = await getUsdtBalance();
  const budget     = Math.min(balance * 0.99, MAX_USDT_PER_COIN);
  if (budget < 0.5) { log('⚠️  Saldo USDT insuficiente (menos de $0.50).'); return null; }
  log(`💰 Saldo USDT: ${balance.toFixed(2)} → usando ${budget.toFixed(2)} USDT (teto: $${MAX_USDT_PER_COIN})`);

  const limitPrice = parseFloat((closePrice * (1 - BUY_DISCOUNT)).toFixed(8));
  const qty        = parseFloat((budget / limitPrice).toFixed(8));

  const order = await gateReq('POST', '/spot/orders', {
    currency_pair: gatePair,
    side:          'buy',
    type:          'limit',
    price:         String(limitPrice),
    amount:        String(qty),
    time_in_force: 'gtc',
  });

  return { orderId: order.id, limitPrice, qty, budget };
}

/** Verifica status de uma ordem. Retorna o objeto da ordem Gate.io. */
async function checkOrder(orderId, gatePair) {
  return gateReq('GET', `/spot/orders/${orderId}`, { currency_pair: gatePair });
}

/** Cancela ordem pendente. */
async function cancelOrder(orderId, gatePair, log) {
  try {
    await gateReq('DELETE', `/spot/orders/${orderId}`, { currency_pair: gatePair });
    log(`🚫 Limit order cancelada (id=${orderId})`);
  } catch (err) {
    log(`⚠️  Não foi possível cancelar ${orderId}: ${err.message}`);
  }
}

/** Coloca market sell. */
async function placeMarketSell(gatePair, qty) {
  return gateReq('POST', '/spot/orders', {
    currency_pair: gatePair,
    side:          'sell',
    type:          'market',
    amount:        String(parseFloat(qty).toFixed(8)),
  });
}

// ── Tick principal ────────────────────────────────────────────────────────────

async function tick(symbol, gatePair, log) {
  const candles = await fetchCandles(gatePair);
  const closes  = candles.map(c => c.close);
  const rsiVals = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  if (rsiVals.length < 2) { log('RSI insuficiente — aguardando candles.'); return; }

  const rsi       = rsiVals[rsiVals.length - 1];
  const last      = candles[candles.length - 1];
  const variation = ((last.high - last.low) / last.low) * 100;

  let state = loadState(symbol);
  log(`RSI=${rsi.toFixed(2)}  close=${last.close}  var=${variation.toFixed(2)}%  fase=${state.phase}`);

  // ── WATCHING: aguarda sinal de compra ──────────────────────────────────────
  if (state.phase === 'WATCHING') {
    if (rsi < RSI_BUY && variation >= VARIATION_MIN) {
      const limitPrice = parseFloat((last.close * (1 - BUY_DISCOUNT)).toFixed(8));
      log(`📍 RSI < ${RSI_BUY} (${rsi.toFixed(2)}) + var ${variation.toFixed(2)}% — colocando limit buy a ${limitPrice} (${BUY_DISCOUNT * 100}% abaixo de ${last.close})…`);
      try {
        const result = await placeLimitBuy(gatePair, last.close, log);
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
          log(`⏳ LIMIT ORDER colocada | id=${result.orderId} | preço=${result.limitPrice} | qty=${result.qty} | USDT≈${result.budget.toFixed(2)}`);
        }
      } catch (err) {
        log(`❌ Erro ao colocar limit order: ${err.message}`);
      }
    }

  // ── PENDING_BUY: verifica se a ordem foi preenchida ────────────────────────
  } else if (state.phase === 'PENDING_BUY') {
    try {
      const order = await checkOrder(state.pendingOrderId, gatePair);
      const status = order.status; // 'open' | 'closed' | 'cancelled'

      if (status === 'closed') {
        // Ordem preenchida — calcula qty real (amount - left) e desconta taxa de compra
        const filledQty   = parseFloat(order.amount) - parseFloat(order.left || 0);
        const netQty      = parseFloat((filledQty * (1 - FEE_RATE)).toFixed(8)); // tokens reais após 0.2% de taxa
        const filledPrice = parseFloat(order.avg_deal_price || order.price || state.pendingPrice);
        state = {
          phase:    'BOUGHT',
          buyPrice: filledPrice,
          buyQty:   netQty,                      // quantidade disponível para venda (já sem a taxa)
          buyUsdt:  netQty * filledPrice,
          buyTime:  now(),
        };
        saveState(symbol, state);
        log(`🟢 COMPRA PREENCHIDA | qty=${filledQty} − taxa 0.2% = ${netQty} | preço=${filledPrice} | USDT≈${state.buyUsdt.toFixed(2)} | ${state.buyTime}`);

      } else if (status === 'cancelled') {
        log(`⚠️  Limit order foi cancelada externamente (id=${state.pendingOrderId}) — voltando a WATCHING.`);
        state = { phase: 'WATCHING' };
        saveState(symbol, state);

      } else {
        // 'open': ordem ainda pendente
        // Cancela se RSI já subiu de volta acima de RSI_BUY (oportunidade passou)
        if (rsi > RSI_BUY) {
          log(`📊 RSI voltou a ${rsi.toFixed(2)} > ${RSI_BUY} — oportunidade passou, cancelando limit order…`);
          await cancelOrder(state.pendingOrderId, gatePair, log);
          state = { phase: 'WATCHING' };
          saveState(symbol, state);
        } else {
          log(`⏳ Limit order aberta (id=${state.pendingOrderId}) | preço alvo=${state.pendingPrice} | aguardando fill…`);
        }
      }
    } catch (err) {
      log(`❌ Erro ao verificar order ${state.pendingOrderId}: ${err.message}`);
    }

  // ── BOUGHT: aguarda RSI cruzar acima de 70 ────────────────────────────────
  } else if (state.phase === 'BOUGHT') {
    if (rsi > RSI_SELL) {
      state.phase = 'ABOVE_70';
      saveState(symbol, state);
      log(`📈 RSI passou de ${RSI_SELL} (${rsi.toFixed(2)}) — aguardando retorno para ≤ ${RSI_SELL}…`);
    }

  // ── ABOVE_70: aguarda RSI voltar para ≤ 70 e vende ───────────────────────
  } else if (state.phase === 'ABOVE_70') {
    if (rsi <= RSI_SELL) {
      log(`📉 RSI voltou a ${rsi.toFixed(2)} ≤ ${RSI_SELL} — vendendo…`);
      try {
        await placeMarketSell(gatePair, state.buyQty);
        // Receita líquida: preço × qty × (1 − taxa_saída) − custo de compra
        const grossUsdt  = last.close * state.buyQty;
        const netUsdt    = grossUsdt * (1 - FEE_RATE);
        const usdtPnl    = (netUsdt - state.buyUsdt).toFixed(4);
        const pnl        = ((netUsdt - state.buyUsdt) / state.buyUsdt * 100).toFixed(2);
        log(`🔴 VENDA   | qty=${state.buyQty} | preço≈${last.close} | receita líquida≈${netUsdt.toFixed(2)} USDT | PnL≈${pnl}% (${Number(usdtPnl) > 0 ? '+' : ''}${usdtPnl} USDT) | comprado em ${state.buyTime}`);
        state = { phase: 'WATCHING' };
        saveState(symbol, state);
      } catch (err) {
        log(`❌ Erro ao vender: ${err.message}`);
      }
    } else {
      log(`⏳ RSI ainda acima de ${RSI_SELL} (${rsi.toFixed(2)}) — aguardando retorno…`);
    }
  }
}

// ── Inicialização ─────────────────────────────────────────────────────────────

async function startSymbol(symbol) {
  const gatePair = toGateSymbol(symbol);
  const log      = makeLogger(symbol);
  const state    = loadState(symbol);


  log(`=== Iniciado | par Gate: ${gatePair} | capital: saldo total USDT | fase: ${state.phase} ===`);

  if (state.phase === 'PENDING_BUY') {
    log(`♻️  Estado restaurado — limit order pendente id=${state.pendingOrderId} | preço=${state.pendingPrice} (colocada em ${state.pendingTime})`);
  } else if (state.phase === 'BOUGHT' || state.phase === 'ABOVE_70') {
    log(`♻️  Estado restaurado — comprado a ${state.buyPrice} em ${state.buyTime}`);
  }

  const run = async () => {
    try { await tick(symbol, gatePair, log); }
    catch (err) { log(`❌ Tick error: ${err.message}`); }
  };

  await run();
  setInterval(run, POLL_MS);
}

async function main() {
  if (!API_KEY || !SECRET_KEY) {
    console.error('❌ GATEIO_API_KEY / GATEIO_SECRET_KEY não definidos no .env');
    process.exit(1);
  }

  fs.mkdirSync(BOT_DATA_DIR, { recursive: true });

  let symbols;
  try { symbols = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8')); }
  catch { console.error(`Não encontrou ${FAVORITES_FILE}`); process.exit(1); }

  if (!symbols.length) { console.error('Nenhum símbolo em favorites-trade.json'); process.exit(1); }

  console.log(`\n🤖 RSI Trade Bot`);
  console.log(`   Moedas (${symbols.length}): ${symbols.join(', ')}`);
  console.log(`   Compra : RSI < ${RSI_BUY} + var ≥ ${VARIATION_MIN}%  →  limit ${BUY_DISCOUNT * 100}% abaixo do close`);
  console.log(`   Venda  : RSI > ${RSI_SELL} e volta a ≤ ${RSI_SELL}  →  market order`);
  console.log(`   Capital: até $${MAX_USDT_PER_COIN} USDT por moeda (ou saldo disponível se menor)`);
  console.log(`   Taxa   : ${FEE_RATE * 100}% entrada + ${FEE_RATE * 100}% saída (descontadas da qty/receita)`);
  console.log(`   Poll   : a cada ${POLL_MS / 60000} min\n`);

  await Promise.all(symbols.map(startSymbol));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
