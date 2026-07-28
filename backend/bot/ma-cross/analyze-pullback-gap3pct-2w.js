'use strict';
/**
 * Simula a estratégia de pullback proposta para o ma-cross (entrada 1h):
 *
 *   1) Localiza o cruzamento EMA9↑EMA21 (1h) mais próximo (e anterior) à entrada
 *      real de cada trade fechado no período — é o mesmo sinal que o bot real usou.
 *   2) No candle do cruzamento, mede o "gap" entre o close e a EMA21:
 *        gapPct = (close - ema21) / ema21 * 100
 *      - |gapPct| <= GAP_PCT (padrão 3%): entrada DIRETA, no close do candle do cruzamento.
 *      - |gapPct| >  GAP_PCT: espera WAIT_CANDLES candles (padrão 5). Se a EMA9 cruzar de
 *        volta pra baixo da EMA21 antes disso, desiste (sinal invalidado). Senão, entra no
 *        valor da EMA21 daquele candle (WAIT_CANDLES depois do cruzamento), não no preço.
 *   3) Saída simulada = o que ocorrer primeiro entre:
 *        a) cruzamento EMA9↓EMA21 (1h), mesma lógica de config.exit.maCross em produção
 *           (ver detectCrossAtPair/checkMaCrossover em strategyEngine.js);
 *        b) alvo fixo de +TP_PCT% (padrão 5%), medido em candles finos (5m).
 *
 * Compara o PnL simulado com o PnL real de cada trade e reporta agregados por
 * bucket de entrada (direta vs espera).
 *
 * Uso: node backend/bot/ma-cross/analyze-pullback-gap3pct-2w.js
 *      node backend/bot/ma-cross/analyze-pullback-gap3pct-2w.js --days 14 --gap-pct 3 --wait-candles 5 --tp-pct 5
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
const FINE_IV = '5m';
const FINE_IV_MS = 300_000;
const WARMUP_PAD_MS = 45 * 86_400_000; // margem p/ achar o cruzamento e a EMA21 convergir
const TP_SCAN_CAP_MS = 14 * 86_400_000; // teto de busca de TP/cross-down após a entrada hipotética

function argNum(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? Number(v) : def;
}

const DAYS = argNum('--days', 14);
const GAP_PCT = argNum('--gap-pct', 3);
const WAIT_CANDLES = argNum('--wait-candles', 5);
const TP_PCT = argNum('--tp-pct', 5);

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
  const stepMs = interval === '1h' ? 3_600_000 : 300_000;
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const from = Math.floor(cursor / 1000);
    const to = Math.min(Math.floor(endMs / 1000), from + 1000 * (stepMs / 1000));
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      out.push({ openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2] });
    }
    const last = Number(raw[raw.length - 1][0]) * 1000;
    if (last <= cursor) break;
    cursor = last + stepMs;
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
  const h = ms / 3_600_000;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function areConsecutive1h(prev, candle) {
  return prev && candle && (Number(candle.openTime) - Number(prev.openTime) === IV_MS);
}

/** Cruzamento EMA9↑EMA21 (1h) mais próximo e anterior a entryMs (mesmo sinal do bot real). */
function findLastCrossUpBeforeEntry(candles, fastSeries, slowSeries, entryMs) {
  let last = null;
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prev = candles[i - 1];
    const closeTime = candle.openTime + IV_MS;
    if (closeTime > entryMs + IV_MS) break;
    if (!areConsecutive1h(prev, candle)) continue;

    const ma1 = maValueAt(fastSeries, candle.openTime);
    const ma2 = maValueAt(slowSeries, candle.openTime);
    const prevMa1 = maValueAt(fastSeries, prev.openTime);
    const prevMa2 = maValueAt(slowSeries, prev.openTime);
    if (detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, 'cross_up', 0)) {
      last = { index: i, openTime: candle.openTime, closeTime, ema21: ma2, close: candle.close };
    }
  }
  return last;
}

/** Primeiro cruzamento EMA9↓EMA21 (1h) após entryMs — mesma lógica de config.exit.maCross. */
function findFirstCrossDownAfter(candles, fastSeries, slowSeries, entryMs) {
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
    if (detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, 'cross_down', 0)) {
      return { closeTime, exitPrice: candle.close };
    }
  }
  return null;
}

/** Resolve a entrada hipotética (direta ou após espera) a partir do cruzamento. */
function resolveEntry(candles, fastSeries, slowSeries, cross) {
  const gapPct = ((cross.close - cross.ema21) / cross.ema21) * 100;

  if (Math.abs(gapPct) <= GAP_PCT) {
    return {
      bucket: 'direta', gapPct,
      entryMs: cross.closeTime, entryPrice: cross.close,
    };
  }

  const targetIdx = cross.index + WAIT_CANDLES;
  if (targetIdx >= candles.length) {
    return { bucket: 'sem_dados', gapPct, reason: 'candles insuficientes após o cruzamento' };
  }

  for (let i = cross.index + 1; i <= targetIdx; i++) {
    const ma1 = maValueAt(fastSeries, candles[i].openTime);
    const ma2 = maValueAt(slowSeries, candles[i].openTime);
    if (ma1 != null && ma2 != null && ma1 < ma2) {
      return { bucket: 'revertido', gapPct, reason: `EMA9 voltou abaixo da EMA21 antes de completar ${WAIT_CANDLES} candles` };
    }
  }

  const target = candles[targetIdx];
  const ema21Target = maValueAt(slowSeries, target.openTime);
  if (ema21Target == null) {
    return { bucket: 'sem_dados', gapPct, reason: 'EMA21 indisponível no candle alvo' };
  }

  return {
    bucket: 'espera', gapPct,
    entryMs: target.openTime + IV_MS, entryPrice: ema21Target,
  };
}

function findTpHit(fineCandles, entryPrice, entryMs, cutoffMs) {
  const target = entryPrice * (1 + TP_PCT / 100);
  let maxHigh = entryPrice;
  for (const c of fineCandles) {
    if (c.openTime < entryMs) continue;
    if (c.openTime > cutoffMs) break;
    maxHigh = Math.max(maxHigh, c.high);
    if (c.high >= target) return { hit: true, hitMs: c.openTime + FINE_IV_MS };
  }
  return { hit: false, mfePct: ((maxHigh - entryPrice) / entryPrice) * 100 };
}

async function analyzeTrade(trade, nowMs) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const realPnlPct = trade.pnl_pct != null ? +trade.pnl_pct : null;

  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const candles = await fetcher(symbol, IV, entryMs - WARMUP_PAD_MS, nowMs);
  if (candles.length < SLOW_PERIOD + WAIT_CANDLES + 30) {
    return { symbol, exchange, error: 'candles 1h insuficientes' };
  }

  const fastSeries = buildMaTimeSeries(candles, FAST_PERIOD);
  const slowSeries = buildMaTimeSeries(candles, SLOW_PERIOD);
  if (!fastSeries.length || !slowSeries.length) {
    return { symbol, exchange, error: 'EMA insuficiente' };
  }

  const cross = findLastCrossUpBeforeEntry(candles, fastSeries, slowSeries, entryMs);
  if (!cross) {
    return { symbol, exchange, realPnlPct, entryMs, error: null, noCross: true };
  }

  const resolved = resolveEntry(candles, fastSeries, slowSeries, cross);
  if (resolved.bucket === 'revertido' || resolved.bucket === 'sem_dados') {
    return {
      symbol, exchange, realPnlPct, entryMs,
      crossOpenTime: cross.openTime, gapPct: resolved.gapPct,
      bucket: resolved.bucket, reason: resolved.reason,
    };
  }

  const { entryMs: hypEntryMs, entryPrice: hypEntryPrice, gapPct, bucket } = resolved;

  const crossDown = findFirstCrossDownAfter(candles, fastSeries, slowSeries, hypEntryMs);
  const tpCutoffMs = Math.min(hypEntryMs + TP_SCAN_CAP_MS, crossDown?.closeTime ?? nowMs, nowMs);
  const fine = await fetcher(symbol, FINE_IV, hypEntryMs - FINE_IV_MS, tpCutoffMs);
  const tp = findTpHit(fine, hypEntryPrice, hypEntryMs, tpCutoffMs);

  let exitReason, exitMs, exitPrice, simPnlPct;
  if (tp.hit) {
    exitReason = 'tp5';
    exitMs = tp.hitMs;
    exitPrice = hypEntryPrice * (1 + TP_PCT / 100);
    simPnlPct = TP_PCT;
  } else if (crossDown) {
    exitReason = 'emaCross';
    exitMs = crossDown.closeTime;
    exitPrice = crossDown.exitPrice;
    simPnlPct = ((exitPrice - hypEntryPrice) / hypEntryPrice) * 100;
  } else {
    exitReason = 'aberto';
    exitMs = null;
    exitPrice = null;
    simPnlPct = tp.mfePct; // aproximação: MFE até agora, posição ainda não teria fechado
  }

  return {
    symbol, exchange, realPnlPct, entryMs,
    crossOpenTime: cross.openTime, gapPct, bucket,
    hypEntryMs, hypEntryPrice,
    exitReason, exitMs, simPnlPct,
    durationMs: exitMs != null ? exitMs - hypEntryMs : null,
  };
}

function summarizeBucket(label, rows) {
  if (!rows.length) return;
  const wins = rows.filter(r => r.simPnlPct > 0).length;
  const avg = rows.reduce((s, r) => s + r.simPnlPct, 0) / rows.length;
  const total = rows.reduce((s, r) => s + r.simPnlPct, 0);
  const tp5 = rows.filter(r => r.exitReason === 'tp5').length;
  const emaCross = rows.filter(r => r.exitReason === 'emaCross').length;
  const open = rows.filter(r => r.exitReason === 'aberto').length;
  console.log(
    `${label.padEnd(28)} | N=${String(rows.length).padStart(2)} | win ${((wins / rows.length) * 100).toFixed(0).padStart(3)}% | `
    + `PnL médio ${fmtPct(avg).padStart(7)} | PnL total ${fmtPct(total).padStart(8)} | saída: tp5=${tp5} emaCross=${emaCross} aberto=${open}`,
  );
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = Date.now() - DAYS * 86_400_000;
  const fromIso = new Date(fromMs).toISOString();
  const nowMs = Date.now();

  console.log(`\n═══ ma-cross 1h — pullback com gap de ${GAP_PCT}% na EMA21 (espera ${WAIT_CANDLES} candles) + saída EMA9x21 / TP ${TP_PCT}% ═══`);
  console.log(`Período dos trades reais: desde ${fmtDt(fromMs)} (${fromIso})\n`);

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
      const r = await analyzeTrade(t, nowMs);
      results.push(r);
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const errors = results.filter(r => r.error);
  const noCross = results.filter(r => r.noCross);
  const noEntry = results.filter(r => !r.error && !r.noCross && (r.bucket === 'revertido' || r.bucket === 'sem_dados'));
  const simulated = results.filter(r => !r.error && !r.noCross && (r.bucket === 'direta' || r.bucket === 'espera'));

  console.log('\n── Resumo geral ──');
  console.log(`Trades reais no período: ${trades.length}`);
  console.log(`  Entrada simulada com sucesso: ${simulated.length}`);
  console.log(`  Sinal invalidado antes de completar a espera / dados insuficientes: ${noEntry.length}`);
  console.log(`  Sem cruzamento EMA9x21 localizado antes da entrada real: ${noCross.length}`);
  console.log(`  Erros / candles insuficientes: ${errors.length}`);

  if (simulated.length) {
    const realTotal = simulated.reduce((s, r) => s + r.realPnlPct, 0);
    const simTotal = simulated.reduce((s, r) => s + r.simPnlPct, 0);
    console.log(`\nPnL REAL (soma, mesmos trades):     ${fmtPct(realTotal)}`);
    console.log(`PnL SIMULADO (pullback + regra):    ${fmtPct(simTotal)}  (Δ ${fmtPct(simTotal - realTotal)})`);

    console.log('\n── Por bucket de entrada ──');
    summarizeBucket('Direta (gap <= ' + GAP_PCT + '%)', simulated.filter(r => r.bucket === 'direta'));
    summarizeBucket(`Espera ${WAIT_CANDLES} candles (gap > ${GAP_PCT}%)`, simulated.filter(r => r.bucket === 'espera'));
  }

  console.log('\n── Detalhe por trade ──');
  console.log('Símbolo     | Cruzamento (1h)   | Bucket  | Gap EMA21 | Entrada hipotética | Saída sim           | PnL sim  | PnL real | Motivo saída');
  console.log('------------|-------------------|---------|-----------|---------------------|---------------------|----------|----------|-------------');
  for (const r of simulated) {
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.crossOpenTime).padEnd(17)} | ${r.bucket.padEnd(7)} | ${fmtPct(r.gapPct).padStart(9)} | `
      + `${fmtDt(r.hypEntryMs).padEnd(19)} | ${(r.exitMs != null ? fmtDt(r.exitMs) : 'ainda aberto').padEnd(19)} | `
      + `${fmtPct(r.simPnlPct).padStart(8)} | ${fmtPct(r.realPnlPct).padStart(8)} | ${r.exitReason}`,
    );
  }

  if (noEntry.length) {
    console.log('\n── Sinal invalidado / dados insuficientes (não teria entrado) ──');
    for (const r of noEntry) {
      console.log(`  ${r.symbol.padEnd(11)} | cruzamento ${fmtDt(r.crossOpenTime)} | gap ${fmtPct(r.gapPct)} | ${r.bucket}: ${r.reason}`);
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
