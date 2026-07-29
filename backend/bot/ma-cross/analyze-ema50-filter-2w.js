'use strict';
/**
 * Mesmos trades reais do ma-cross (entrada 1h, como está hoje), testando a regra proposta:
 *   além do cruzamento EMA9↑EMA21 (1h) já usado pelo bot, só entraria se o close do candle
 *   de entrada estivesse ACIMA da EMA50(1h), com tolerância de 0.5% abaixo dela — mesma
 *   semântica do filtro de produção mode:'strict_above' (ver checkPriceFilter em
 *   strategyEngine.js):
 *     floor = EMA50(1h) * (1 - 0.5%)
 *     permitido: close > floor
 *   Trade cujo close na entrada real cai abaixo do floor é classificado "bloqueado" —
 *   o filtro teria impedido essa entrada.
 *
 *   Saída simulada (só para os trades "permitidos") = corrida entre três condições, o que
 *   disparar primeiro, andando candle a candle (5m) a partir da entrada real:
 *     a) stop loss trailing — mesma fórmula de computeStopLossFloor em strategyEngine.js
 *        (maxLossPct 5%, trailStepPct 5%, igual ao trade_config real de produção);
 *     b) preço bate +5% da entrada (candles finos 5m);
 *     c) EMA9 cruza ↓ EMA21 no 1h (candle fechado) — preço de saída = close desse candle.
 *   Teto de 10 dias após a entrada evita varredura infinita (SEM_SAIDA).
 *
 * Uso: node backend/bot/ma-cross/analyze-ema50-filter-2w.js
 *      node backend/bot/ma-cross/analyze-ema50-filter-2w.js --days 14 --tolerance-pct 0.5
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { buildMaTimeSeries, maValueAt } = require('./strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HOUR_MS = 3_600_000;
const FINE_IV = '5m';
const FAST_PERIOD = 9;
const SLOW_PERIOD = 21;
const FILTER_PERIOD = 50;
const TP_PCT = 5;
const SCAN_CAP_MS = 10 * 86_400_000;
const HIST_PAD_1H_MS = 50 * 86_400_000; // warmup pra EMA9/21/50 (1h)

const INTERVAL_SEC = { '5m': 300, '1h': 3600, '4h': 14400 };

// Mesma config real de produção (rsi_multi_bot_state.trade_config.stopLoss).
const STOP_LOSS_CONFIG = { enabled: true, trailing: true, maxLossPct: 5, trailStepPct: 5 };

function argNum(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? Number(v) : def;
}

const TOLERANCE_PCT = argNum('--tolerance-pct', 0.5);

/** Cópia de computeStopLossFloor em strategyEngine.js — mesma fórmula do bot real. */
function computeStopLossFloor(entryPrice, peakPrice, stopLoss = STOP_LOSS_CONFIG) {
  const maxLossPct = stopLoss.maxLossPct ?? 5;
  if (!entryPrice || entryPrice <= 0) return null;

  const trailing = stopLoss.trailing !== false;
  const peak = peakPrice != null ? Math.max(entryPrice, peakPrice) : entryPrice;

  if (!trailing || !stopLoss.enabled) {
    return entryPrice * (1 - maxLossPct / 100);
  }

  const stepPct = Math.max(0.5, Number(stopLoss.trailStepPct ?? maxLossPct));
  const risePct = ((peak - entryPrice) / entryPrice) * 100;
  const steps = Math.floor(Math.max(0, risePct) / stepPct);
  const anchorPrice = entryPrice * (1 + (steps * stepPct) / 100);
  return anchorPrice * (1 - maxLossPct / 100);
}

function fromMsArg() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();
  const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
  const days = daysArg ? Number(daysArg) : 14;
  return Date.now() - days * 86_400_000;
}

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchBinanceRange(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      const t = Number(c[0]);
      if (t > endMs) break;
      out.push({ openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4] });
    }
    const last = raw[raw.length - 1][0];
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

async function fetchGateRange(symbol, interval, startMs, endMs) {
  const pair = toGateSymbol(symbol);
  const stepSec = INTERVAL_SEC[interval] ?? 3600;
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const from = Math.floor(cursor / 1000);
    const to = Math.min(Math.floor(endMs / 1000), from + 1000 * stepSec);
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      out.push({ openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2] });
    }
    const last = Number(raw[raw.length - 1][0]) * 1000;
    if (last <= cursor) break;
    cursor = last + stepSec * 1000;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

function fetcherFor(exchange) {
  return exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
}

function idxAtOrBefore(candles, ms) {
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].openTime <= ms) idx = i; else break;
  }
  return idx;
}

/** Primeiro candle 1h (fechado, após a entrada) onde EMA9 cruza abaixo da EMA21. */
function findCrossDownAfter(candles1h, fastSeries, slowSeries, entryMs) {
  for (let i = 1; i < candles1h.length; i++) {
    const c = candles1h[i];
    const p = candles1h[i - 1];
    if (c.openTime - p.openTime !== HOUR_MS) continue;
    const closeTime = c.openTime + HOUR_MS;
    if (closeTime <= entryMs) continue;
    const ma1 = maValueAt(fastSeries, c.openTime);
    const ma2 = maValueAt(slowSeries, c.openTime);
    const prevMa1 = maValueAt(fastSeries, p.openTime);
    const prevMa2 = maValueAt(slowSeries, p.openTime);
    if (prevMa1 == null || prevMa2 == null || ma1 == null || ma2 == null) continue;
    if (prevMa1 >= prevMa2 && ma1 < ma2) {
      return { confirmMs: closeTime, price: c.close };
    }
  }
  return null;
}

/**
 * Anda candle a candle (5m) desde a entrada até o primeiro de: stop loss trailing tocado
 * (checado antes do alvo no mesmo candle), ou +5% batido. Não anda além de crossDownMs.
 */
function walkForStopOrTp(fineCandles, entryMs, entryPrice, crossDownMs) {
  const target = entryPrice * (1 + TP_PCT / 100);
  let peak = entryPrice;
  for (const c of fineCandles) {
    if (c.openTime < entryMs) continue;
    if (crossDownMs != null && c.openTime >= crossDownMs) break;
    peak = Math.max(peak, c.high);
    const floor = computeStopLossFloor(entryPrice, peak, STOP_LOSS_CONFIG);
    if (c.low <= floor) return { type: 'STOP_LOSS', confirmMs: c.openTime, price: floor };
    if (c.high >= target) return { type: 'TP5', confirmMs: c.openTime, price: target };
  }
  return null;
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const entryPrice = +trade.entry_price;
  const realPnlPct = +trade.pnl_pct;
  const fetcher = fetcherFor(exchange);

  const candles1h = await fetcher(symbol, '1h', entryMs - HIST_PAD_1H_MS, entryMs + SCAN_CAP_MS);
  if (candles1h.length < FILTER_PERIOD + 30) return { symbol, error: 'candles 1h insuficientes' };

  const entryIdx1h = idxAtOrBefore(candles1h, entryMs);
  if (entryIdx1h < 0) return { symbol, error: 'sem candle 1h na entrada' };
  const entryCandle1h = candles1h[entryIdx1h];

  const fastSeries = buildMaTimeSeries(candles1h, FAST_PERIOD);
  const slowSeries = buildMaTimeSeries(candles1h, SLOW_PERIOD);
  const filterSeries = buildMaTimeSeries(candles1h, FILTER_PERIOD);

  const ema50AtEntry = maValueAt(filterSeries, entryCandle1h.openTime);
  if (ema50AtEntry == null) return { symbol, error: 'EMA50(1h) indisponível na entrada' };

  const floor = ema50AtEntry * (1 - TOLERANCE_PCT / 100);
  const distPct = ((entryPrice - ema50AtEntry) / ema50AtEntry) * 100;
  const allowed = entryPrice > floor;

  const base = {
    symbol, entryMs, entryPrice, realPnlPct,
    ema50AtEntry, distPct, floor, allowed,
  };

  if (!allowed) return base;

  const crossDown = findCrossDownAfter(candles1h, fastSeries, slowSeries, entryMs);
  const fine = await fetcher(symbol, FINE_IV, entryMs, entryMs + SCAN_CAP_MS);
  const slOrTp = walkForStopOrTp(fine, entryMs, entryPrice, crossDown?.confirmMs ?? null);

  let outcome;
  if (slOrTp) {
    outcome = {
      type: slOrTp.type,
      confirmMs: slOrTp.confirmMs,
      pnlPct: ((slOrTp.price - entryPrice) / entryPrice) * 100,
    };
  } else if (crossDown) {
    outcome = {
      type: 'MA_DOWN',
      confirmMs: crossDown.confirmMs,
      pnlPct: ((crossDown.price - entryPrice) / entryPrice) * 100,
    };
  } else {
    outcome = { type: 'SEM_SAIDA', confirmMs: null, pnlPct: null };
  }

  return { ...base, exitType: outcome.type, exitMs: outcome.confirmMs, simPnlPct: outcome.pnlPct };
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function fmtDt(ms) {
  if (ms == null) return '—';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();

  console.log(`\n═══ ma-cross — entrada 1h real + filtro EMA50(1h) (tolerância ${TOLERANCE_PCT}%), saída = stop 5% trailing / EMA9x21 cruza↓(1h) / +5% ═══`);
  console.log(`Período: desde ${fromIso}`);
  console.log(`Regra testada: só entraria se close > EMA50(1h) * (1 - ${TOLERANCE_PCT}%) no candle da entrada real\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&entry_time=not.is.null&entry_price=not.is.null&pnl_pct=not.is.null&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross com entrada neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      const r = await analyzeTrade(t);
      results.push(r);
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ` ok (${r.allowed ? r.exitType ?? 'sim' : 'bloqueado'})\n`);
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const errors = results.filter(r => r.error);
  const blocked = results.filter(r => !r.error && r.allowed === false);
  const allowedResults = results.filter(r => !r.error && r.allowed === true);
  const simulated = allowedResults.filter(r => r.exitType && r.exitType !== 'SEM_SAIDA');
  const semSaida = allowedResults.filter(r => r.exitType === 'SEM_SAIDA');

  console.log('\n── Resumo geral ──');
  console.log(`Trades reais no período: ${trades.length}`);
  console.log(`  Permitidos pelo filtro EMA50 (entrariam): ${allowedResults.length}`);
  console.log(`    com saída simulada dentro do teto de 10 dias: ${simulated.length}`);
  console.log(`    sem saída no teto (fora das médias): ${semSaida.length}`);
  console.log(`  Bloqueados pelo filtro EMA50 (não entrariam): ${blocked.length}`);
  console.log(`  Erros / dados insuficientes: ${errors.length}`);

  const realTotalAll = results.filter(r => !r.error).reduce((s, r) => s + r.realPnlPct, 0);
  const realTotalBlocked = blocked.reduce((s, r) => s + r.realPnlPct, 0);
  const realTotalAllowed = allowedResults.reduce((s, r) => s + r.realPnlPct, 0);
  const simTotalAllowed = simulated.reduce((s, r) => s + r.simPnlPct, 0);

  console.log(`\nPnL REAL — todos os trades do período:        ${fmtPct(realTotalAll)}`);
  console.log(`PnL REAL — apenas os que o filtro bloquearia:  ${fmtPct(realTotalBlocked)}  (deixaria de ganhar/perder isso)`);
  console.log(`PnL REAL — apenas os que o filtro permitiria:  ${fmtPct(realTotalAllowed)}`);
  console.log(`PnL SIMULADO — permitidos, c/ saída (5% / SL trailing / EMA cross↓): ${fmtPct(simTotalAllowed)}`);
  console.log(`  → PnL total do sistema com o filtro (bloqueados = 0):  ${fmtPct(simTotalAllowed)}  (Δ vs real total: ${fmtPct(simTotalAllowed - realTotalAll)})`);

  if (simulated.length) {
    const wins = simulated.filter(r => r.simPnlPct > 0).length;
    const tp5 = simulated.filter(r => r.exitType === 'TP5').length;
    const maDown = simulated.filter(r => r.exitType === 'MA_DOWN').length;
    const sl = simulated.filter(r => r.exitType === 'STOP_LOSS').length;
    console.log(`\nTaxa de acerto (permitidos, c/ saída): ${((wins / simulated.length) * 100).toFixed(0)}% (${wins}/${simulated.length})`);
    console.log(`Saídas: TP5=${tp5}  EMA9x21↓=${maDown}  STOP_LOSS=${sl}`);
  }

  console.log('\n── Detalhe — permitidos pelo filtro ──');
  console.log('Símbolo     | Entrada             | Dist. EMA50 | Saída sim | PnL sim  | PnL real');
  console.log('------------|---------------------|-------------|-----------|----------|----------');
  for (const r of [...simulated, ...semSaida]) {
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${fmtPct(r.distPct).padStart(11)} | `
      + `${(r.exitType ?? '—').padEnd(9)} | ${fmtPct(r.simPnlPct).padStart(8)} | ${fmtPct(r.realPnlPct).padStart(8)}`,
    );
  }

  if (blocked.length) {
    console.log('\n── Detalhe — bloqueados pelo filtro (close abaixo do floor EMA50) ──');
    console.log('Símbolo     | Entrada             | Dist. EMA50 | PnL real');
    console.log('------------|---------------------|-------------|----------');
    for (const r of blocked) {
      console.log(`${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${fmtPct(r.distPct).padStart(11)} | ${fmtPct(r.realPnlPct).padStart(8)}`);
    }
  }

  for (const r of errors) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
