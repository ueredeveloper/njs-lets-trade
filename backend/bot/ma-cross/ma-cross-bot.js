'use strict';

/**
 * MA Cross Bot — cruzamento de duas MAs (compra) + cruzamento inverso (venda).
 *
 * strategy_id: ma-cross
 * Exemplo: MA9(15m) cruza ↑ MA21(15m) com preço acima de MA50(1h) adaptativo (máx 4%).
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
const { sendWhatsApp } = require('../whatsapp');
const { fmtVolumeUsdt } = require('../volume24h');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isMaCrossStrategy } = require('./strategyPresets');
const {
  getRequiredSpecs, evaluateEntry, evaluateExit, computeAdaptiveDips,
} = require('./strategyEngine');

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
  return { filledQty: grossQty * (1 - GATE_FEE_RATE), quoteQty: quoteQty || grossQty * avgPrice, avgPrice };
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

function buildAdapter(exchange, symbol) {
  if (exchange === 'gate') {
    const pair = toGateSymbol(symbol);
    return {
      name: 'Gate.io', pair,
      fetchCandles: (lim, iv) => fetchGateCandles(pair, lim, iv),
      marketBuy:    (usdt)     => gateMarketBuy(pair, usdt),
      marketSell:   (qty, log) => gateMarketSell(pair, qty, log),
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
  return `MA${block.ma1.period}(${block.ma1.interval}) ${dir} MA${block.ma2.period}(${block.ma2.interval})`;
}

async function saveState(id, update) {
  await sbReq('PATCH', 'rsi_multi_bot_state', { ...update, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
}

async function insertTrade(trade) {
  try { await sbReq('POST', 'rsi_multi_bot_trades', trade); } catch (err) {
    console.warn(`[trade] insert: ${err.message}`);
  }
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

// ── Tick ──────────────────────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, log, session) {
  const { config } = strategy;
  const specs = getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);
  const adaptiveDips = computeAdaptiveDips(config, cMap);

  const entryCheck = evaluateEntry(config, cMap, adaptiveDips);
  const exitEval   = evaluateExit(config, cMap, null);

  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) { log('❌ Linha não encontrada.'); return { phase: 'WATCHING' }; }

  const { phase, capital, symbol, strategy_id: strategyId } = state;
  const buyPrice = state.buy_price ? parseFloat(state.buy_price) : null;

  const ma1s = entryCheck.ma1?.toFixed(6) ?? '—';
  const ma2s = entryCheck.ma2?.toFixed(6) ?? '—';

  log(
    `MA1=${ma1s}  MA2=${ma2s}` +
    `  close=${entryCheck.close?.toFixed(6) ?? '—'}` +
    (entryCheck.filterMa != null ? `  filtMA=${entryCheck.filterMa.toFixed(6)}` : '') +
    `  capital=${parseFloat(capital).toFixed(2)}  fase=${phase}` +
    (entryCheck.reason && !entryCheck.allowed ? `  (${entryCheck.reason})` : ''),
  );

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    if (!entryCheck.allowed) return { phase };

    const vol = session.volCache?.volumeUsdt;
    const minVol = config.minVolumeUsdt ?? 1_000_000;
    if (vol != null && vol < minVol && !config.allowLowVolume) {
      log(`${Y}⚠️  Sinal de entrada mas volume ${fmtVolumeUsdt(vol)} < ${fmtVolumeUsdt(minVol)}${X}`);
      return { phase };
    }

    const kindLabel = entryCheck.entryDesc ?? crossDesc(config.entry);
    log(`${G}📍 Sinal de COMPRA (${kindLabel}) — comprando ${parseFloat(capital).toFixed(2)} USDT${X}`);

    let result;
    try {
      result = await adapter.marketBuy(parseFloat(capital));
    } catch (err) {
      log(`❌ Erro na compra: ${err.message}`);
      return { phase };
    }

    const { filledQty, quoteQty, avgPrice } = result;
    await saveState(rowId, {
      phase: 'BOUGHT', buy_price: avgPrice, buy_qty: filledQty,
      buy_usdt: quoteQty, buy_time: new Date().toISOString(),
      rsi_entry: entryCheck.ma1,
    });

    log(`${'─'.repeat(60)}`);
    log(`${G}🟢 COMPRA EXECUTADA${X}`);
    log(`   Preço : ${avgPrice.toFixed(6)}  Qty: ${filledQty}  USDT: ${quoteQty.toFixed(4)}`);
    log(`${'─'.repeat(60)}`);
    sendWhatsApp(`🟢 MA-CROSS COMPRA [${strategyId}] ${symbol}\nPreço: ${avgPrice}\nUSDT: ${quoteQty.toFixed(4)}`);
    return { phase: 'BOUGHT' };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  if (phase === 'BOUGHT') {
    const exitResult = evaluateExit(config, cMap, buyPrice);
    if (!exitResult.exit) return { phase };

    const reason = exitResult.reason === 'STOP_LOSS'
      ? `stop-loss ${exitResult.dropPct?.toFixed(2)}%`
      : (exitResult.exitDesc ?? exitResult.reason ?? crossDesc(config.exit?.maCross ?? config.exit));

    log(`${R}📈 ${reason} — vendendo ${state.buy_qty} ${symbol}${X}`);

    let result;
    try {
      result = await adapter.marketSell(parseFloat(state.buy_qty), log);
    } catch (err) {
      log(`❌ Erro na venda: ${err.message}`);
      return { phase };
    }

    const { soldQty, usdtOut, exitPrice } = result;
    const capitalBefore = parseFloat(capital);
    const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
    const pnlPct        = (pnlUsdt / capitalBefore) * 100;
    const capitalAfter  = capitalBefore + pnlUsdt;
    const pnlSign       = pnlUsdt >= 0 ? '+' : '';

    await insertTrade({
      symbol, exchange: state.exchange, strategy_id: strategyId,
      entry_time: state.buy_time, exit_time: new Date().toISOString(),
      entry_price: buyPrice, exit_price: exitPrice,
      qty: soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: usdtOut,
      pnl_usdt: pnlUsdt, pnl_pct: parseFloat(pnlPct.toFixed(2)),
      capital_before: capitalBefore, capital_after: capitalAfter,
      rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: exitResult.ma1 ?? 0,
      exit_reason: exitResult.reason,
    });

    await saveState(rowId, {
      capital: capitalAfter, phase: 'WATCHING',
      buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
    });

    log(`${'─'.repeat(60)}`);
    log(`${R}🔴 VENDA EXECUTADA${X}`);
    log(`   PnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)`);
    log(`   Capital: ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)} USDT`);
    log(`${'─'.repeat(60)}`);
    sendWhatsApp(`🔴 MA-CROSS VENDA [${strategyId}] ${symbol}\nPnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)`);
    return { phase: 'WATCHING' };
  }

  return { phase };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color) {
  const strategy = resolveStrategy(row);
  if (!strategy) {
    console.error(`❌ ${row.symbol} [${row.strategy_id}]: sem trade_config MA Cross válido`);
    return;
  }

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, row.strategy_id, color);
  const { config } = strategy;

  const filt = config.maFiltersEnabled !== false && (config.maFilters ?? []).some(f => f.enabled)
    ? ` + ${(config.maFilters ?? []).filter(f => f.enabled).length} filtro(s) MA`
    : '';

  log(
    `=== MA Cross | ${adapter.name} | ${strategy.label}` +
    ` | entrada: ${crossDesc(config.entry)}${filt}` +
    ` | saída: ${config.exit?.maCross?.enabled ? crossDesc(config.exit.maCross) : ''}` +
    `${config.exit?.rsi?.enabled ? ' + RSI' : ''}` +
    ` | poll: ${strategy.pollMs / 1000}s` +
    ` | fase: ${row.phase} ===`,
  );

  if (row.phase === 'BOUGHT') {
    log(`♻️  Posição — $${parseFloat(row.buy_price).toFixed(6)} qty=${row.buy_qty}`);
  }

  let lastResult = { phase: row.phase };
  let errCount   = 0;
  const session  = { volCache: null };

  const refreshVol = async () => {
    try {
      const volumeUsdt = await adapter.fetch24hVol();
      session.volCache = { ts: Date.now(), volumeUsdt };
    } catch {}
  };
  await refreshVol();
  setInterval(refreshVol, VOL_CACHE_MS);

  const schedule = () => {
    const delay = lastResult.phase === 'BOUGHT' ? strategy.fastPollMs : strategy.pollMs;
    setTimeout(run, delay);
  };

  const run = async () => {
    try {
      lastResult = await tick(row.id, adapter, strategy, log, session);
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

  const symbolFilter = process.argv.includes('--symbol')
    ? process.argv[process.argv.indexOf('--symbol') + 1]?.toUpperCase()
    : null;

  let rows = await loadMaCrossRows();
  if (!rows?.length) {
    console.error('❌ Nenhum símbolo MA Cross em rsi_multi_bot_state.');
    console.error('   Adicione moedas no painel Multi-Trade com strategy ma-cross.');
    process.exit(1);
  }

  rows = rows.filter(r => isMaCrossStrategy(r.strategy_id));
  if (symbolFilter) {
    rows = rows.filter(r => r.symbol.toUpperCase() === symbolFilter);
    if (!rows.length) {
      console.error(`❌ ${symbolFilter} não encontrado com estratégia MA Cross.`);
      process.exit(1);
    }
  }

  console.log('\n🤖 MA Cross Bot — ma-cross-bot.js');
  console.log(`   Estratégias: ${STRATEGY_IDS.join(', ')}`);
  console.log(`   Símbolos: ${rows.length}\n`);

  const toStart = [];
  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const color   = COLORS[i % COLORS.length];
    const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
    const strategy = resolveStrategy(row);
    const minVol = strategy?.config.minVolumeUsdt ?? 1_000_000;

    let volFmt = 'n/a', volOk = true;
    try {
      const vol = await adapter.fetch24hVol();
      volFmt = fmtVolumeUsdt(vol);
      volOk  = vol >= minVol;
    } catch {}

    console.log(
      `   ${color}${row.symbol}${X}  [${row.strategy_id}]  exchange=${row.exchange ?? 'binance'}` +
      `  capital=$${parseFloat(row.capital).toFixed(2)}  vol24h=${volFmt}  fase=${row.phase}`,
    );

    if (!volOk && !strategy?.config.allowLowVolume) {
      console.log(`   ${Y}⚠️  Volume abaixo do mínimo${X}`);
      if (!symbolFilter) {
        const resp = await askUser(`   Incluir ${row.symbol} [${row.strategy_id}]? [s/N]: `);
        if (resp !== 's' && resp !== 'sim') continue;
      }
    }
    toStart.push({ row, color });
  }

  console.log();
  if (!toStart.length) { console.error('❌ Nenhum símbolo aprovado.'); process.exit(0); }

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
