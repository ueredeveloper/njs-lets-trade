'use strict';
/**
 * Avalia se o OBV (On-Balance Volume) teria ajudado a confirmar/evitar
 * entradas nos trades ma-cross da semana, testando em 15m, 1h e 4h.
 *
 * Regra testada: no candle fechado da entrada, OBV é comparado com o valor
 * de N candles atrás (lookback por intervalo). OBV subindo = "confirma"
 * (volume respalda o movimento de alta do cross_up); OBV caindo/estável =
 * "diverge" (alta sem suporte de volume — sinal de alerta).
 *
 * Uso: node backend/bot/ma-cross/analyze-obv-week.js
 *      node backend/bot/ma-cross/analyze-obv-week.js --from 2026-07-07
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const INTERVALS = ['15m', '1h', '4h'];
const INTERVAL_MS = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
const LOOKBACK = { '15m': 10, '1h': 10, '4h': 6 };
const PAD_MS = { '15m': 5 * 86_400_000, '1h': 15 * 86_400_000, '4h': 40 * 86_400_000 };

function weekStartMs() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();

  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - diff);
  return mon.getTime();
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
      out.push({ openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] });
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
    open: +c[5], high: +c[3], low: +c[4], close: +c[2], volume: +c[6],
  }));
}

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const cMapCache = new Map();

async function loadCMap(exchange, symbol, entryMs) {
  const key = `${exchange}:${symbol}`;
  if (cMapCache.has(key)) return cMapCache.get(key);

  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const end = Date.now() + 86_400_000;
  const cMap = {};
  for (const iv of INTERVALS) {
    cMap[iv] = await fetcher(symbol, iv, entryMs - PAD_MS[iv], end);
  }
  cMapCache.set(key, cMap);
  return cMap;
}

/** Só candles fechados antes do momento de entrada. */
function candlesClosedBefore(candles, iv, entryMs) {
  const ms = INTERVAL_MS[iv];
  return (candles ?? []).filter(c => c.openTime + ms <= entryMs);
}

function obvSignalAt(candles, iv) {
  const lb = LOOKBACK[iv];
  if (!candles || candles.length < lb + 5) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const obv = ti.OBV.calculate({ close: closes, volume: volumes });
  if (obv.length < lb + 1) return null;

  const last = obv[obv.length - 1];
  const prior = obv[obv.length - 1 - lb];
  const priceLast = closes[closes.length - 1];
  const priceOld = closes[closes.length - 1 - lb];

  const obvRising = last > prior;
  const pricePctChange = priceOld ? ((priceLast / priceOld) - 1) * 100 : null;
  // normaliza delta OBV pelo volume médio da janela p/ virar % comparável entre moedas
  const avgVol = volumes.slice(-lb).reduce((s, v) => s + v, 0) / lb || 1;
  const obvDeltaNorm = ((last - prior) / avgVol) * 100;

  return { obvRising, obvDeltaNorm, pricePctChange, confirms: obvRising };
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;

  const cMap = await loadCMap(exchange, symbol, entryMs);

  const perInterval = {};
  for (const iv of INTERVALS) {
    const closed = candlesClosedBefore(cMap[iv], iv, entryMs);
    perInterval[iv] = obvSignalAt(closed, iv);
  }

  const pnl = trade.pnl_usdt != null ? +trade.pnl_usdt : null;
  const closed = trade.exit_time != null && pnl != null;

  return {
    symbol,
    exchange,
    entryMs,
    pnlUsdt: pnl,
    closed,
    open: !closed,
    perInterval,
  };
}

function summarizeInterval(iv, results) {
  const valid = results.filter(r => r.perInterval[iv] != null);
  const confirmed = valid.filter(r => r.perInterval[iv].confirms);
  const diverged = valid.filter(r => !r.perInterval[iv].confirms);

  const closedConfirmed = confirmed.filter(r => r.closed);
  const closedDiverged = diverged.filter(r => r.closed);

  const pnlAll = valid.filter(r => r.closed).reduce((s, r) => s + r.pnlUsdt, 0);
  const pnlConfirmed = closedConfirmed.reduce((s, r) => s + r.pnlUsdt, 0);
  const pnlDiverged = closedDiverged.reduce((s, r) => s + r.pnlUsdt, 0);
  const winsConfirmed = closedConfirmed.filter(r => r.pnlUsdt >= 0).length;
  const winsDiverged = closedDiverged.filter(r => r.pnlUsdt >= 0).length;

  return {
    iv,
    n: valid.length,
    confirmedN: confirmed.length,
    divergedN: diverged.length,
    pnlAll,
    pnlConfirmed,
    pnlDiverged,
    closedConfirmedN: closedConfirmed.length,
    closedDivergedN: closedDiverged.length,
    winsConfirmed,
    winsDiverged,
    // ganho ao filtrar os trades onde o OBV diverge do movimento
    delta: pnlConfirmed - pnlAll,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = weekStartMs();
  const fromIso = new Date(fromMs).toISOString();
  console.log(`\n═══ OBV vs trades ma-cross da semana (15m / 1h / 4h) ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      results.push(await analyzeTrade(t));
      process.stderr.write(' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message, perInterval: {} });
    }
  }

  const valid = results.filter(r => !r.error);
  console.log('── Resumo ──');
  console.log(`Trades no período: ${trades.length} (${valid.filter(r => r.closed).length} fechados, ${valid.filter(r => r.open).length} abertos)\n`);

  console.log('Intervalo | Confirma/Diverge | PnL real | PnL só confirmados | PnL divergentes | Delta vs real | W/L confirma | W/L diverge');
  console.log('----------|------------------|----------|---------------------|------------------|----------------|--------------|------------');
  const summaries = INTERVALS.map(iv => summarizeInterval(iv, valid));
  for (const s of summaries) {
    console.log(
      `${s.iv.padEnd(9)} | ${`${s.confirmedN}/${s.divergedN}`.padEnd(16)} | ${s.pnlAll.toFixed(2).padStart(8)} | ${s.pnlConfirmed.toFixed(2).padStart(19)} | ${s.pnlDiverged.toFixed(2).padStart(16)} | ${(s.delta >= 0 ? '+' : '') + s.delta.toFixed(2)} USDT`.padEnd(0),
    );
    console.log(`          |                  |          |                     |                  |                | ${s.winsConfirmed}W/${s.closedConfirmedN - s.winsConfirmed}L`.padEnd(0) + `        | ${s.winsDiverged}W/${s.closedDivergedN - s.winsDiverged}L`);
  }

  const best = [...summaries].sort((a, b) => b.delta - a.delta)[0];
  console.log(`\n→ Intervalo onde o OBV mais teria ajudado (maior delta de PnL ao filtrar divergentes): ${best.iv} (${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(2)} USDT)\n`);

  console.log('── Detalhe por trade ──');
  console.log('Símbolo     | Entrada (BRT)       | PnL USDT | OBV 15m        | OBV 1h         | OBV 4h');
  console.log('------------|---------------------|----------|----------------|----------------|---------------');
  for (const r of valid) {
    const pnlStr = r.closed ? `${r.pnlUsdt >= 0 ? '+' : ''}${r.pnlUsdt.toFixed(2)}` : 'aberto';
    const cell = iv => {
      const p = r.perInterval[iv];
      if (!p) return '—';
      return `${p.confirms ? 'confirma' : 'DIVERGE'} (${fmtPct(p.obvDeltaNorm)})`;
    };
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(19)} | ${pnlStr.padStart(8)} | ${cell('15m').padEnd(14)} | ${cell('1h').padEnd(14)} | ${cell('4h')}`,
    );
  }

  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: erro — ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
