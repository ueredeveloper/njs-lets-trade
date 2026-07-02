'use strict';

/**
 * Bot AMAP — Adaptive MA Pullback
 *
 * Configuração via trade_config (Supabase / painel Multi-Trade).
 * Motor: strategyEngine.js + tradeConfigSchema.js
 *
 * Modo bot     : node backend/bot/amap/amap-bot.js
 * Filtrar      : node backend/bot/amap/amap-bot.js --symbol BTCUSDT
 * Backtest     : node backend/bot/amap/amap-bot.js --backtest BTCUSDT [exchange] [capital]
 * Adaptativo   : node backend/bot/amap/amap-bot.js --adaptive-test BTCUSDT binance 1h 4h
 * Extensão 3/4 : node backend/bot/amap/amap-bot.js --extension-test BTCUSDT [exchange] [threeInterval] [fourInterval]
 *
 * Guia completo de avaliação pré-trade: backend/bot/amap/AVALIACAO-PRE-TRADE.md
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
const { gateMarketSell: gateMarketSellCore } = require('../gate/gateMarketSell');
const { sendWhatsApp } = require('../whatsapp');
const {
  buildTradeConfig, getRequiredSpecs, computeAdaptiveDips, buildMaSnapshot, buildAdaptiveReport,
  isStopLossExit, checkRsi, maKey,
} = require('./strategyEngine');
const { fmtVolumeUsdt } = require('../volume24h');
const { configFromRow, resolveStrategy, hasAdaptiveFilters } = require('./tradeConfigSchema');
const { parseRulesState, isRuleActive } = require('./rulesState');
const { runDualRuleTick } = require('./dualRuleTick');
const { computeRule1EntryAdaptiveDips } = require('./rule1Engine');
const { analyzeExtensionHistory, printExtensionReport } = require('./extensionBacktest');
const { runAmapBacktest, formatStopLossLabel, formatEntryPathsLabel, ENTRY_OUTCOME_LABELS } = require('./amapBacktest');
const { buildExitReasonDetail, packExitReasonForDb } = require('./exitReasonFormat');

const EXCHANGES    = new Set(['binance', 'gate']);
const MA_INTERVALS = new Set(['15m', '30m', '1h', '2h', '4h', '8h', '1d']);

function parseExtensionTestArgs(argv) {
  const symbol = argv[1]?.toUpperCase();
  if (!symbol) return { symbol: null };

  let exchange = null;
  const intervals = [];
  for (let i = 2; i < argv.length; i++) {
    if (EXCHANGES.has(argv[i])) exchange = argv[i];
    else if (MA_INTERVALS.has(argv[i])) intervals.push(argv[i]);
  }
  return {
    symbol,
    exchange,
    threeInterval: intervals[0] ?? null,
    fourInterval:  intervals[1] ?? intervals[0] ?? null,
  };
}

function parseBacktestArgs(argv) {
  const symbol = argv[1]?.toUpperCase();
  if (!symbol) return { symbol: null };
  let exchange = null;
  let capital  = null;
  for (let i = 2; i < argv.length; i++) {
    if (EXCHANGES.has(argv[i])) exchange = argv[i];
    else {
      const n = parseFloat(argv[i]);
      if (!Number.isNaN(n)) capital = n;
    }
  }
  return { symbol, exchange, capital };
}

async function backtestFromSupabase(symbol, exchangeHint, capitalHint) {
  if (!SB_URL || !SB_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  const row = await loadSavedBacktestRow(symbol, exchangeHint);
  if (!row) {
    console.error(`❌ ${symbol} não encontrado no Supabase (rsi_multi_bot_state / multitrade_favorites).`);
    console.error('   Salve no painel Multi-Trade antes de rodar o backtest.');
    process.exit(1);
  }

  const config = configFromRow(row);
  if (!config) {
    console.error(`❌ ${symbol}: sem trade_config válido`);
    process.exit(1);
  }

  const exchange = exchangeHint ?? row.exchange ?? 'binance';
  const capital  = capitalHint ?? parseFloat(row.capital ?? 100);
  console.log(`\n📦 Supabase: ${symbol} [${exchange}]  capital=$${capital}`);
  await backtest(symbol, config, exchange, capital);
}

async function refreshAdaptiveDips(adapter, config) {
  const specs = getRequiredSpecs(config).map(s => ({ ...s, limit: Math.max(s.limit, 300) }));
  const cMap  = await fetchCandleMap(adapter, specs);
  return computeRule1EntryAdaptiveDips(cMap, config.rule1 ?? config);
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
  // Saída sempre agressiva na Gate — prioriza preenchimento sem erro
  return adapter.marketSell(qty, log, { aggressive: true });
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

function padCol(str, n) {
  const s = String(str);
  return s.length >= n ? s.slice(0, n) : s.padEnd(n);
}

function formatEntryOutcome(outcome, pnlPct) {
  const base = ENTRY_OUTCOME_LABELS[outcome] ?? outcome ?? '—';
  if (pnlPct == null || Number.isNaN(pnlPct)) return base;
  const sign = pnlPct >= 0 ? '+' : '';
  return `${base} (${sign}${pnlPct.toFixed(2)}%)`;
}

function printBacktestReport(result, config) {
  const { summary, period, candlesByInterval } = result;
  const pSign = summary.totalPnlUsdt >= 0 ? '+' : '';

  console.log(`\n${'─'.repeat(68)}`);
  console.log(`📊 Backtest AMAP: ${result.symbol} [${result.exchange}]  —  ${result.label}`);
  console.log(`   Entrada: ${formatEntryPathsLabel(config)}`);
  console.log(`   Saída  : RSI(${config.exitRsi.interval})${config.exitRsi.operator}${config.exitRsi.value}`);
  console.log(`   Stop   : ${formatStopLossLabel(config)}`);
  console.log(`   Vol mín: ${fmtVolumeUsdt(config.minVolumeUsdt ?? 1_000_000)} 24h (não simulado no histórico)`);
  console.log(`   Candle de scan: ${getEntryScanInterval(config)}`);
  if (period) {
    console.log(`   Análise: ${period.daysLbl}  (${period.count} candles, ${fmtDate(period.from)} → ${fmtDate(period.to)})`);
  }
  for (const [iv, count] of Object.entries(candlesByInterval ?? {})) {
    console.log(`   ${iv}: ${count} candles`);
  }

  console.log(`\n   Capital  : $${summary.startCapital.toFixed(2)} → $${summary.endCapital.toFixed(2)}  (${pSign}${summary.totalPnlPct}%)`);
  console.log(`   Trades   : ${summary.trades}  |  Wins: ${summary.wins}  Losses: ${summary.losses}  |  Win rate: ${summary.winRate ?? '—'}%`);
  console.log(`   PnL total: ${pSign}$${summary.totalPnlUsdt.toFixed(2)}`);
  if (summary.blockedCount) console.log(`   Bloqueados (MA/extensão): ${summary.blockedCount} sinais`);
  if (summary.stopMaCount) console.log(`   Stop Loss MA: ${summary.stopMaCount} saída(s)`);
  if (summary.stopAdaptCount) console.log(`   Stop Loss adaptativo: ${summary.stopAdaptCount} saída(s)`);

  printEntrySignalHistory(result.entryLog, config);
}

function printEntrySignalHistory(entryLog, config) {
  if (!entryLog.length) {
    console.log('\n   Histórico de entradas: nenhum sinal RSI no período.');
    return;
  }

  const maLabels = (config.maFilters ?? []).map(f => `MA${f.period} ${f.interval}`);
  const showExt  = config.extension?.enabled;
  const divider  = '─'.repeat(Math.min(120, 42 + maLabels.length * 13 + (showExt ? 18 : 0)));

  console.log(`\n   Histórico de entradas possíveis (${entryLog.length} sinais RSI):`);
  console.log(divider);

  let hdr = `  ${padCol('Data', 18)} ${padCol('RSI', 5)} ${padCol('Preço', 10)}`;
  for (const l of maLabels) hdr += ` ${padCol(l, 12)}`;
  if (showExt) hdr += ` ${padCol('Ext', 5)} ${padCol('3 vel', 6)} ${padCol('4 vel', 6)}`;
  hdr += ` ${padCol('Resultado', 36)}`;
  console.log(hdr);
  console.log(divider);

  for (const e of entryLog) {
    const ts = e.time ?? (e.timeISO ? new Date(e.timeISO).getTime() : Date.now());
    let row = `  ${padCol(fmtDate(ts), 18)} ${padCol(e.rsi.toFixed(1), 5)} ${padCol(fmtP(e.price), 10)}`;
    for (const label of maLabels) {
      const m = e.maChecks.find(x => x.label === label);
      row += ` ${padCol(m ? (m.ok ? 'sim' : 'não') : '—', 12)}`;
    }
    if (showExt) {
      const ext = e.extension;
      if (!ext?.extended) {
        row += ` ${padCol('não', 5)} ${padCol('—', 6)} ${padCol('—', 6)}`;
      } else {
        row += ` ${padCol('sim', 5)}`;
        row += ` ${padCol(ext.threeOk ? 'sim' : 'não', 6)}`;
        row += ` ${padCol(ext.fourOk ? 'sim' : 'não', 6)}`;
      }
    }
    row += ` ${formatEntryOutcome(e.outcome, e.pnlPct)}`;
    console.log(row);
  }
  console.log(divider);
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

async function gateMarketSell(pair, qty, log, opts = {}) {
  return gateMarketSellCore(
    { gateReq, getTokenBalance: gateGetTokenBalance },
    pair, qty, log, { ...opts, fmtPrice: fmtP },
  );
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

function inferEntryKindFromPending(trigger, limit, config) {
  const t = Number(trigger);
  const l = Number(limit);
  if (!t || !l || t <= 0) return null;
  const disc = 1 - l / t;
  const maD  = config.rule2?.entryDiscount ?? 0.02;
  const rsiD = config.rule1?.entryDiscount ?? config.entryDiscount ?? 0.001;
  if (Math.abs(disc - maD) < 0.003) return 'ma';
  if (Math.abs(disc - rsiD) < 0.003) return 'rsi';
  return null;
}

function entrySignalFields(state, rowId, { price, entryRsi, exitRsi, ma50, ma2, candleOpenTime, entry_kind }) {
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
    ...(entry_kind ? { metadata: { entry_kind } } : {}),
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
    const p  = config.extension.maPeriod ?? 50;
    if (!snap[maKey(p, iv)]) add(maKey(p, iv), p, iv);
  }
  const sl = config.stopLoss;
  if (sl) add(`sl_${maKey(sl.period, sl.interval)}`, sl.period, sl.interval);
  return snap;
}

async function backtest(symbol, config, exchange = 'binance', capital = 100) {
  const result = await runAmapBacktest({ symbol, config, exchange, capital });
  if (result.error) {
    console.error(`   ❌ ${result.error}`);
    return;
  }
  printBacktestReport(result, config);
}

// ── Eventos por regra (compra/venda/pending) ───────────────────────────────
async function processRuleEvents({
  events, ruleId, rulesState, state, rowId, adapter, config, session, log, capital,
  entryRsi, exitRsi, close, candleMs,
}) {
  for (const ev of events) {
    const entryKind = ruleId === 'rule2' ? 'ma' : 'rsi';
    const sigBase = () => entrySignalFields(state, rowId, {
      price: close, entryRsi, exitRsi, ma50: null, ma2: null, candleOpenTime: candleMs,
      entry_kind: entryKind,
    });
    if (ev.type === 'blocked') {
      const reasons = {
        MA_BLOCKED: 'preço abaixo da MA (fixo)',
        MA_ADAPTIVE_BLOCKED: 'preço abaixo do piso adaptativo',
        THREE_CANDLES_BLOCKED: 'extensão sem confirmação 3/4 candles',
        VOLUME_LOW: 'volume abaixo do mínimo',
      };
      log(`${Y}⚠️  [${ruleId}] bloqueado: ${reasons[ev.reason] ?? ev.reason}${X}`);
    } else if (ev.type === 'pending') {
      const discPct = (ev.discount * 100).toFixed(1);
      log(`${G}🎯 [${ruleId}] PENDING −${discPct}% alvo $${fmtP(ev.limitPrice)}${X}`);
      const sigId = await insertEntrySignal({
        ...sigBase(), status: 'pending',
        trigger_price: ev.triggerPrice, limit_price: ev.limitPrice,
        pending_since: new Date().toISOString(),
      });
      session[`${ruleId}SignalId`] = sigId;
    } else if (ev.type === 'cancel') {
      log(`${Y}❌ [${ruleId}] PENDING cancelado (${ev.reason})${X}`);
      await patchEntrySignal(session[`${ruleId}SignalId`], {
        status: 'cancelled', block_reason: ev.reason, pending_until: new Date().toISOString(),
      });
      session[`${ruleId}SignalId`] = null;
    } else if (ev.type === 'buy') {
      let result;
      try { result = await adapter.marketBuy(parseFloat(capital)); }
      catch (err) { log(`❌ [${ruleId}] Erro na compra: ${err.message}`); continue; }
      const { filledQty, quoteQty, avgPrice } = result;
      const now = new Date().toISOString();
      rulesState[ruleId].buy_qty = filledQty;
      rulesState[ruleId].buy_usdt = quoteQty;
      rulesState[ruleId].buy_price = avgPrice;
      const sigId = session[`${ruleId}SignalId`];
      if (sigId) {
        await patchEntrySignal(sigId, {
          status: 'executed', immediate_entry: ev.immediate,
          executed_at: now, executed_price: avgPrice, executed_qty: filledQty, executed_usdt: quoteQty,
        });
      }
      log(`${G}✅ [${ruleId}] COMPRA $${fmtP(avgPrice)} qty=${filledQty}${X}`);
    } else if (ev.type === 'sell') {
      const rs = rulesState[ruleId];
      let result;
      try { result = await executeMarketSell(adapter, config, session, parseFloat(rs.buy_qty), log); }
      catch (err) { log(`❌ [${ruleId}] Erro na venda: ${err.message}`); continue; }
      const { soldQty, usdtOut, exitPrice } = result;
      const pnlUsdt = usdtOut - parseFloat(rs.buy_usdt);
      const capitalAfter = parseFloat(capital) + pnlUsdt;
      const stopLossHit = isStopLossExit(ev.exitReason);
      const ruleConfig = ruleId === 'rule2' ? config.rule2 : config.rule1;
      const exitDetail = ev.exitEval
        ? buildExitReasonDetail({ ruleId, exitEval: ev.exitEval, ruleConfig })
        : null;
      const exitReasonStored = exitDetail
        ? packExitReasonForDb(exitDetail)
        : ev.exitReason;
      log(`${stopLossHit ? '🛑' : '🔴'} [${ruleId}] VENDA — ${exitDetail?.short ?? ev.exitReason} PnL=$${pnlUsdt.toFixed(2)}`);
      await insertTrade({
        symbol: state.symbol, exchange: state.exchange, strategy_id: state.strategy_id ?? 'flex',
        entry_time: rs.buy_time, exit_time: new Date().toISOString(),
        entry_price: rs.buy_price, exit_price: exitPrice,
        qty: soldQty, usdt_in: parseFloat(rs.buy_usdt), usdt_out: usdtOut,
        pnl_usdt: pnlUsdt, pnl_pct: parseFloat((pnlUsdt / parseFloat(rs.buy_usdt) * 100).toFixed(2)),
        capital_before: parseFloat(capital), capital_after: capitalAfter,
        rsi_entry: parseFloat(rs.rsi_entry ?? 0), rsi_exit: exitRsi,
        exit_reason: exitReasonStored,
        entry_signal_id: session[`${ruleId}SignalId`],
      });
      session[`${ruleId}SignalId`] = null;
    }
  }
  return rulesState;
}

// ── Tick (loop ao vivo) — regras independentes ──────────────────────────────
async function tick(rowId, adapter, strategy, log, prevExitRsi, session) {
  return runDualRuleTick({
    rowId, adapter, strategy, log, prevExitRsi, session,
    fetchCandleMap, loadState, saveState, getRequiredSpecs,
    checkEntryVolume, processRuleEvents, fmtP,
  });
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color) {
  const strategy = resolveStrategy(row);
  if (!strategy) {
    console.error(`❌ strategy_id "${row.strategy_id}" sem trade_config para ${row.symbol}`);
    return;
  }

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, color);

  const rulesState = parseRulesState(row);
  log(
    `=== AMAP Bot | ${adapter.name} | ${adapter.pair}` +
    ` | ${strategy.label}` +
    ` | poll: ${strategy.pollMs / 1000}s/${strategy.fastPollMs / 1000}s` +
    ` | R1:${rulesState.rule1.phase} R2:${rulesState.rule2.phase} ===`,
  );

  if (rulesState.rule1.phase === 'BOUGHT') {
    log(`♻️  [R1] Posição — $${fmtP(rulesState.rule1.buy_price)} qty=${rulesState.rule1.buy_qty}`);
  }
  if (rulesState.rule1.phase === 'PENDING') {
    const ms = Date.now() - new Date(rulesState.rule1.pending_since).getTime();
    log(`♻️  [R1] PENDING — alvo=$${fmtP(rulesState.rule1.limit_price)} | há ${fmtDur(ms)}`);
  }
  if (rulesState.rule2.phase === 'BOUGHT') {
    log(`♻️  [R2] Posição — $${fmtP(rulesState.rule2.buy_price)} qty=${rulesState.rule2.buy_qty}`);
  }
  if (rulesState.rule2.phase === 'PENDING') {
    const ms = Date.now() - new Date(rulesState.rule2.pending_since).getTime();
    log(`♻️  [R2] PENDING — alvo=$${fmtP(rulesState.rule2.limit_price)} | há ${fmtDur(ms)}`);
  }
  if (strategy.config.allowLowVolume) {
    log(`ℹ️  Volume baixo autorizado — saída sempre a mercado`);
  }

  let lastResult = { entryRsi: null, exitRsi: null, phase: row.phase };
  let errCount   = 0;
  const session  = {
    entryCandleMs: null,
    rule1SignalId: null,
    rule2SignalId: null,
    adaptiveDips: null,
    rule2Dip: null,
  };

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
    const { phase, exitRsi, rulesState } = lastResult;
    const r2Pending = rulesState?.rule2?.phase === 'PENDING';
    const r1Pending = rulesState?.rule1?.phase === 'PENDING' || phase === 'PENDING';
    const fast  = r1Pending || r2Pending || (exitRsi !== null && exitRsi >= strategy.fastRsiThreshold);
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

async function runExtensionTest(symbol, exchangeHint, intervalOverrides = {}) {
  let config = buildTradeConfig({});
  let exchange = exchangeHint ?? 'binance';

  if (SB_URL && SB_KEY) {
    const row = await loadSavedBacktestRow(symbol, exchangeHint);
    if (row) {
      const fromRow = configFromRow(row);
      if (fromRow) config = fromRow;
      exchange = exchangeHint ?? row.exchange ?? 'binance';
    }
  }

  const { threeInterval, fourInterval } = intervalOverrides;
  if (threeInterval || fourInterval) {
    config = {
      ...config,
      extension: {
        ...config.extension,
        threeInterval: threeInterval ?? config.extension?.threeInterval,
        fourInterval:  fourInterval ?? threeInterval ?? config.extension?.fourInterval,
      },
    };
  }

  if (!config.extension?.threeCandles && !config.extension?.fourCandles) {
    config = {
      ...config,
      extension: {
        ...config.extension,
        enabled: true,
        threeCandles: true,
        fourCandles: true,
      },
    };
  }

  const adapter = buildAdapter(exchange, symbol);
  const specs   = getRequiredSpecs(config);
  const LIMIT   = 1000;
  const cMap    = {};

  for (const { interval, limit } of specs) {
    const local = loadLocalCandles(symbol, interval);
    cMap[interval] = local ?? await adapter.fetchCandles(Math.max(limit, LIMIT), interval);
  }

  const result = analyzeExtensionHistory(cMap, config);
  printExtensionReport(symbol, config, result);
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--extension-test') {
    const parsed = parseExtensionTestArgs(args);

    if (!parsed.symbol) {
      console.log('Uso: node amap-bot.js --extension-test <SYMBOL> [exchange] [threeInterval] [fourInterval]');
      console.log('Ex:  node amap-bot.js --extension-test BTCUSDT binance 1h');
      console.log('Ex:  node amap-bot.js --extension-test BTCUSDT binance 1h 4h');
      console.log('\n  Usa trade_config do Supabase (se existir) ou defaults AMAP.');
      console.log('  threeInterval / fourInterval sobrescrevem os candles das regras 3 e 4.');
      console.log('  Simula cada sinal RSI+MA esticado acima da MA e compara:');
      console.log('    • entradas confirmadas (3/4 OK) vs bloqueadas');
      console.log('    • trades salvos (bloqueio evitou prejuízo) vs oportunidades perdidas');
      process.exit(0);
    }

    await Promise.all([syncBinanceClock(), syncGateClock()]);
    await runExtensionTest(parsed.symbol, parsed.exchange, {
      threeInterval: parsed.threeInterval,
      fourInterval:  parsed.fourInterval,
    });
    console.log();
    process.exit(0);
  }

  if (args[0] === '--adaptive-test') {
    const symbol    = args[1]?.toUpperCase();
    const exchange  = args[2] ?? 'binance';
    const intervals = args.length > 3 ? args.slice(3) : ['1h', '4h'];

    if (!symbol) {
      console.log('Uso: node amap-bot.js --adaptive-test <SYMBOL> [exchange] [intervals...]');
      console.log('Ex:  node amap-bot.js --adaptive-test BTCUSDT binance 1h 4h');
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
      console.log('Uso: node amap-bot.js --backtest <SYMBOL> [exchange] [capital]');
      console.log('\nExemplos:');
      console.log('  node amap-bot.js --backtest BTCUSDT');
      console.log('  node amap-bot.js --backtest BTCUSDT binance 40');
      process.exit(0);
    }

    await Promise.all([syncBinanceClock(), syncGateClock()]);
    await backtestFromSupabase(parsed.symbol, parsed.exchange, parsed.capital);
    console.log();
    process.exit(0);
  }

  // ── Modo bot ───────────────────────────────────────────────────────────────
  // Filtro opcional: node amap-bot.js --symbol AVNTUSDT
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
    console.error('❌ Nenhum símbolo em rsi_multi_bot_state. Execute amap-bot.sql no Supabase.');
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

  console.log('\n🤖 Bot AMAP — amap-bot.js');
  console.log('   Config: trade_config (Supabase / painel Multi-Trade)\n');

  const toStart = [];

  for (let i = 0; i < rows.length; i++) {
    const row      = rows[i];
    const strategy = resolveStrategy(row);
    const adapter  = buildAdapter(row.exchange ?? 'binance', row.symbol);
    const color    = COLORS[i % COLORS.length];

    if (!strategy) {
      console.log(`   ⚠️  ${row.symbol}: sem trade_config — ignorado`);
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
