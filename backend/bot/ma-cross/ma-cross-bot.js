'use strict';

/**
 * MA Cross Bot — cruzamento de duas MAs (compra) + cruzamento inverso (venda).
 *
 * strategy_id: ma-cross
 * Exemplo: MA9(15m) cruza ↑ MA21(15m) com preço acima de MA50(1h); saída MA9/21(30m) ↓.
 *
 * Uso:
 *   node backend/bot/ma-cross/ma-cross-bot.js
 *   node backend/bot/ma-cross/ma-cross-bot.js --symbol BTCUSDT
 */

const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const {
  gateMarketSell: gateMarketSellCore,
  isGateDustResult,
  estimateDustClosePnl,
} = require('../gate/gateMarketSell');
const { sendWhatsApp } = require('../whatsapp');
const { maLabel } = require('../../utils/movingAverage');
const registry = require('../multitradeRegistry');
const { startMultitradeWatch, configFingerprint } = require('../multitradeWatch');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isMaCrossStrategy } = require('./strategyPresets');
const {
  getRequiredSpecs, evaluateEntry, evaluateCrossSignal, evaluatePullbackReady,
  pullbackEntryEnabled, evaluateExit, computeAdaptiveDips, computeAdaptiveStretches,
  computeStopLossFloor, getFinestPollInterval,
} = require('./strategyEngine');

const GATE_FEE_RATE = 0.002;
const VOL_CACHE_MS  = 5 * 60_000;

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';
// Verde/vermelho reservados para compra/venda — não usar em tags de símbolo
const COLORS = ['\x1b[94m','\x1b[93m','\x1b[95m','\x1b[96m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[34m','\x1b[97m','\x1b[90m'];

function nowFmt() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function makeLogger(symbol, strategyId, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-${strategyId}.txt`);
  const tag = `${symbol}/${strategyId}`;
  return function log(...args) {
    const msg    = `[${nowFmt()}] ${color}[${tag}]${X} ${args.join(' ')}`;
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
  const url    = method === 'GET' ? `${BINANCE_BASE}${endpoint}?${signed}` : `${BINANCE_BASE}${endpoint}`;
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
  return { filledQty: filledQty * (1 - GATE_FEE_RATE), quoteQty, avgPrice: quoteQty / filledQty };
}

async function binanceMarketSell(symbol, qty) {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`quantidade inválida para venda (${qty})`);
  }
  const info      = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${symbol}`).then(r => r.json());
  const lotFilter = info.symbols?.[0]?.filters?.find(f => f.filterType === 'LOT_SIZE');
  const stepSize  = lotFilter ? parseFloat(lotFilter.stepSize) : 1;
  const decimals  = stepSize < 1 ? (String(stepSize).split('.')[1]?.length ?? 0) : 0;
  const safeQty   = (Math.floor(qty / stepSize) * stepSize).toFixed(decimals);
  if (!Number.isFinite(parseFloat(safeQty)) || parseFloat(safeQty) <= 0) {
    throw new Error(`quantidade inválida após arredondamento (${safeQty})`);
  }
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
  return { filledQty: grossQty * (1 - GATE_FEE_RATE), quoteQty: quoteQty || grossQty * avgPrice, avgPrice };
}

async function gateMarketSell(pair, qty, log, opts = {}) {
  return gateMarketSellCore(
    { gateReq, getTokenBalance: gateGetTokenBalance },
    pair, qty, log, opts,
  );
}

async function gate24hVolume(pair) {
  const data = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
  return parseFloat(data[0]?.quote_volume || 0);
}

function buildAdapter(exchange, symbol) {
  if (exchange === 'gate') {
    const pair = toGateSymbol(symbol);
    return {
      name: 'Gate.io', pair,
      fetchCandles: (lim, iv) => fetchGateCandles(pair, lim, iv),
      marketBuy:    (usdt)     => gateMarketBuy(pair, usdt),
      marketSell:   (qty, log, opts) => gateMarketSell(pair, qty, log, opts),
      fetch24hVol:  ()         => gate24hVolume(pair),
    };
  }
  return {
    name: 'Binance', pair: symbol,
    fetchCandles: (lim, iv) => fetchBinanceCandles(symbol, lim, iv),
    marketBuy:    (usdt)     => binanceMarketBuy(symbol, usdt),
    marketSell:   (qty)      => binanceMarketSell(symbol, qty),
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

async function loadMaCrossRows() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  return sbReq('GET', 'rsi_multi_bot_state', null, `?or=(${ids})&order=id.asc`);
}

function crossDesc(block) {
  const dir = block.direction === 'cross_down' ? '↓' : '↑';
  return `${maLabel(block.ma1.period, block.ma1.interval)} ${dir} ${maLabel(block.ma2.period, block.ma2.interval)}`;
}

let rulesStateColumnOk = true;

async function saveState(id, update, log) {
  const payload = { ...update, updated_at: new Date().toISOString() };
  if (!rulesStateColumnOk && payload.rules_state !== undefined) {
    delete payload.rules_state;
  }
  try {
    await sbReq('PATCH', 'rsi_multi_bot_state', payload, `?id=eq.${id}`);
  } catch (err) {
    const msg = String(err.message ?? err);
    if (payload.rules_state !== undefined && /rules_state/.test(msg)) {
      rulesStateColumnOk = false;
      const { rules_state, ...rest } = payload;
      await sbReq('PATCH', 'rsi_multi_bot_state', rest, `?id=eq.${id}`);
      log?.(`${Y}⚠️  Coluna rules_state ausente — rode supabase/add-rules-state-column.sql (stop trailing só em memória)${X}`);
      return;
    }
    throw err;
  }
}

async function insertTrade(trade) {
  try { await sbReq('POST', 'rsi_multi_bot_trades', trade); } catch { /* ignore */ }
}

function parseRulesState(row) {
  let rs = row?.rules_state;
  if (typeof rs === 'string') {
    try { rs = JSON.parse(rs); } catch { rs = null; }
  }
  return rs && typeof rs === 'object' ? rs : {};
}

const DEFAULT_ENTRY_COOLDOWN_HOURS = 4;
const COOLDOWN_LOG_INTERVAL_MS = 15 * 60_000;
const ENTRY_CAP_LOG_REASON = 'ABOVE_MA2_MAX';
const PENDING_LOG_INTERVAL_MS = 15 * 60_000;

const PENDING_CANCEL_LABELS = {
  NO_PULLBACK: 'sem pullback em direção à MA21',
  ABOVE_MA2_MAX: 'acima do teto MA2',
  ENTRY_WINDOW_PASSED: 'janela de entrada expirou',
  SIGNAL_LOST: 'candle de sinal perdido',
  PENDING_TIMEOUT: 'timeout',
  NO_PENDING_SIGNAL: 'sinal pendente inválido',
  BELOW_ADAPTIVE_FLOOR: 'filtro MA adaptativo',
  NOT_ABOVE_MA: 'filtro MA',
  NOT_BELOW_MA: 'filtro MA',
  FILTER_NO_MA: 'filtro MA indisponível',
  HTF_TREND_BELOW: 'EMA9(1h) abaixo de EMA21(1h) (fora da tolerância)',
  HTF_TREND_NO_MA: 'tendência 1h indisponível',
  HTF_TREND_NO_DATA: 'dados 1h insuficientes',
};

function entryCooldownHours(config) {
  const h = Number(config?.entryCooldownHours);
  return Number.isFinite(h) && h >= 0 ? h : DEFAULT_ENTRY_COOLDOWN_HOURS;
}

function resolveLastExitTime(state, session) {
  const fromRow = parseRulesState(state).lastExitTime;
  if (fromRow) return fromRow;
  return session?.lastExitTime ?? null;
}

function cooldownRemainingMs(lastExitTime, hours) {
  if (!hours || !lastExitTime) return 0;
  const end = new Date(lastExitTime).getTime() + hours * 3_600_000;
  return Math.max(0, end - Date.now());
}

function formatCooldownRemaining(ms) {
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function postExitRulesState(exitTime) {
  return { lastExitTime: exitTime };
}

function parsePendingPullback(state, session) {
  if (session?.pendingPullback) return session.pendingPullback;
  const rs = parseRulesState(state);
  return rs.pendingPullback ?? null;
}

function pendingPullbackPayload(crossCheck) {
  return {
    signalOpenTime: crossCheck.crossOpenTime,
    signalClose:    parseFloat(crossCheck.close),
    signalMa1:      crossCheck.ma1,
    startedAt:      new Date().toISOString(),
  };
}

function rulesStateWithoutPending(state, session, extra = {}) {
  const rs = { ...parseRulesState(state), ...(session?.rulesState ?? {}), ...extra };
  delete rs.pendingPullback;
  return rs;
}

async function executeBuy({
  rowId, adapter, strategy, log, session, state, entryMeta, capital, strategyId, symbol,
}) {
  let result;
  try {
    result = await adapter.marketBuy(parseFloat(capital));
  } catch (err) {
    log(`❌ Erro na compra: ${err.message}`);
    return false;
  }

  const { filledQty, quoteQty, avgPrice } = result;
  const initialFloor = computeStopLossFloor(avgPrice, avgPrice, strategy.config.stopLoss);
  const buyTime = new Date().toISOString();
  session.phase = 'BOUGHT';
  session.pendingPullback = null;
  session.rulesState = { stopPeakPrice: avgPrice, stopFloor: initialFloor };
  await saveState(rowId, {
    phase: 'BOUGHT', buy_price: avgPrice, buy_qty: filledQty,
    buy_usdt: quoteQty, buy_time: buyTime,
    rsi_entry: entryMeta.ma1,
    rules_state: session.rulesState,
  }, log);

  log(`${'─'.repeat(60)}`);
  log(`${G}🟢 COMPRA EXECUTADA${X}`);
  log(`   Preço : ${avgPrice.toFixed(6)}  Qty: ${filledQty}  USDT: ${quoteQty.toFixed(4)}`);
  if (entryMeta.pullbackVsMa2Pct != null) {
    log(`   Pullback MA21: ${entryMeta.pullbackVsMa2Pct.toFixed(1)}pp  close +${entryMeta.aboveMa2Pct?.toFixed(1) ?? '?'}% MA21`);
  } else if (entryMeta.pullbackPct != null) {
    log(`   Pullback: ${entryMeta.pullbackPct.toFixed(1)}%  MA2: +${entryMeta.aboveMa2Pct?.toFixed(1) ?? '?'}%`);
  }
  log(`${'─'.repeat(60)}`);
  sendWhatsApp(`🟢 MA-CROSS COMPRA [${strategyId}] ${symbol}\nPreço: ${avgPrice}\nUSDT: ${quoteQty.toFixed(4)}`);
  return true;
}

async function cancelPendingPullback(rowId, log, session, state, reason, detail) {
  const label = PENDING_CANCEL_LABELS[reason] ?? reason;
  log(`${Y}⏹️  Entrada pendente cancelada — ${label}${detail ? ` (${detail})` : ''}${X}`);
  session.phase = 'WATCHING';
  session.pendingPullback = null;
  await saveState(rowId, {
    phase: 'WATCHING',
    rules_state: rulesStateWithoutPending(state, session),
  }, log);
}

function getTickPeak(cMap, config, buyPrice, storedPeak) {
  const iv = getFinestPollInterval(config);
  const last = (cMap[iv] ?? []).at(-1);
  const lastHigh = last?.high != null ? parseFloat(last.high) : parseFloat(last?.close ?? buyPrice);
  const lastClose = last?.close != null ? parseFloat(last.close) : buyPrice;
  return Math.max(storedPeak ?? buyPrice, lastHigh, lastClose);
}

async function fetchCandleMap(adapter, specs) {
  const maxLimits = {};
  for (const { interval, limit } of specs) {
    maxLimits[interval] = Math.max(maxLimits[interval] || 0, limit);
  }
  const fetchAll = () => Promise.all(
    Object.entries(maxLimits).map(async ([iv, lim]) => [iv, await adapter.fetchCandles(lim, iv)]),
  );
  let entries;
  try {
    entries = await fetchAll();
  } catch (err) {
    if (err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || /fetch failed/i.test(err.message)) {
      await new Promise(r => setTimeout(r, 2000));
      entries = await fetchAll();
    } else {
      throw err;
    }
  }
  return Object.fromEntries(entries);
}

function hasOpenPosition(state) {
  const qty   = parseFloat(state?.buy_qty);
  const price = parseFloat(state?.buy_price);
  return Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0;
}

async function resetOrphanPosition(rowId, log, session, state, reason) {
  log(`${Y}⚠️  Posição órfã (${reason}) — resetando para WATCHING${X}`);
  if (session) {
    session.phase = 'WATCHING';
    session.rulesState = null;
  }
  if (state.phase === 'BOUGHT') {
    const exitTime = resolveLastExitTime(state, session) ?? new Date().toISOString();
    await saveState(rowId, {
      phase: 'WATCHING',
      buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
      rules_state: postExitRulesState(exitTime),
    }, log);
  }
  return { phase: 'WATCHING' };
}

async function executeSell({ rowId, adapter, strategy, log, state, exitResult, reasonLabel, session }) {
  const { config } = strategy;
  const { symbol, strategy_id: strategyId, capital } = state;
  const buyPrice = parseFloat(state.buy_price);

  const reason = reasonLabel ?? (exitResult.reason === 'STOP_LOSS'
    ? (exitResult.dropPct >= 0
      ? `stop trailing +${exitResult.dropPct.toFixed(2)}% (piso ${exitResult.stopFloor?.toFixed(6)})`
      : `stop-loss ${exitResult.dropPct?.toFixed(2)}%`)
    : (exitResult.exitDesc ?? exitResult.reason ?? crossDesc(config.exit?.maCross ?? config.exit)));

  const sellQty = parseFloat(state.buy_qty);
  if (!hasOpenPosition(state)) {
    log(`${Y}⚠️  Sinal de saída sem qty registrada — posição órfã${X}`);
    await resetOrphanPosition(rowId, log, session, state, 'buy_qty ausente');
    return { phase: 'WATCHING' };
  }

  log(`${R}📈 ${reason} — vendendo ${sellQty} ${symbol}${X}`);

  const exitTime = new Date().toISOString();
  const sellOpts = adapter.name === 'Gate.io' ? { aggressive: true } : {};
  let result;
  try {
    result = await adapter.marketSell(sellQty, log, sellOpts);
  } catch (err) {
    log(`❌ Erro na venda: ${err.message}`);
    throw err;
  }

  if (isGateDustResult(result)) {
    const est = estimateDustClosePnl(state, result);
    const capitalBefore = parseFloat(capital);
    const pnlSign = est.pnlUsdt >= 0 ? '+' : '';

    await insertTrade({
      symbol, exchange: state.exchange, strategy_id: strategyId,
      entry_time: state.buy_time, exit_time: exitTime,
      entry_price: buyPrice, exit_price: est.exitPrice,
      qty: est.soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: est.usdtOut,
      pnl_usdt: est.pnlUsdt, pnl_pct: parseFloat(est.pnlPct.toFixed(2)),
      capital_before: capitalBefore, capital_after: est.capitalAfter,
      rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: exitResult?.ma1 ?? 0,
      exit_reason: 'DUST',
    });

    if (session) session.lastExitTime = exitTime;
    await saveState(rowId, {
      capital: est.capitalAfter, phase: 'WATCHING',
      buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
      rules_state: postExitRulesState(exitTime),
    }, log);

    log(`${'─'.repeat(60)}`);
    log(`${Y}🟡 POSIÇÃO ENCERRADA (dust residual ${result.dustQty} ≈ $${result.dustUsdt.toFixed(4)})${X}`);
    log(`   PnL estimado: ${pnlSign}${est.pnlUsdt.toFixed(4)} USDT (${pnlSign}${est.pnlPct.toFixed(2)}%)`);
    log(`   Capital: ${capitalBefore.toFixed(4)} → ${est.capitalAfter.toFixed(4)} USDT`);
    log(`${'─'.repeat(60)}`);
    return { phase: 'WATCHING' };
  }

  const { soldQty, usdtOut, exitPrice } = result;
  const capitalBefore = parseFloat(capital);
  const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
  const pnlPct        = (pnlUsdt / capitalBefore) * 100;
  const capitalAfter  = capitalBefore + pnlUsdt;
  const pnlSign       = pnlUsdt >= 0 ? '+' : '';

  await insertTrade({
    symbol, exchange: state.exchange, strategy_id: strategyId,
    entry_time: state.buy_time, exit_time: exitTime,
    entry_price: buyPrice, exit_price: exitPrice,
    qty: soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: usdtOut,
    pnl_usdt: pnlUsdt, pnl_pct: parseFloat(pnlPct.toFixed(2)),
    capital_before: capitalBefore, capital_after: capitalAfter,
    rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: exitResult?.ma1 ?? 0,
    exit_reason: exitResult?.reason ?? reasonLabel ?? 'PANEL_REMOVED',
  });

  if (session) session.lastExitTime = exitTime;
  const cooldownH = entryCooldownHours(config);
  await saveState(rowId, {
    capital: capitalAfter, phase: 'WATCHING',
    buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
    rules_state: postExitRulesState(exitTime),
  }, log);
  if (cooldownH > 0) {
    log(`${Y}⏳ Cooldown de entrada: ${cooldownH}h${X}`);
  }

  log(`${'─'.repeat(60)}`);
  log(`${R}🔴 VENDA EXECUTADA${X}`);
  log(`   PnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)`);
  log(`   Capital: ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)} USDT`);
  log(`${'─'.repeat(60)}`);
  sendWhatsApp(`🔴 MA-CROSS VENDA [${strategyId}] ${symbol}\nPnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)`);
  return { phase: 'WATCHING' };
}

// ── Tick ──────────────────────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, log, session) {
  const { config } = strategy;
  const specs = getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);
  const adaptiveDips = computeAdaptiveDips(config, cMap);
  const adaptiveStretches = computeAdaptiveStretches(config, cMap);
  const evalOpts = { adaptiveStretches };

  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) return { phase: 'WATCHING' };

  const { capital, symbol, strategy_id: strategyId } = state;
  const buyPrice = state.buy_price ? parseFloat(state.buy_price) : null;
  let phase = session.phase ?? state.phase;
  if (phase === 'BOUGHT' && !hasOpenPosition(state)) {
    return resetOrphanPosition(rowId, log, session, state, 'sem buy_qty/buy_price no Supabase');
  }
  if (session.phase === 'BOUGHT' && state.phase !== 'BOUGHT') {
    session.phase = state.phase;
    phase = state.phase;
  }

  // ── PENDING (pullback após cruzamento) ───────────────────────────────────
  if (phase === 'PENDING') {
    const pending = parsePendingPullback(state, session);
    const timeoutMs = config.execution?.pendingTimeoutMs ?? 90 * 60_000;
    const startedAt = pending?.startedAt ? new Date(pending.startedAt).getTime() : 0;
    if (!pending || !startedAt) {
      await cancelPendingPullback(rowId, log, session, state, 'NO_PENDING_SIGNAL');
      return { phase: 'WATCHING' };
    }
    if (Date.now() - startedAt > timeoutMs) {
      await cancelPendingPullback(rowId, log, session, state, 'PENDING_TIMEOUT');
      return { phase: 'WATCHING' };
    }

    const ready = evaluatePullbackReady(config, cMap, adaptiveDips, pending, adaptiveStretches);
    if (ready.cancel) {
      const detail = ready.pullbackVsMa2Pct != null
        ? `+${ready.aboveMa2Pct?.toFixed?.(1) ?? '?'}% MA21 (sinal +${ready.signalAboveMa2Pct?.toFixed?.(1) ?? '?'})`
        : (ready.aboveMa2Pct != null ? `+${ready.aboveMa2Pct.toFixed(1)}% MA21` : null);
      await cancelPendingPullback(rowId, log, session, state, ready.reason, detail);
      return { phase: 'WATCHING' };
    }
    if (!ready.ready) {
      if (ready.reason === 'WAITING_CANDLES') {
        const now = Date.now();
        if (!session.lastPendingLogAt || now - session.lastPendingLogAt >= PENDING_LOG_INTERVAL_MS) {
          session.lastPendingLogAt = now;
          const wait = config.execution?.pullbackEntry?.waitCandles ?? 2;
          const reject = ready.lastRejectReason
            ? ` (último: ${PENDING_CANCEL_LABELS[ready.lastRejectReason] ?? ready.lastRejectReason})`
            : '';
          log(`${Y}⏳ Aguardando pullback — candle ${ready.waited}/${wait} após cruzamento${reject}${X}`);
        }
      }
      return { phase: 'PENDING' };
    }

    const vol = session.volCache?.volumeUsdt;
    const minVol = config.minVolumeUsdt ?? 3_000_000;
    if (vol != null && vol < minVol && !config.allowLowVolume) {
      return { phase: 'PENDING' };
    }

    log(`${G}📍 Pullback confirmado (${ready.entryDesc}) — comprando ${parseFloat(capital).toFixed(2)} USDT${X}`);
    const bought = await executeBuy({
      rowId, adapter, strategy, log, session, state,
      entryMeta: ready, capital, strategyId, symbol,
    });
    return { phase: bought ? 'BOUGHT' : 'PENDING' };
  }

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    const crossCheck = evaluateCrossSignal(config, cMap, adaptiveDips);
    if (!crossCheck.allowed) return { phase };

    const cooldownH = entryCooldownHours(config);
    if (cooldownH > 0) {
      const remaining = cooldownRemainingMs(resolveLastExitTime(state, session), cooldownH);
      if (remaining > 0) {
        const now = Date.now();
        if (!session.lastCooldownLogAt || now - session.lastCooldownLogAt >= COOLDOWN_LOG_INTERVAL_MS) {
          session.lastCooldownLogAt = now;
          const kindLabel = crossCheck.entryDesc ?? crossDesc(config.entry);
          log(`${Y}⏳ Sinal (${kindLabel}) — cooldown ${formatCooldownRemaining(remaining)} restantes${X}`);
        }
        return { phase };
      }
    }

    const vol = session.volCache?.volumeUsdt;
    const minVol = config.minVolumeUsdt ?? 3_000_000;
    if (vol != null && vol < minVol && !config.allowLowVolume) {
      return { phase };
    }

    const entryCheck = evaluateEntry(config, cMap, adaptiveDips, evalOpts);
    const usePendingFallback = pullbackEntryEnabled(config) && config.execution?.immediateEntry !== true;

    if (entryCheck.allowed) {
      const kindLabel = entryCheck.entryDesc ?? crossDesc(config.entry);
      log(`${G}📍 COMPRA imediata (${kindLabel}) — ≤${entryCheck.maxAboveMaPct ?? 3}% MA21 — ${parseFloat(capital).toFixed(2)} USDT${X}`);
      const bought = await executeBuy({
        rowId, adapter, strategy, log, session, state,
        entryMeta: entryCheck, capital, strategyId, symbol,
      });
      return { phase: bought ? 'BOUGHT' : 'WATCHING' };
    }

    if (usePendingFallback) {
      const pending = pendingPullbackPayload(crossCheck);
      const wait = config.execution?.pullbackEntry?.waitCandles ?? 2;
      session.phase = 'PENDING';
      session.pendingPullback = pending;
      session.rulesState = { ...parseRulesState(state), pendingPullback: pending };
      await saveState(rowId, { phase: 'PENDING', rules_state: session.rulesState }, log);
      if (entryCheck.reason === ENTRY_CAP_LOG_REASON) {
        const pct = entryCheck.aboveMa2Pct != null ? entryCheck.aboveMa2Pct.toFixed(1) : '?';
        const cap = entryCheck.maxAboveMaPct ?? '?';
        log(`${G}📍 Cruzamento (${crossCheck.entryDesc}) — +${pct}% MA21 (máx ${cap}%) → pending pullback (até ${wait} candles)${X}`);
      } else {
        log(`${G}📍 Cruzamento (${crossCheck.entryDesc}) — aguardando pullback (até ${wait} candles)${X}`);
      }
      return { phase: 'PENDING' };
    }

    if (entryCheck.reason === ENTRY_CAP_LOG_REASON) {
      const now = Date.now();
      if (!session.lastEntryCapLogAt || now - session.lastEntryCapLogAt >= COOLDOWN_LOG_INTERVAL_MS) {
        session.lastEntryCapLogAt = now;
        const pct = entryCheck.aboveMa2Pct != null ? entryCheck.aboveMa2Pct.toFixed(1) : '?';
        const cap = entryCheck.maxAboveMaPct ?? '?';
        log(`${Y}⛔ Sinal bloqueado — preço +${pct}% acima MA21 (máx ${cap}%)${X}`);
      }
    }
    return { phase };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  if (phase === 'BOUGHT') {
    const rulesState = { ...parseRulesState(state), ...(session.rulesState ?? {}) };
    const storedPeak = rulesState.stopPeakPrice != null
      ? parseFloat(rulesState.stopPeakPrice)
      : buyPrice;
    const peakPrice = getTickPeak(cMap, config, buyPrice, storedPeak);
    const stopFloor = computeStopLossFloor(buyPrice, peakPrice, config.stopLoss);
    const prevFloor = rulesState.stopFloor != null
      ? parseFloat(rulesState.stopFloor)
      : computeStopLossFloor(buyPrice, storedPeak, config.stopLoss);

    if (peakPrice > storedPeak + 1e-12 || Math.abs((stopFloor ?? 0) - (prevFloor ?? 0)) > 1e-12) {
      session.rulesState = { stopPeakPrice: peakPrice, stopFloor };
      await saveState(rowId, { rules_state: session.rulesState }, log);
      if (stopFloor != null && stopFloor > prevFloor + 1e-12) {
        log(`📈 Stop trailing: pico ${peakPrice.toFixed(6)} → piso ${stopFloor.toFixed(6)}`);
      }
    }

    const exitResult = evaluateExit(config, cMap, buyPrice, { peakPrice });
    if (!exitResult.exit) return { phase };

    try {
      await executeSell({
        rowId, adapter, strategy, log, state, exitResult, session,
      });
      session.phase = 'WATCHING';
      session.rulesState = null;
    } catch {
      return { phase: 'BOUGHT' };
    }
    return { phase: 'WATCHING' };
  }

  return { phase };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color) {
  if (registry.has(row.id)) return;

  let strategy = resolveStrategy(row);
  if (!strategy) return;

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, row.strategy_id, color);

  const ctx = {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: registry.sessionKey(row.symbol, row.strategy_id),
    adapter,
    log,
    strategy,
    stopped: false,
    timer: null,
    configFingerprint: configFingerprint(row),
  };

  let lastResult = { phase: row.phase };
  const rs = parseRulesState(row);
  const session  = {
    volCache: null,
    phase: ['BOUGHT', 'PENDING'].includes(row.phase) ? row.phase : null,
    pendingPullback: rs.pendingPullback ?? null,
    rulesState: null,
    lastExitTime: rs.lastExitTime ?? null,
    lastCooldownLogAt: 0,
    lastEntryCapLogAt: 0,
    lastPendingLogAt: 0,
  };
  let volIv;

  const stop = async () => {
    if (ctx.stopped) return;
    ctx.stopped = true;
    if (ctx.timer) clearTimeout(ctx.timer);
    if (volIv) clearInterval(volIv);
    registry.unregister(ctx.rowId);
  };

  const updateFromRow = (newRow) => {
    const next = resolveStrategy(newRow);
    if (!next) return;
    ctx.strategy = next;
  };

  registry.register(row.id, {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: ctx.key,
    stop,
    updateFromRow,
    configFingerprint: ctx.configFingerprint,
  });

  const refreshVol = async () => {
    if (ctx.stopped) return;
    try {
      const volumeUsdt = await adapter.fetch24hVol();
      session.volCache = { ts: Date.now(), volumeUsdt };
    } catch {}
  };
  await refreshVol();
  volIv = setInterval(refreshVol, VOL_CACHE_MS);

  const schedule = () => {
    if (ctx.stopped) return;
    const delay = lastResult.phase === 'BOUGHT' ? ctx.strategy.fastPollMs : ctx.strategy.pollMs;
    ctx.timer = setTimeout(run, delay);
  };

  const run = async () => {
    if (ctx.stopped) return;
    try {
      lastResult = await tick(ctx.rowId, adapter, ctx.strategy, log, session);
    } catch (err) {
      log(`❌ Tick error: ${err.message}`);
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

  const symbolFilter = process.argv.includes('--symbol')
    ? process.argv[process.argv.indexOf('--symbol') + 1]?.toUpperCase()
    : null;

  let rows = await loadMaCrossRows();
  rows = (rows ?? []).filter(r => isMaCrossStrategy(r.strategy_id));
  if (symbolFilter) {
    rows = rows.filter(r => r.symbol.toUpperCase() === symbolFilter);
  }

  startMultitradeWatch({
    sbReq,
    strategyIds: STRATEGY_IDS,
    symbolFilter,
    resolveStrategy,
    onStartSymbol: (row) => {
      const idx = row.symbol.charCodeAt(0) + (row.strategy_id?.length ?? 0);
      return startSymbol(row, COLORS[idx % COLORS.length]);
    },
    log: console.log,
  });

  const toStart = [];
  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const color   = COLORS[i % COLORS.length];
    const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
    const strategy = resolveStrategy(row);
    const minVol = strategy?.config.minVolumeUsdt ?? 3_000_000;

    let volOk = true;
    try {
      const vol = await adapter.fetch24hVol();
      volOk  = vol >= minVol;
    } catch {}

    if (!volOk && !strategy?.config.allowLowVolume) {
      if (!symbolFilter) {
        const resp = await askUser(
          `   ${Y}⚠️${X} Volume baixo — incluir ${row.symbol} [${row.strategy_id}]? [s/N]: `,
        );
        if (resp !== 's' && resp !== 'sim') continue;
      }
    }
    toStart.push({ row, color });
  }

  if (!toStart.length) {
    await new Promise(() => {});
    return;
  }

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
