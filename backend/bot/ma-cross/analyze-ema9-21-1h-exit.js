'use strict';
/**
 * Para cada trade REAL do ma-cross fechado com sucesso (pnl_pct >= 0) num período,
 * simula uma saída alternativa por cruzamento EMA9 x EMA21 no candle de 1h
 * (cross_down = EMA9 cruza pra baixo da EMA21, mesma lógica de config.exit.maCross
 * usada em produção — ver detectCrossAtPair/checkMaCrossover em strategyEngine.js)
 * e compara o resultado com a saída real (bbTakeProfit/bbUpper/RSI/MA HTF/etc.).
 *
 * A busca do cruzamento começa no primeiro candle 1h que fecha após a entrada e
 * continua além da saída real (até +7 dias, limitado a "agora") pra também revelar
 * os casos em que essa regra teria segurado a posição além do que o bot vendeu.
 *
 * Uso: node backend/bot/ma-cross/analyze-ema9-21-1h-exit.js
 *      node backend/bot/ma-cross/analyze-ema9-21-1h-exit.js --days 30
 *      node backend/bot/ma-cross/analyze-ema9-21-1h-exit.js --from 2026-06-01
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { buildMaTimeSeries, maValueAt, detectCrossAtPair } = require('./strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const IV = '1h';
const IV_MS = 3_600_000;
const FAST_PERIOD = 9;
const SLOW_PERIOD = 21;
const WARMUP_PAD_MS = 7 * 86_400_000;   // candles antes da entrada, pra EMA21(1h) convergir
const POST_EXIT_SEARCH_MS = 7 * 86_400_000; // até quando procurar o cross após a saída real

function fromMsArg() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(fromArg.includes('T') ? fromArg : `${fromArg}T00:00:00-03:00`).getTime();
  const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
  const days = daysArg ? Number(daysArg) : 30;
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
  const from = Math.floor(startMs / 1000);
  const to = Math.floor(endMs / 1000);
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
  const raw = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    openTime: Number(c[0]) * 1000,
    open: +c[5], high: +c[3], low: +c[4], close: +c[2],
  }));
}

function fmtDt(ms) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '—';
  const h = ms / 3_600_000;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function areConsecutive1h(prev, candle) {
  return prev && candle && (Number(candle.openTime) - Number(prev.openTime) === IV_MS);
}

/** Primeiro cruzamento EMA9 x EMA21 (1h) cross_down após entryMs, varrendo pra frente. */
function findFirstCrossDownAfter(candles, entryMs) {
  const fastSeries = buildMaTimeSeries(candles, FAST_PERIOD);
  const slowSeries = buildMaTimeSeries(candles, SLOW_PERIOD);
  if (!fastSeries.length || !slowSeries.length) return null;

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prev = candles[i - 1];
    const closeTime = candle.openTime + IV_MS;
    if (closeTime <= entryMs) continue;
    if (!areConsecutive1h(prev, candle)) continue;

    const ma1 = maValueAt(fastSeries, candle.openTime);
    const ma2 = maValueAt(slowSeries, candle.openTime);
    const prevMa1 = maValueAt(fastSeries, prev.openTime);
    const prevMa2 = maValueAt(slowSeries, prev.openTime);
    if (!detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, 'cross_down', 0)) continue;

    return {
      crossOpenTime: candle.openTime,
      crossCloseTime: closeTime,
      exitPrice: candle.close,
      ema9: ma1,
      ema21: ma2,
    };
  }
  return null;
}

async function analyzeTrade(trade, nowMs) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exitMs = new Date(trade.exit_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const entryPrice = +trade.entry_price;
  const realPnlPct = trade.pnl_pct != null ? +trade.pnl_pct : null;
  const realPnlUsdt = trade.pnl_usdt != null ? +trade.pnl_usdt : null;

  const searchEndMs = Math.min(exitMs + POST_EXIT_SEARCH_MS, nowMs);
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const candles = await fetcher(symbol, IV, entryMs - WARMUP_PAD_MS, searchEndMs);

  if (!candles.length) return { symbol, exchange, error: 'sem candles 1h no período' };

  const cross = findFirstCrossDownAfter(candles, entryMs);

  const simExitPrice = cross ? cross.exitPrice : null;
  const simPnlPct = cross ? ((simExitPrice - entryPrice) / entryPrice) * 100 : null;
  const simExitMs = cross ? cross.crossCloseTime : null;
  const hitSearchLimit = !cross && searchEndMs >= nowMs - IV_MS;

  return {
    symbol, exchange, entryMs, exitMs, entryPrice,
    durationRealMs: exitMs - entryMs,
    realPnlPct, realPnlUsdt,
    exitReason: trade.exit_reason,
    cross,
    simExitMs,
    simPnlPct,
    durationSimMs: simExitMs != null ? simExitMs - entryMs : null,
    hitSearchLimit,
    deltaPct: simPnlPct != null && realPnlPct != null ? simPnlPct - realPnlPct : null,
    simLaterThanReal: simExitMs != null ? simExitMs > exitMs : null,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();
  const nowMs = Date.now();
  console.log(`\n═══ Saída alternativa EMA9 x EMA21 (1h, cross_down) vs saída real — trades de SUCESSO do ma-cross ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&entry_time=not.is.null&exit_time=not.is.null&pnl_pct=gte.0&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade de sucesso (pnl_pct >= 0) do ma-cross neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      const r = await analyzeTrade(t, nowMs);
      results.push(r);
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const valid = results.filter(r => !r.error);
  const withCross = valid.filter(r => r.cross);
  const noCross = valid.filter(r => !r.cross);

  const realPnlTotal = valid.reduce((s, r) => s + r.realPnlPct, 0);
  // Para quem não teve cross ainda, usa o pnl real como aproximação (posição "ainda aberta" sob essa regra).
  const simPnlTotal = valid.reduce((s, r) => s + (r.simPnlPct ?? r.realPnlPct), 0);

  console.log('── Resumo geral ──');
  console.log(`Trades de sucesso analisados: ${valid.length} (de ${trades.length} no período)`);
  console.log(`PnL real (soma pct):                 ${fmtPct(realPnlTotal)}`);
  console.log(`PnL simulado EMA9x21(1h) (soma pct):  ${fmtPct(simPnlTotal)}  (Δ ${fmtPct(simPnlTotal - realPnlTotal)})`);
  console.log(`Cruzamento EMA9x21(1h) encontrado:    ${withCross.length}/${valid.length}`);
  console.log(`Sem cruzamento até o limite de busca: ${noCross.length}/${valid.length} (regra teria segurado a posição além do fim da janela analisada)\n`);

  if (withCross.length) {
    const better = withCross.filter(r => r.deltaPct > 0.001);
    const worse = withCross.filter(r => r.deltaPct < -0.001);
    const equal = withCross.length - better.length - worse.length;
    const later = withCross.filter(r => r.simLaterThanReal).length;
    const earlier = withCross.filter(r => !r.simLaterThanReal).length;

    console.log('── Entre os trades com cruzamento encontrado ──');
    console.log(`Saída EMA melhor que a real:  ${better.length}/${withCross.length}`);
    console.log(`Saída EMA pior que a real:    ${worse.length}/${withCross.length}`);
    console.log(`Empate (~0):                  ${equal}/${withCross.length}`);
    console.log(`Cross depois da saída real (regra teria segurado mais): ${later}/${withCross.length}`);
    console.log(`Cross antes/no mesmo momento da saída real (teria vendido antes ou junto): ${earlier}/${withCross.length}`);
    const deltaSum = withCross.reduce((s, r) => s + r.deltaPct, 0);
    console.log(`Δ médio por trade (com cruzamento): ${fmtPct(deltaSum / withCross.length)}\n`);
  }

  console.log('── Detalhe por trade ──');
  console.log('Símbolo     | Entrada (BRT)       | Saída real (motivo)              | PnL real | Saída EMA9x21(1h)   | PnL sim  |    Δ    | Duração real → sim');
  console.log('------------|---------------------|-----------------------------------|----------|---------------------|----------|---------|--------------------');
  for (const r of valid) {
    const exitReasonStr = `${fmtDt(r.exitMs)} (${r.exitReason ?? '—'})`;
    const simStr = r.cross
      ? fmtDt(r.simExitMs)
      : (r.hitSearchLimit ? 'sem cross (janela esgotada)' : 'sem cross');
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${exitReasonStr.padEnd(35)} | ${fmtPct(r.realPnlPct).padStart(8)} | ${simStr.padEnd(19)} | ${fmtPct(r.simPnlPct).padStart(8)} | ${fmtPct(r.deltaPct).padStart(7)} | ${fmtDur(r.durationRealMs).padStart(6)} → ${r.durationSimMs != null ? fmtDur(r.durationSimMs) : '—'}`,
    );
  }

  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
