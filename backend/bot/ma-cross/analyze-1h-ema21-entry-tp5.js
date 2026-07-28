'use strict';
/**
 * Para os trades reais do ma-cross fechados (entrada 1h), simula uma entrada alternativa:
 * "e se, em vez de entrar no cruzamento EMA9↑EMA21 (1h), eu esperasse o preço recuar e
 * tocar o valor da EMA21 (1h) depois do cruzamento — e a saída fosse sempre +5% fixo?"
 *
 * Passo a passo por trade real:
 *  1) Localiza o cruzamento EMA9↑EMA21 (1h) mais próximo (e anterior) ao entry_time real.
 *  2) A partir desse candle, espera até WAIT_CANDLES candles 1h. Se em algum desses candles
 *     o low tocar o valor da EMA21 daquele candle (ou a EMA9 cruzar de volta pra baixo antes
 *     disso), compra ali. Se a janela fechar sem tocar, desiste (sem entrada).
 *  3) Se tocou, a entrada hipotética é o valor da EMA21 (não o candle real). Daí simula o
 *     alvo fixo de +5%, usando candles finos (5m) para achar o MFE e o tempo até bater.
 *
 * Uso: node backend/bot/ma-cross/analyze-1h-ema21-entry-tp5.js
 *      node backend/bot/ma-cross/analyze-1h-ema21-entry-tp5.js --days 14 --wait-candles 5
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { buildMaTimeSeries } = require('../../utils/movingAverage');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HOUR_IV = '1h';
const HOUR_IV_MS = 3_600_000;
const FINE_IV = '5m';
const FINE_IV_MS = 300_000;
const TP_PCT = 5;
const TP_SCAN_CAP_MS = 10 * 86_400_000;

function fromMsArg() {
  const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
  const days = daysArg ? Number(daysArg) : 14;
  return Date.now() - days * 86_400_000;
}

function waitCandlesArg() {
  const arg = process.argv.find((a, i) => process.argv[i - 1] === '--wait-candles');
  return arg ? Number(arg) : 5;
}

const WAIT_CANDLES = waitCandlesArg();

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
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const from = Math.floor(cursor / 1000);
    const to = Math.min(Math.floor(endMs / 1000), from + 1000 * (interval === '1h' ? 3600 : 300));
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      out.push({ openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2] });
    }
    const last = Number(raw[raw.length - 1][0]) * 1000;
    if (last <= cursor) break;
    cursor = last + FINE_IV_MS;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

function fmtDt(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '—';
  const min = ms / 60_000;
  if (min < 60) return `${min.toFixed(0)}min`;
  return `${(min / 60).toFixed(1)}h`;
}

/** Última EMA cujo openTime <= t (dados já fechados). */
function emaAt(series, t) {
  let best = null;
  for (const pt of series) {
    if (pt.openTime <= t) best = pt.ma;
    else break;
  }
  return best;
}

/** Encontra o cruzamento EMA9↑EMA21 (1h) mais próximo e anterior a entryMs. */
function findCrossBeforeEntry(candles1h, ema9Series, ema21Series, entryMs) {
  const ema9ByTime = new Map(ema9Series.map(p => [p.openTime, p.ma]));
  const ema21ByTime = new Map(ema21Series.map(p => [p.openTime, p.ma]));
  const idxByTime = new Map(candles1h.map((c, i) => [c.openTime, i]));

  let lastCross = null;
  let prevOpenTime = null;
  for (const c of candles1h) {
    if (c.openTime > entryMs + HOUR_IV_MS) break;
    const e9 = ema9ByTime.get(c.openTime);
    const e21 = ema21ByTime.get(c.openTime);
    if (e9 == null || e21 == null) { prevOpenTime = c.openTime; continue; }
    const prevE9 = prevOpenTime != null ? ema9ByTime.get(prevOpenTime) : null;
    const prevE21 = prevOpenTime != null ? ema21ByTime.get(prevOpenTime) : null;
    if (prevE9 != null && prevE21 != null && prevE9 <= prevE21 && e9 > e21) {
      lastCross = { openTime: c.openTime, index: idxByTime.get(c.openTime), ema21: e21 };
    }
    prevOpenTime = c.openTime;
  }
  return lastCross;
}

/** A partir do cruzamento, acha o primeiro candle 1h (até WAIT_CANDLES depois) cujo low toca a EMA21. */
function findEma21Pullback(candles1h, ema9Series, ema21Series, cross) {
  const ema9ByTime = new Map(ema9Series.map(p => [p.openTime, p.ma]));
  const ema21ByTime = new Map(ema21Series.map(p => [p.openTime, p.ma]));
  const cutoffMs = cross.openTime + WAIT_CANDLES * HOUR_IV_MS;

  for (let i = cross.index; i < candles1h.length; i++) {
    const c = candles1h[i];
    if (c.openTime > cutoffMs) return { found: false, reason: 'JANELA_EXPIRADA' };
    const e9 = ema9ByTime.get(c.openTime);
    const e21 = ema21ByTime.get(c.openTime);
    if (e9 == null || e21 == null) continue;
    if (i > cross.index && e9 < e21) return { found: false, reason: 'CRUZAMENTO_REVERTEU' };
    if (c.low <= e21) {
      return { found: true, openTime: c.openTime, entryPrice: e21 };
    }
  }
  return { found: false, reason: 'SEM_CANDLES' };
}

function findTpHit(fineCandles, entryPrice, entryMs) {
  const target = entryPrice * (1 + TP_PCT / 100);
  let maxHigh = entryPrice;
  for (const c of fineCandles) {
    if (c.openTime < entryMs) continue;
    maxHigh = Math.max(maxHigh, c.high);
    if (c.high >= target) {
      return { hit: true, hitMs: c.openTime, mfePct: ((maxHigh - entryPrice) / entryPrice) * 100 };
    }
  }
  return { hit: false, mfePct: ((maxHigh - entryPrice) / entryPrice) * 100 };
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exitMs = new Date(trade.exit_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const realEntryPrice = +trade.entry_price;
  const realPnlPct = trade.pnl_pct != null ? +trade.pnl_pct : null;

  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;

  const histStartMs = entryMs - 45 * HOUR_IV_MS * 24; // ~45 dias de histórico pra EMA21 estabilizar
  const candles1h = await fetcher(symbol, HOUR_IV, histStartMs, entryMs + WAIT_CANDLES * HOUR_IV_MS);
  if (candles1h.length < 30) return { symbol, exchange, error: 'candles 1h insuficientes' };

  const ema9Series = buildMaTimeSeries(candles1h, 9);
  const ema21Series = buildMaTimeSeries(candles1h, 21);
  if (!ema9Series.length || !ema21Series.length) return { symbol, exchange, error: 'EMA insuficiente' };

  const cross = findCrossBeforeEntry(candles1h, ema9Series, ema21Series, entryMs);
  if (!cross) {
    return { symbol, exchange, realEntryPrice, realPnlPct, entryMs, exitMs, noCross: true };
  }

  const pullback = findEma21Pullback(candles1h, ema9Series, ema21Series, cross);
  if (!pullback.found) {
    return {
      symbol, exchange, realEntryPrice, realPnlPct, entryMs, exitMs,
      crossOpenTime: cross.openTime, noPullback: true, reason: pullback.reason,
    };
  }

  const hypEntryMs = pullback.openTime;
  const hypEntryPrice = pullback.entryPrice;
  const scanEndMs = Math.min(hypEntryMs + TP_SCAN_CAP_MS, Date.now());
  const fine = await fetchGateOrBinanceFine(exchange, symbol, hypEntryMs, scanEndMs);
  const tp = findTpHit(fine, hypEntryPrice, hypEntryMs);

  return {
    symbol, exchange, entryMs, exitMs,
    realEntryPrice, realPnlPct,
    crossOpenTime: cross.openTime,
    hypEntryMs, hypEntryPrice,
    entryDiffPct: ((hypEntryPrice - realEntryPrice) / realEntryPrice) * 100,
    tpHit: tp.hit, tpHitMs: tp.hitMs, mfePct: tp.mfePct,
    simPct: tp.hit ? TP_PCT : null,
  };
}

async function fetchGateOrBinanceFine(exchange, symbol, startMs, endMs) {
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  return fetcher(symbol, FINE_IV, startMs - FINE_IV_MS, endMs);
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();

  console.log(`\n═══ ma-cross 1h — entrada real vs "pullback na EMA21 pós-cruzamento" + alvo fixo 5% ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&entry_time=not.is.null&exit_time=not.is.null&pnl_pct=not.is.null&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross fechado neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      const r = await analyzeTrade(t);
      results.push(r);
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const withEntry = results.filter(r => !r.error && !r.noCross && !r.noPullback);
  const noPullback = results.filter(r => r.noPullback);
  const noCross = results.filter(r => r.noCross);
  const errors = results.filter(r => r.error);

  const hitCount = withEntry.filter(r => r.tpHit).length;
  const avgEntryDiff = withEntry.length
    ? withEntry.reduce((s, r) => s + r.entryDiffPct, 0) / withEntry.length
    : null;

  // Um mesmo cruzamento pode gerar várias entradas reais (DCA parcelado) — para não
  // distorcer a média com reentradas tardias (compradas já longe do cruzamento original),
  // deduplica por (symbol, crossOpenTime) mantendo só a 1ª entrada real de cada sinal.
  const seenSignal = new Set();
  const dedup = withEntry.filter(r => {
    const key = `${r.symbol}|${r.crossOpenTime}`;
    if (seenSignal.has(key)) return false;
    seenSignal.add(key);
    return true;
  });
  const dedupHit = dedup.filter(r => r.tpHit).length;
  const dedupAvgDiff = dedup.length
    ? dedup.reduce((s, r) => s + r.entryDiffPct, 0) / dedup.length
    : null;

  console.log('\n── Resumo geral ──');
  console.log(`Trades reais no período: ${trades.length}`);
  console.log(`  Com pullback na EMA21 (entrada hipotética válida): ${withEntry.length}`);
  console.log(`  Sem pullback em até ${WAIT_CANDLES} candles (desistiu, não teria entrado): ${noPullback.length}`);
  console.log(`  Sem cruzamento localizado antes da entrada real: ${noCross.length}`);
  console.log(`  Erros / dados insuficientes: ${errors.length}`);
  if (withEntry.length) {
    console.log(`  Entrada EMA21 vs entrada real: em média ${fmtPct(avgEntryDiff)} (negativo = entraria mais barato)`);
    console.log(`  Bateram +5% a partir da entrada EMA21: ${hitCount}/${withEntry.length} (${(hitCount / withEntry.length * 100).toFixed(0)}%)`);
    console.log(`  — Deduplicado por sinal (1 entrada real por cruzamento, ignora reentradas DCA): ${dedup.length} sinais`);
    console.log(`    Entrada EMA21 vs entrada real: em média ${fmtPct(dedupAvgDiff)}`);
    console.log(`    Bateram +5%: ${dedupHit}/${dedup.length} (${(dedupHit / dedup.length * 100).toFixed(0)}%)`);
  }

  console.log('\n── Detalhe por trade ──');
  console.log('Símbolo     | Cruzamento (1h)   | Entrada real       | Entrada EMA21      | Δ entrada | Bateu 5% | Tempo até bater');
  console.log('------------|-------------------|--------------------|--------------------|-----------|----------|----------------');
  for (const r of withEntry) {
    const tempo = r.tpHit ? fmtDur(r.tpHitMs - r.hypEntryMs) : `MFE ${fmtPct(r.mfePct)}`;
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.crossOpenTime).padEnd(17)} | ${fmtDt(r.entryMs).padEnd(18)} | `
      + `${fmtDt(r.hypEntryMs).padEnd(18)} | ${fmtPct(r.entryDiffPct).padStart(9)} | ${(r.tpHit ? 'sim' : 'não').padStart(8)} | ${tempo}`,
    );
  }

  if (noPullback.length) {
    console.log('\n── Sem pullback na EMA21 (entrada hipotética não teria ocorrido) ──');
    for (const r of noPullback) {
      console.log(`  ${r.symbol.padEnd(11)} | cruzamento ${fmtDt(r.crossOpenTime)} | entrada real ${fmtDt(r.entryMs)} | motivo: ${r.reason}`);
    }
  }

  if (noCross.length) {
    console.log('\n── Sem cruzamento localizado (possível config ≠ EMA9x21 1h ou histórico insuficiente) ──');
    for (const r of noCross) {
      console.log(`  ${r.symbol.padEnd(11)} | entrada real ${fmtDt(r.entryMs)}`);
    }
  }

  for (const r of errors) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
