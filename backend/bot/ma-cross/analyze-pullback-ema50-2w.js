'use strict';
/**
 * Mesmos trades reais do ma-cross (entrada 1h, como está hoje), testando a regra adicional
 * de pullback mirando a EMA50(1h) — independente do filtro/pullback que já existe em
 * produção contra a EMA21 (config.entry.maxAboveMaPct / execution.pullbackEntry, v1.49.0):
 *
 *   1) Localiza o cruzamento EMA9↑EMA21 (1h) mais próximo e anterior à entrada real de cada
 *      trade — o mesmo sinal que o bot real usou (ver findLastCrossUpBeforeEntry).
 *   2) No candle do cruzamento, mede o gap entre o close e a EMA50(1h):
 *        gapPct = (close - ema50) / ema50 * 100
 *      - gapPct <= TOLERANCE_PCT (padrão 0.5%): preço já está no nível/abaixo da EMA50 →
 *        entrada DIRETA, no close do candle do cruzamento.
 *      - TOLERANCE_PCT < gapPct <= MAX_GAP_PCT (padrão 3%): pullback — espera até
 *        WAIT_CANDLES candles (padrão 5) mirando o preço aproximar da EMA50 até
 *        TOLERANCE_PCT; entra no close do primeiro candle que satisfizer. Se a EMA9 cruzar
 *        de volta pra baixo da EMA21 antes disso, desiste (sinal invalidado). Se passar os 5
 *        candles sem aproximar o suficiente, desiste também.
 *      - gapPct > MAX_GAP_PCT: cancela direto, sem esperar (gap grande demais).
 *   3) Saída simulada (só para as entradas resolvidas) = corrida entre três condições, o que
 *      disparar primeiro, andando candle a candle (5m) a partir da entrada hipotética:
 *        a) stop loss trailing — mesma fórmula de computeStopLossFloor em strategyEngine.js
 *           (maxLossPct 5%, trailStepPct 5%, igual ao trade_config real de produção);
 *        b) preço bate +5% da entrada (candles finos 5m);
 *        c) EMA9 cruza ↓ EMA21 no 1h (candle fechado) — preço de saída = close desse candle.
 *      Teto de 10 dias após a entrada evita varredura infinita (SEM_SAIDA).
 *
 * Compara o PnL simulado com o PnL real de cada trade e reporta agregados por bucket de
 * entrada (direta / espera / cancelada por gap grande / cancelada por reversão ou por não
 * aproximar a tempo).
 *
 * Uso: node backend/bot/ma-cross/analyze-pullback-ema50-2w.js
 *      node backend/bot/ma-cross/analyze-pullback-ema50-2w.js --days 14 --tolerance-pct 0.5 --max-gap-pct 3 --wait-candles 5
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
const FILTER_PERIOD = 50;
const FINE_IV = '5m';
const TP_PCT = 5;
const SCAN_CAP_MS = 10 * 86_400_000; // teto de busca de saída após a entrada hipotética
const WARMUP_PAD_MS = 55 * 86_400_000; // margem p/ achar o cruzamento e a EMA50 convergir

const INTERVAL_SEC = { '5m': 300, '1h': 3600, '4h': 14400 };

// Mesma config real de produção (rsi_multi_bot_state.trade_config.stopLoss).
const STOP_LOSS_CONFIG = { enabled: true, trailing: true, maxLossPct: 5, trailStepPct: 5 };

function argNum(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? Number(v) : def;
}

function fromMsArg() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();
  const days = argNum('--days', 14);
  return Date.now() - days * 86_400_000;
}

const TOLERANCE_PCT = argNum('--tolerance-pct', 0.5);
const MAX_GAP_PCT = argNum('--max-gap-pct', 3);
const WAIT_CANDLES = argNum('--wait-candles', 5);

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

function fmtDt(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
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
      last = { index: i, openTime: candle.openTime, closeTime, close: candle.close };
    }
  }
  return last;
}

/** Primeiro candle 1h (fechado, após entryMs) onde EMA9 cruza abaixo da EMA21. */
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

/**
 * Resolve a entrada hipotética a partir do cruzamento EMA9x21, aplicando a regra de
 * pullback mirando a EMA50: direta se já perto/abaixo, espera se moderadamente acima,
 * cancela sem esperar se longe demais.
 */
function resolveEntryEma50(candles, fastSeries, slowSeries, ema50Series, cross) {
  const ema50AtCross = maValueAt(ema50Series, cross.openTime);
  if (ema50AtCross == null) {
    return { bucket: 'sem_dados', reason: 'EMA50 indisponível no candle do cruzamento' };
  }
  const gapPct = ((cross.close - ema50AtCross) / ema50AtCross) * 100;

  if (gapPct <= TOLERANCE_PCT) {
    return {
      bucket: 'direta', gapPct, ema50AtCross,
      entryMs: cross.closeTime, entryPrice: cross.close,
    };
  }

  if (gapPct > MAX_GAP_PCT) {
    return { bucket: 'gap_grande', gapPct, ema50AtCross, reason: `gap > ${MAX_GAP_PCT}% no cruzamento, cancela sem esperar` };
  }

  const targetIdx = cross.index + WAIT_CANDLES;
  if (targetIdx >= candles.length) {
    return { bucket: 'sem_dados', gapPct, ema50AtCross, reason: 'candles insuficientes após o cruzamento' };
  }

  for (let i = cross.index + 1; i <= targetIdx; i++) {
    const ma1 = maValueAt(fastSeries, candles[i].openTime);
    const ma2 = maValueAt(slowSeries, candles[i].openTime);
    if (ma1 != null && ma2 != null && ma1 < ma2) {
      return { bucket: 'revertido', gapPct, ema50AtCross, reason: `EMA9 voltou abaixo da EMA21 antes de aproximar da EMA50 (${WAIT_CANDLES} candles)` };
    }

    const ema50i = maValueAt(ema50Series, candles[i].openTime);
    if (ema50i == null) continue;
    const gapAtI = ((candles[i].close - ema50i) / ema50i) * 100;
    if (gapAtI <= TOLERANCE_PCT) {
      return {
        bucket: 'espera', gapPct, ema50AtCross, gapAtEntryPct: gapAtI,
        entryMs: candles[i].openTime + IV_MS, entryPrice: candles[i].close,
        candlesWaited: i - cross.index,
      };
    }
  }

  return {
    bucket: 'sem_aproximacao', gapPct, ema50AtCross,
    reason: `não aproximou da EMA50 (<= ${TOLERANCE_PCT}%) em ${WAIT_CANDLES} candles`,
  };
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
  const realPnlPct = trade.pnl_pct != null ? +trade.pnl_pct : null;
  const fetcher = fetcherFor(exchange);

  const candles = await fetcher(symbol, IV, entryMs - WARMUP_PAD_MS, entryMs + SCAN_CAP_MS);
  if (candles.length < FILTER_PERIOD + WAIT_CANDLES + 30) {
    return { symbol, error: 'candles 1h insuficientes' };
  }

  const fastSeries = buildMaTimeSeries(candles, FAST_PERIOD);
  const slowSeries = buildMaTimeSeries(candles, SLOW_PERIOD);
  const ema50Series = buildMaTimeSeries(candles, FILTER_PERIOD);
  if (!fastSeries.length || !slowSeries.length || !ema50Series.length) {
    return { symbol, error: 'EMA insuficiente' };
  }

  const cross = findLastCrossUpBeforeEntry(candles, fastSeries, slowSeries, entryMs);
  if (!cross) {
    return { symbol, realPnlPct, entryMs, noCross: true };
  }

  const resolved = resolveEntryEma50(candles, fastSeries, slowSeries, ema50Series, cross);
  const base = { symbol, realPnlPct, entryMs, crossOpenTime: cross.openTime, ...resolved };

  if (resolved.bucket !== 'direta' && resolved.bucket !== 'espera') {
    return base;
  }

  const { entryMs: hypEntryMs, entryPrice: hypEntryPrice } = resolved;
  const crossDown = findFirstCrossDownAfter(candles, fastSeries, slowSeries, hypEntryMs);
  const tpCutoffMs = Math.min(hypEntryMs + SCAN_CAP_MS, crossDown?.closeTime ?? Date.now(), Date.now());
  const fine = await fetcher(symbol, FINE_IV, hypEntryMs - 300_000, tpCutoffMs);
  const slOrTp = walkForStopOrTp(fine, hypEntryMs, hypEntryPrice, crossDown?.closeTime ?? null);

  let exitType, exitMs, simPnlPct;
  if (slOrTp) {
    exitType = slOrTp.type;
    exitMs = slOrTp.confirmMs;
    simPnlPct = ((slOrTp.price - hypEntryPrice) / hypEntryPrice) * 100;
  } else if (crossDown) {
    exitType = 'MA_DOWN';
    exitMs = crossDown.closeTime;
    simPnlPct = ((crossDown.exitPrice - hypEntryPrice) / hypEntryPrice) * 100;
  } else {
    exitType = 'SEM_SAIDA';
    exitMs = null;
    simPnlPct = null;
  }

  return { ...base, hypEntryMs, hypEntryPrice, exitType, exitMs, simPnlPct };
}

function summarizeBucket(label, rows) {
  const withExit = rows.filter(r => r.simPnlPct != null);
  if (!withExit.length) {
    console.log(`${label.padEnd(30)} | N=${String(rows.length).padStart(2)} | sem trades com saída simulada`);
    return;
  }
  const wins = withExit.filter(r => r.simPnlPct > 0).length;
  const avg = withExit.reduce((s, r) => s + r.simPnlPct, 0) / withExit.length;
  const total = withExit.reduce((s, r) => s + r.simPnlPct, 0);
  const tp5 = withExit.filter(r => r.exitType === 'TP5').length;
  const maDown = withExit.filter(r => r.exitType === 'MA_DOWN').length;
  const sl = withExit.filter(r => r.exitType === 'STOP_LOSS').length;
  console.log(
    `${label.padEnd(30)} | N=${String(withExit.length).padStart(2)} | win ${((wins / withExit.length) * 100).toFixed(0).padStart(3)}% | `
    + `PnL médio ${fmtPct(avg).padStart(7)} | PnL total ${fmtPct(total).padStart(8)} | saída: TP5=${tp5} MA_DOWN=${maDown} STOP_LOSS=${sl}`,
  );
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();

  console.log(`\n═══ ma-cross 1h — pullback mirando EMA50 (tolerância ${TOLERANCE_PCT}%, teto de gap ${MAX_GAP_PCT}%, espera ${WAIT_CANDLES} candles) + saída stop 5% trailing / EMA9x21 cruza↓ / +5% ═══`);
  console.log(`Período dos trades reais: desde ${fmtDt(fromMs)} (${fromIso})`);
  console.log(`Regra: gap<=${TOLERANCE_PCT}% entra direto | ${TOLERANCE_PCT}%<gap<=${MAX_GAP_PCT}% espera ${WAIT_CANDLES} candles mirando aproximar até ${TOLERANCE_PCT}% | gap>${MAX_GAP_PCT}% cancela sem esperar\n`);

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
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ` ok (${r.bucket ?? 'noCross'})\n`);
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const errors = results.filter(r => r.error);
  const noCross = results.filter(r => r.noCross);
  const direta = results.filter(r => r.bucket === 'direta');
  const espera = results.filter(r => r.bucket === 'espera');
  const gapGrande = results.filter(r => r.bucket === 'gap_grande');
  const revertido = results.filter(r => r.bucket === 'revertido');
  const semAproximacao = results.filter(r => r.bucket === 'sem_aproximacao');
  const semDados = results.filter(r => r.bucket === 'sem_dados');
  const entrariam = [...direta, ...espera];
  const naoEntrariam = [...gapGrande, ...revertido, ...semAproximacao];

  console.log('\n── Resumo geral ──');
  console.log(`Trades reais no período: ${trades.length}`);
  console.log(`  Entrariam (direta + espera resolvida): ${entrariam.length}`);
  console.log(`    Direta (gap <= ${TOLERANCE_PCT}%): ${direta.length}`);
  console.log(`    Espera (aproximou dentro de ${WAIT_CANDLES} candles): ${espera.length}`);
  console.log(`  Não entrariam:`);
  console.log(`    Gap > ${MAX_GAP_PCT}% no cruzamento (cancela sem esperar): ${gapGrande.length}`);
  console.log(`    EMA9 reverteu abaixo da EMA21 durante a espera: ${revertido.length}`);
  console.log(`    Não aproximou da EMA50 em ${WAIT_CANDLES} candles: ${semAproximacao.length}`);
  console.log(`  Sem cruzamento localizado / dados insuficientes: ${noCross.length + semDados.length}`);
  console.log(`  Erros: ${errors.length}`);

  const realTotalAll = results.filter(r => r.realPnlPct != null).reduce((s, r) => s + r.realPnlPct, 0);
  const realTotalNaoEntrariam = naoEntrariam.reduce((s, r) => s + (r.realPnlPct ?? 0), 0);
  const realTotalEntrariam = entrariam.reduce((s, r) => s + (r.realPnlPct ?? 0), 0);
  const simTotal = entrariam.filter(r => r.simPnlPct != null).reduce((s, r) => s + r.simPnlPct, 0);

  console.log(`\nPnL REAL — todos os trades do período:            ${fmtPct(realTotalAll)}`);
  console.log(`PnL REAL — apenas os que a regra bloquearia:      ${fmtPct(realTotalNaoEntrariam)}  (deixaria de ganhar/perder isso)`);
  console.log(`PnL REAL — apenas os que a regra permitiria:      ${fmtPct(realTotalEntrariam)}`);
  console.log(`PnL SIMULADO — permitidos, c/ saída (stop/EMA↓/TP5): ${fmtPct(simTotal)}`);
  console.log(`  → PnL total do sistema com a regra (bloqueados = 0): ${fmtPct(simTotal)}  (Δ vs real total: ${fmtPct(simTotal - realTotalAll)})`);

  console.log('\n── Por bucket de entrada ──');
  summarizeBucket(`Direta (gap <= ${TOLERANCE_PCT}%)`, direta);
  summarizeBucket(`Espera (aproximou em ${WAIT_CANDLES} candles)`, espera);

  console.log('\n── Detalhe — entradas permitidas ──');
  console.log('Símbolo     | Cruzamento (1h)   | Bucket  | Gap cruz. | Entrada hipotética | Saída sim | PnL sim  | PnL real');
  console.log('------------|-------------------|---------|-----------|---------------------|-----------|----------|----------');
  for (const r of entrariam) {
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.crossOpenTime).padEnd(17)} | ${r.bucket.padEnd(7)} | ${fmtPct(r.gapPct).padStart(9)} | `
      + `${fmtDt(r.hypEntryMs).padEnd(19)} | ${(r.exitType ?? '—').padEnd(9)} | ${fmtPct(r.simPnlPct).padStart(8)} | ${fmtPct(r.realPnlPct).padStart(8)}`,
    );
  }

  if (naoEntrariam.length) {
    console.log('\n── Detalhe — bloqueados pela regra ──');
    console.log('Símbolo     | Cruzamento (1h)   | Motivo            | Gap cruz. | PnL real (referência)');
    console.log('------------|-------------------|-------------------|-----------|----------------------');
    for (const r of naoEntrariam) {
      console.log(`${r.symbol.padEnd(11)} | ${fmtDt(r.crossOpenTime).padEnd(17)} | ${r.bucket.padEnd(17)} | ${fmtPct(r.gapPct).padStart(9)} | ${fmtPct(r.realPnlPct).padStart(8)}`);
    }
  }

  if (noCross.length) {
    console.log('\n── Sem cruzamento EMA9x21 localizado antes da entrada real ──');
    for (const r of noCross) console.log(`  ${r.symbol.padEnd(11)} | entrada real ${fmtDt(r.entryMs)}`);
  }

  for (const r of errors) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
