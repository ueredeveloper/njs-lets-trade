'use strict';
/**
 * Mesmos trades reais do ma-cross (entrada 1h, como está hoje), mas agora:
 *   - CHOP(14) medido no candle 4h mais próximo (e anterior) fechado antes da entrada,
 *     em vez do 1h (ver discussão: 4h filtra o ruído do próprio candle de cruzamento).
 *   - Saída simulada = corrida entre três condições, o que disparar primeiro, andando
 *     candle a candle (5m) a partir da entrada:
 *       a) stop loss trailing — mesma fórmula de computeStopLossFloor em strategyEngine.js
 *          (maxLossPct 5%, trailStepPct 5%, igual ao trade_config real de produção):
 *          o piso começa em entry*0.95 e sobe a cada degrau de 5% que o preço avança;
 *       b) preço bate +5% da entrada (candles finos 5m, como o "Alvo % histórico BB");
 *       c) EMA9 cruza ↓ EMA21 no 1h (candle fechado) — preço de saída = close desse candle.
 *     Dentro do mesmo candle 5m, stop loss é checado antes do alvo (mais conservador).
 *   - Um teto de 10 dias após a entrada evita varredura infinita quando nenhuma das
 *     condições dispara (marca como SEM_SAIDA e fica fora das médias).
 *
 * Uso: node backend/bot/ma-cross/analyze-chop4h-exit-race-2w.js
 *      node backend/bot/ma-cross/analyze-chop4h-exit-race-2w.js --days 14
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HOUR_MS  = 3_600_000;
const FOUR_H_MS = 4 * HOUR_MS;
const FINE_IV  = '5m';
const FINE_MS  = 300_000;
const CHOP_PERIOD = 14;
const TP_PCT = 5;
const SCAN_CAP_MS = 10 * 86_400_000;
const HIST_PAD_4H_MS = 30 * 86_400_000;  // ~180 candles 4h — sobra pra CHOP(14) estabilizar
const HIST_PAD_1H_MS = 50 * 86_400_000;  // warmup pra EMA9/21 (1h) igual aos scripts anteriores

const INTERVAL_SEC = { '5m': 300, '1h': 3600, '4h': 14400 };

// Mesma config real de produção vista no trade_config das moedas (stopLoss.enabled/trailing/
// maxLossPct/trailStepPct) — ver rsi_multi_bot_state.trade_config.stopLoss.
const STOP_LOSS_CONFIG = { enabled: true, trailing: true, maxLossPct: 5, trailStepPct: 5 };

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

function trueRange(candles) {
  const tr = [null];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return tr;
}

function chopSeries(candles, n = CHOP_PERIOD) {
  const tr = trueRange(candles);
  const out = new Array(candles.length).fill(null);
  for (let i = n; i < candles.length; i++) {
    const trWindow = tr.slice(i - n + 1, i + 1);
    if (trWindow.some(v => v == null)) continue;
    const window = candles.slice(i - n + 1, i + 1);
    const sumTR = trWindow.reduce((a, b) => a + b, 0);
    const hh = Math.max(...window.map(c => c.high));
    const ll = Math.min(...window.map(c => c.low));
    if (hh - ll <= 0) continue;
    out[i] = 100 * Math.log10(sumTR / (hh - ll)) / Math.log10(n);
  }
  return out;
}

function emaDiffSeries(candles, fastP = 9, slowP = 21) {
  const closes = candles.map(c => c.close);
  const fast = ti.EMA.calculate({ period: fastP, values: closes });
  const slow = ti.EMA.calculate({ period: slowP, values: closes });
  const offFast = closes.length - fast.length;
  const offSlow = closes.length - slow.length;
  const diff = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const f = i - offFast >= 0 ? fast[i - offFast] : null;
    const s = i - offSlow >= 0 ? slow[i - offSlow] : null;
    if (f != null && s != null) diff[i] = f - s;
  }
  return diff;
}

function idxAtOrBefore(candles, ms) {
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].openTime <= ms) idx = i; else break;
  }
  return idx;
}

function classify(chop) {
  if (chop == null) return null;
  if (chop < 38.2) return 'tendência (<38.2)';
  if (chop > 61.8) return 'choppy (>61.8)';
  return 'neutro (38.2-61.8)';
}

/** Primeiro candle 1h (fechado, após a entrada) onde EMA9 cruza abaixo da EMA21. */
function findCrossDownAfter(candles1h, diff, entryIdx) {
  for (let i = entryIdx + 1; i < candles1h.length; i++) {
    if (diff[i - 1] == null || diff[i] == null) continue;
    if (diff[i - 1] >= 0 && diff[i] < 0) {
      return { confirmMs: candles1h[i].openTime + HOUR_MS, price: candles1h[i].close };
    }
  }
  return null;
}

/**
 * Anda candle a candle (5m) desde a entrada até o primeiro de: stop loss trailing tocado
 * (low <= piso, checado antes do alvo no mesmo candle — mais conservador), ou +5% batido
 * (high >= alvo). Não anda além de crossDownMs (se existir) — a partir dali quem decide é
 * o cruzamento de baixa, resolvido fora desta função.
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

  // CHOP(14) no 4h, último candle fechado antes/na entrada.
  const candles4h = await fetcher(symbol, '4h', entryMs - HIST_PAD_4H_MS, entryMs + FOUR_H_MS);
  if (candles4h.length < CHOP_PERIOD + 10) return { symbol, error: 'candles 4h insuficientes' };
  const idx4h = idxAtOrBefore(candles4h, entryMs);
  if (idx4h < 0) return { symbol, error: 'sem candle 4h na entrada' };
  const chop4h = chopSeries(candles4h, CHOP_PERIOD);
  const chopAtEntry4h = chop4h[idx4h];
  if (chopAtEntry4h == null) return { symbol, error: 'CHOP(4h) indisponível na entrada' };

  // EMA9/21 (1h) — warmup antes da entrada + varredura até o teto de 10 dias depois.
  const candles1h = await fetcher(symbol, '1h', entryMs - HIST_PAD_1H_MS, entryMs + SCAN_CAP_MS);
  if (candles1h.length < 30) return { symbol, error: 'candles 1h insuficientes' };
  const entryIdx1h = idxAtOrBefore(candles1h, entryMs);
  if (entryIdx1h < 0) return { symbol, error: 'sem candle 1h na entrada' };
  const diff1h = emaDiffSeries(candles1h, 9, 21);
  const crossDown = findCrossDownAfter(candles1h, diff1h, entryIdx1h);

  // Candles finos (5m) da entrada até o teto, pra achar stop loss / +5% — o que vier primeiro,
  // sem passar do candle onde o cruzamento de baixa já teria confirmado.
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

  return {
    symbol, entryMs, chopAtEntry4h, realPnlPct,
    exitType: outcome.type, exitMs: outcome.confirmMs, simPnlPct: outcome.pnlPct,
  };
}

function summarizeByChop(results) {
  const groups = new Map();
  for (const r of results) {
    const key = classify(r.chopAtEntry4h);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  console.log('\n── Por faixa de CHOP(14) no 4h na entrada (saída: stop 5% trailing / EMA9x21 cruza↓ 1h / +5%) ──');
  console.log('Faixa                | N  | TP5 | MA↓ | SL | Vitórias | Taxa acerto | PnL médio | PnL total');
  console.log('----------------------|----|-----|-----|----|----------|-------------|-----------|----------');
  const order = [...groups.keys()].sort();
  for (const key of order) {
    const g = groups.get(key);
    const tp5 = g.filter(r => r.exitType === 'TP5').length;
    const maDown = g.filter(r => r.exitType === 'MA_DOWN').length;
    const sl = g.filter(r => r.exitType === 'STOP_LOSS').length;
    const wins = g.filter(r => r.simPnlPct > 0).length;
    const avgPnl = g.reduce((s, r) => s + r.simPnlPct, 0) / g.length;
    const totalPnl = g.reduce((s, r) => s + r.simPnlPct, 0);
    console.log(
      `${key.padEnd(21)} | ${String(g.length).padStart(2)} | ${String(tp5).padStart(3)} | ${String(maDown).padStart(3)} | ${String(sl).padStart(2)} | `
      + `${String(wins).padStart(8)} | ${(wins / g.length * 100).toFixed(0).padStart(10)}% | `
      + `${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2).padStart(8)}% | ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`,
    );
  }
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();

  console.log(`\n═══ ma-cross — entrada 1h real, CHOP(14) no 4h, saída = stop 5% trailing / EMA9x21 cruza↓(1h) / +5% ═══`);
  console.log(`Período: desde ${fromIso}\n`);

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
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ` ok (${r.exitType})\n`);
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const ok = results.filter(r => !r.error && r.exitType !== 'SEM_SAIDA');
  const semSaida = results.filter(r => r.exitType === 'SEM_SAIDA');
  const errors = results.filter(r => r.error);

  console.log(`\nTrades no período: ${trades.length}`);
  console.log(`Com saída simulada (dentro do teto de 10 dias): ${ok.length}`);
  console.log(`Sem saída no teto de 10 dias (fora das médias): ${semSaida.length}`);
  console.log(`Erros / dados insuficientes: ${errors.length}`);

  if (ok.length) {
    const totalSim = ok.reduce((s, r) => s + r.simPnlPct, 0);
    const totalReal = ok.reduce((s, r) => s + r.realPnlPct, 0);
    console.log(`\nSoma PnL simulado (stop 5% trailing / cruza↓ 1h / +5%): ${totalSim >= 0 ? '+' : ''}${totalSim.toFixed(2)}%`);
    console.log(`Soma PnL real dos mesmos trades (referência): ${totalReal >= 0 ? '+' : ''}${totalReal.toFixed(2)}%`);
    summarizeByChop(ok);
  }

  console.log('\n── Detalhe por trade ──');
  console.log('Símbolo     | Entrada             | CHOP(4h) | Saída sim | PnL sim  | PnL real');
  console.log('------------|---------------------|----------|-----------|----------|----------');
  for (const r of [...ok, ...semSaida]) {
    const chopStr = r.chopAtEntry4h != null ? r.chopAtEntry4h.toFixed(1) : '—';
    const simStr = r.simPnlPct != null ? `${r.simPnlPct >= 0 ? '+' : ''}${r.simPnlPct.toFixed(2)}%` : '—';
    console.log(
      `${r.symbol.padEnd(11)} | ${new Date(r.entryMs).toISOString().slice(0, 16).replace('T', ' ').padEnd(19)} | `
      + `${chopStr.padStart(8)} | ${r.exitType.padEnd(9)} | ${simStr.padStart(8)} | `
      + `${(r.realPnlPct >= 0 ? '+' : '') + r.realPnlPct.toFixed(2)}%`,
    );
  }

  for (const r of errors) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
