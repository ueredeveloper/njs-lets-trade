'use strict';

/**
 * Backtest MA50 — análise histórica com a estratégia trading-rsi-35-70-ma-50-1h
 *
 * RSI(14,1m) < 30 + preço > MA50(1h) → aguarda -0,1% (max 30min) → compra
 * Saída: RSI(14,1m) > 70  |  Sem stop loss
 *
 * Uso:
 *   node backend/bot/backtest-ma50.js LINKUSDT
 *   node backend/bot/backtest-ma50.js LINKUSDT binance 40 7      ← dias (default 7)
 *   node backend/bot/backtest-ma50.js LINKUSDT binance 40 3000c  ← candles 1m
 *
 * Atenção: 1 dia = 1440 candles 1m. 7 dias ≈ 10 requests à API.
 */

const path = require('path');
const ti   = require('technicalindicators');
const { calculateMa } = require('../../utils/movingAverage');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { toGateSymbol } = require('../utils/toGateSymbol');

const SYMBOL   = (process.argv[2] || 'LINKUSDT').toUpperCase();
const EXCHANGE = (process.argv[3] || 'binance').toLowerCase();
const CAPITAL  = parseFloat(process.argv[4] || '40');

// 5º arg: dias (ex: 7) ou candles 1m com sufixo "c" (ex: 3000c)
const _arg5    = process.argv[5] || '7';
const _isCan   = _arg5.endsWith('c');
const DAYS     = _isCan ? null : parseInt(_arg5);
const CANDLES  = _isCan ? parseInt(_arg5) : null;

const MA_PERIOD        = 50;
const RSI_PERIOD       = 14;
const RSI_BUY          = 30;
const RSI_SELL         = 70;
const ENTRY_DISCOUNT   = 0.001;   // 0,1%
const PENDING_CANCEL   = 0.002;   // cancela se preço subir 0,2% acima do gatilho
const PENDING_MAX_MIN  = 30;      // máximo de candles 1m em PENDING (30 min)
const HOUR_MS          = 3_600_000;

const BINANCE_BASE = 'https://api.binance.com';
const GATE_BASE    = 'https://api.gateio.ws/api/v4';

// ── Fetch candles ─────────────────────────────────────────────────────────────
async function fetchBatch1m(endTimeMs) {
  if (EXCHANGE === 'gate') {
    const pair  = toGateSymbol(SYMBOL);
    const toSec = Math.floor(endTimeMs / 1000);
    const url   = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=1m&limit=1000&to=${toSec}`;
    const raw   = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Gate.io 1m: ${JSON.stringify(raw)}`);
    return raw.map(c => ({ openTime: Number(c[0]) * 1000, close: parseFloat(c[2]) }));
  } else {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1000&endTime=${endTimeMs}`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Binance 1m: ${JSON.stringify(raw)}`);
    return raw.map(c => ({ openTime: Number(c[0]), close: parseFloat(c[4]) }));
  }
}

async function fetchBatch1h(endTimeMs) {
  if (EXCHANGE === 'gate') {
    const pair  = toGateSymbol(SYMBOL);
    const toSec = Math.floor(endTimeMs / 1000);
    const url   = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=1h&limit=200&to=${toSec}`;
    const raw   = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Gate.io 1h: ${JSON.stringify(raw)}`);
    return raw.map(c => ({ openTime: Number(c[0]) * 1000, close: parseFloat(c[2]) }));
  } else {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=1h&limit=200&endTime=${endTimeMs}`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Binance 1h: ${JSON.stringify(raw)}`);
    return raw.map(c => ({ openTime: Number(c[0]), close: parseFloat(c[4]) }));
  }
}

async function fetchCandles() {
  const needed1m = CANDLES ? CANDLES + RSI_PERIOD + 5 : DAYS * 1440 + RSI_PERIOD + 5;
  const needed1h = Math.ceil(needed1m / 60) + MA_PERIOD + 5;

  let all1m   = [];
  let endTime = Date.now();

  process.stdout.write(`⏳ Buscando candles 1m de ${SYMBOL} (${EXCHANGE})…`);
  while (all1m.length < needed1m) {
    const batch = await fetchBatch1m(endTime);
    if (!batch.length) break;
    all1m   = [...batch, ...all1m];
    endTime = batch[0].openTime - 1;
    process.stdout.write('.');
    if (batch.length < 1000) break;
    if (all1m.length >= needed1m) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // 1h candles: um único batch cobre MA_PERIOD + o período necessário
  const end1h   = Date.now();
  const start1h = end1h - needed1h * HOUR_MS;
  process.stdout.write('\n⏳ Buscando candles 1h…');
  let all1h = [];
  let et1h  = end1h;
  while (all1h.length < needed1h) {
    const batch = await fetchBatch1h(et1h);
    if (!batch.length) break;
    all1h = [...batch, ...all1h];
    et1h  = batch[0].openTime - 1;
    process.stdout.write('.');
    if (batch.length < 200) break;
    if (all1h.length >= needed1h) break;
    await new Promise(r => setTimeout(r, 150));
  }
  process.stdout.write('\n');

  const dedup = (arr) => {
    const seen = new Set();
    return arr
      .filter(c => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; })
      .sort((a, b) => a.openTime - b.openTime);
  };

  return { candles1m: dedup(all1m).slice(-needed1m), candles1h: dedup(all1h).slice(-needed1h) };
}

// ── Pré-calcula MA50(1h) indexado por openTime da hora ───────────────────────
function buildMa50Map(candles1h) {
  const closes = candles1h.map(c => c.close);
  const maArr  = calculateMa(closes, MA_PERIOD);
  const offset = closes.length - maArr.length; // maArr[0] = MA50 at closes[offset]
  const map    = new Map();
  for (let i = 0; i < maArr.length; i++) {
    map.set(candles1h[i + offset].openTime, maArr[i]);
  }
  return map;
}

// Para um candle 1m no tempo T, retorna a MA50(1h) vigente naquele instante.
// A MA50(1h) de uma hora H é conhecida APÓS o fechamento daquele candle horário.
// Portanto, para 1m às 14:37, usamos a MA50(1h) cujo openTime = 14:00 (a hora corrente).
// Mas: esse candle horário ainda não fechou! Usamos a hora anterior (13:00).
function getMa50At(ma50Map, openTimeMs) {
  const currentHour = Math.floor(openTimeMs / HOUR_MS) * HOUR_MS;
  const prevHour    = currentHour - HOUR_MS; // hora já fechada
  return ma50Map.get(prevHour) ?? ma50Map.get(currentHour) ?? null;
}

// ── Simulação ─────────────────────────────────────────────────────────────────
function simulate(candles1m, ma50Map) {
  const closes = candles1m.map(c => c.close);
  const rsiAll = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  const rsiOff = closes.length - rsiAll.length;

  const trades    = [];
  const blocked   = []; // RSI<30 mas abaixo da MA50(1h)
  const cancelled = []; // PENDING cancelado (não atingiu -0,1%)
  let capital     = CAPITAL;
  let phase       = 'WATCHING';
  let position    = null;
  let entry       = null;

  for (let i = rsiOff; i < candles1m.length; i++) {
    const rsi    = rsiAll[i - rsiOff];
    const close  = closes[i];
    const ma50   = getMa50At(ma50Map, candles1m[i].openTime);
    if (rsi == null) continue;

    const bullish = ma50 != null ? close > ma50 : true; // sem MA50 disponível = não filtra

    if (phase === 'WATCHING') {
      if (rsi < RSI_BUY) {
        if (!bullish) {
          blocked.push({ time: candles1m[i].openTime, rsi, close, ma50 });
        } else {
          const limitPrice = close * (1 - ENTRY_DISCOUNT);
          position = { triggerIdx: i, triggerPrice: close, limitPrice, triggerRsi: rsi };
          phase    = 'PENDING';
        }
      }

    } else if (phase === 'PENDING') {
      const elapsed   = i - position.triggerIdx;
      const priceRec  = close > position.triggerPrice * (1 + PENDING_CANCEL);
      const timedOut  = elapsed > PENDING_MAX_MIN;
      const targetHit = close <= position.limitPrice;

      if (targetHit) {
        const buyPrice = close;
        entry = {
          buyIdx: i, buyPrice, buyQty: capital / buyPrice,
          buyUsdt: capital, triggerPrice: position.triggerPrice,
          triggerRsi: position.triggerRsi, limitPrice: position.limitPrice,
          pendingMin: elapsed, rsiEntry: rsi, ma50Entry: ma50,
        };
        position = null;
        phase    = 'BOUGHT';
      } else if (priceRec || timedOut) {
        cancelled.push({
          time: candles1m[position.triggerIdx].openTime,
          triggerPrice: position.triggerPrice,
          limitPrice: position.limitPrice,
          triggerRsi: position.triggerRsi,
          pendingMin: elapsed,
          reason: priceRec ? 'preço recuperou' : `timeout ${PENDING_MAX_MIN}min`,
        });
        position = null;
        phase    = 'WATCHING';
      }

    } else if (phase === 'BOUGHT') {
      if (rsi > RSI_SELL) {
        const usdtOut = entry.buyQty * close;
        const pnlUsdt = usdtOut - entry.buyUsdt;
        const pnlPct  = (pnlUsdt / entry.buyUsdt) * 100;
        capital      += pnlUsdt;

        trades.push({
          n:            trades.length + 1,
          triggerTime:  candles1m[entry.buyIdx - entry.pendingMin].openTime,
          entryTime:    candles1m[entry.buyIdx].openTime,
          exitTime:     candles1m[i].openTime,
          triggerPrice: entry.triggerPrice,
          triggerRsi:   entry.triggerRsi,
          entryPrice:   entry.buyPrice,
          exitPrice:    close,
          pnlUsdt, pnlPct, capital,
          rsiEntry: entry.rsiEntry,
          rsiExit:  rsi,
          ma50:     entry.ma50Entry,
          durationMs:  candles1m[i].openTime - candles1m[entry.buyIdx].openTime,
          pendingMin:  entry.pendingMin,
          open:        false,
        });

        entry = null;
        phase = 'WATCHING';
      }
    }
  }

  // Posição aberta no final do período
  if (phase === 'BOUGHT' && entry) {
    const lastClose = closes[closes.length - 1];
    const usdtOut   = entry.buyQty * lastClose;
    const pnlUsdt   = usdtOut - entry.buyUsdt;
    const pnlPct    = (pnlUsdt / entry.buyUsdt) * 100;
    trades.push({
      n:            trades.length + 1,
      triggerTime:  candles1m[entry.buyIdx - entry.pendingMin].openTime,
      entryTime:    candles1m[entry.buyIdx].openTime,
      exitTime:     null,
      triggerPrice: entry.triggerPrice,
      triggerRsi:   entry.triggerRsi,
      entryPrice:   entry.buyPrice,
      exitPrice:    lastClose,
      pnlUsdt, pnlPct, capital: capital + pnlUsdt,
      rsiEntry: entry.rsiEntry, rsiExit: null,
      ma50: entry.ma50Entry,
      durationMs: candles1m[candles1m.length - 1].openTime - candles1m[entry.buyIdx].openTime,
      pendingMin: entry.pendingMin,
      open: true,
    });
  }

  return { trades, blocked, cancelled, finalCapital: capital };
}

// ── Formatação ────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';

function fmtDate(ms) {
  if (!ms) return '(aberta)          ';
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDur(ms) {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}min` : m < 1440 ? `${Math.floor(m / 60)}h${m % 60}min` : `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`;
}

function pad(str, n) { return String(str).padEnd(n); }
function rpad(str, n) { return String(str).padStart(n); }

function fmtP(n) {
  if (n == null) return '—';
  return n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { candles1m, candles1h } = await fetchCandles();

  if (candles1m.length < RSI_PERIOD + 10) {
    console.error('❌ Candles 1m insuficientes.');
    process.exit(1);
  }
  if (candles1h.length < MA_PERIOD + 2) {
    console.error('❌ Candles 1h insuficientes para MA50.');
    process.exit(1);
  }

  const ma50Map = buildMa50Map(candles1h);
  const { trades, blocked, cancelled, finalCapital } = simulate(candles1m, ma50Map);

  const exLabel    = EXCHANGE === 'gate' ? 'Gate.io' : 'Binance';
  const from       = fmtDate(candles1m[RSI_PERIOD].openTime);
  const to         = fmtDate(candles1m[candles1m.length - 1].openTime);
  const periodDesc = CANDLES ? `${candles1m.length} candles 1m` : `${DAYS} dias`;
  const totalSinal = trades.length + blocked.length + cancelled.length;
  const DIV        = '─'.repeat(120);

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  console.log(`\n📊 Backtest MA50: ${SYMBOL}  |  ${exLabel}  |  ${periodDesc}`);
  console.log(`   Estratégia : RSI(${RSI_PERIOD},1m) < ${RSI_BUY} + preço > MA${MA_PERIOD}(1h) → alvo -${ENTRY_DISCOUNT * 100}% (máx ${PENDING_MAX_MIN}min) | saída RSI(1m) > ${RSI_SELL}`);
  console.log(`   Capital    : $${CAPITAL.toFixed(2)}   Período: ${from} → ${to}`);
  console.log(`   Sinais RSI(1m)<${RSI_BUY}: ${totalSinal} total — ${trades.length} executados | ${blocked.length} bloqueados MA50 | ${cancelled.length} não atingiram alvo`);

  // ── Tabela de trades ────────────────────────────────────────────────────────
  if (!trades.length) {
    console.log(`\n   ${Y}Nenhuma entrada executada neste período.${X}`);
  } else {
    console.log(`\n${DIV}`);
    console.log(
      `  ${rpad('#', 2)}` +
      `  ${pad('── Sinal RSI<30 ──', 18)}` +
      `  ${pad('RSI', 5)}` +
      `  ${pad('Esp.', 5)}` +
      `  ${pad('── Compra ────────', 17)}` +
      `  ${pad('P.entrada', 10)}` +
      `  ${pad('── Saída ─────────', 17)}` +
      `  ${pad('P.saída', 10)}` +
      `  ${pad('PnL%', 7)}` +
      `  ${pad('PnL $', 8)}` +
      `  ${pad('Capital', 8)}` +
      `  ${pad('Duração', 8)}` +
      `  MA50`,
    );
    console.log(DIV);

    for (const t of trades) {
      const pnlPos  = t.pnlUsdt >= 0;
      const color   = t.open ? Y : pnlPos ? G : R;
      const sign    = pnlPos ? '+' : '';
      const espera  = t.pendingMin > 0 ? `+${t.pendingMin}m` : 'immed.';
      const motivo  = t.open
        ? `${Y}🔓 ABERTA${X}`
        : pnlPos ? `${G}✅ RSI>${RSI_SELL}${X}` : `${R}❌ RSI>${RSI_SELL}${X}`;

      console.log(
        `  ${rpad(t.n, 2)}` +
        `  ${pad(fmtDate(t.triggerTime), 18)}` +
        `  ${pad(t.triggerRsi.toFixed(1), 5)}` +
        `  ${pad(espera, 5)}` +
        `  ${pad(fmtDate(t.entryTime), 17)}` +
        `  ${pad('$' + fmtP(t.entryPrice), 10)}` +
        `  ${pad(fmtDate(t.exitTime), 17)}` +
        `  ${pad('$' + fmtP(t.exitPrice), 10)}` +
        `  ${color}${pad(sign + t.pnlPct.toFixed(1) + '%', 7)}${X}` +
        `  ${color}${pad(sign + '$' + Math.abs(t.pnlUsdt).toFixed(2), 8)}${X}` +
        `  ${pad('$' + t.capital.toFixed(2), 8)}` +
        `  ${pad(fmtDur(t.durationMs), 8)}` +
        `  $${fmtP(t.ma50)}  ${motivo}` +
        `  RSI ${t.rsiEntry.toFixed(1)}→${t.rsiExit != null ? t.rsiExit.toFixed(1) : '?'}`,
      );
    }

    console.log(DIV);
  }

  // ── Resumo ─────────────────────────────────────────────────────────────────
  {
    const closed   = trades.filter(t => !t.open);
    const wins     = closed.filter(t => t.pnlUsdt >= 0);
    const losses   = closed.filter(t => t.pnlUsdt < 0);
    const totalPnl = closed.reduce((s, t) => s + t.pnlUsdt, 0);
    const pnlPct   = (totalPnl / CAPITAL) * 100;
    const avgDur   = closed.length
      ? fmtDur(closed.reduce((s, t) => s + t.durationMs, 0) / closed.length)
      : '—';
    const winRate  = closed.length ? (wins.length / closed.length * 100).toFixed(0) : '—';
    const pnlSign  = totalPnl >= 0 ? '+' : '';
    const pnlColor = totalPnl >= 0 ? G : R;

    console.log('\n  Resumo');
    console.log(`  ${'─'.repeat(45)}`);
    console.log(`  Trades fechados : ${closed.length}  (${G}✅ ${wins.length} ganhos${X}  ${R}❌ ${losses.length} perdas${X})`);
    if (trades.some(t => t.open)) console.log(`  Posição aberta  : ${Y}1 ainda em curso${X}`);
    console.log(`  Win rate        : ${winRate}%`);
    console.log(`  PnL total       : ${pnlColor}${pnlSign}$${totalPnl.toFixed(2)}  (${pnlSign}${pnlPct.toFixed(1)}%)${X}`);
    console.log(`  Capital         : $${CAPITAL.toFixed(2)} → $${finalCapital.toFixed(2)}`);
    console.log(`  Duração média   : ${avgDur}`);
  }

  // ── Sinais bloqueados pela MA50(1h) ────────────────────────────────────────
  if (blocked.length) {
    console.log(`\n  Sinais RSI(1m)<${RSI_BUY} bloqueados pela MA50(1h) — preço abaixo da média`);
    const DIV2 = '─'.repeat(72);
    console.log(`  ${DIV2}`);
    console.log(`  ${pad('Sinal', 18)}  ${pad('RSI(1m)', 8)}  ${pad('Preço', 10)}  ${pad('MA50(1h)', 10)}  Dist%`);
    console.log(`  ${DIV2}`);
    for (const b of blocked) {
      const dist = b.ma50 != null ? ((b.close - b.ma50) / b.ma50 * 100).toFixed(1) : '—';
      console.log(
        `  ${pad(fmtDate(b.time), 18)}` +
        `  ${pad(b.rsi.toFixed(1), 8)}` +
        `  ${pad('$' + fmtP(b.close), 10)}` +
        `  ${pad(b.ma50 != null ? '$' + fmtP(b.ma50) : '—', 10)}` +
        `  ${R}${dist}%${X}`,
      );
    }
    console.log(`  ${DIV2}`);
    console.log(`  Total bloqueados: ${blocked.length} — MA50(1h) protegeu de entradas em tendência baixa`);
  }

  // ── Sinais que não atingiram o alvo -0,1% (PENDING cancelado) ──────────────
  if (cancelled.length) {
    console.log(`\n  Sinais RSI(1m)<${RSI_BUY} que NÃO atingiram o alvo -${ENTRY_DISCOUNT * 100}%`);
    const DIV2 = '─'.repeat(82);
    console.log(`  ${DIV2}`);
    console.log(`  ${pad('Sinal', 18)}  ${pad('RSI', 6)}  ${pad('Gatilho', 10)}  ${pad('Alvo (-0,1%)', 12)}  ${pad('Esperou', 8)}  Cancelado`);
    console.log(`  ${DIV2}`);
    for (const c of cancelled) {
      console.log(
        `  ${pad(fmtDate(c.time), 18)}` +
        `  ${pad(c.triggerRsi.toFixed(1), 6)}` +
        `  ${pad('$' + fmtP(c.triggerPrice), 10)}` +
        `  ${pad('$' + fmtP(c.limitPrice), 12)}` +
        `  ${pad(c.pendingMin + 'min', 8)}` +
        `  ${Y}${c.reason}${X}`,
      );
    }
    console.log(`  ${DIV2}`);
    const missedPct = (cancelled.length / (trades.length + cancelled.length + blocked.length) * 100).toFixed(0);
    console.log(`  ${cancelled.length} sinais não aproveitados (${missedPct}% do total)`);
  }

  console.log();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
