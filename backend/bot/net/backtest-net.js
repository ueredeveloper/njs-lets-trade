'use strict';

/**
 * Backtest NET — análise histórica de uma moeda com a estratégia Name Every Trading
 *
 * RSI(14,1h) < 30 → aguarda queda de 3% (PENDING, até 24 candles)
 * Stop loss 3% abaixo do preço de entrada
 * Saída RSI(14,1h) > 70
 * Sem filtro EMA200
 *
 * Uso:
 *   node backend/bot/backtest-net.js LINKUSDT
 *   node backend/bot/backtest-net.js LINKUSDT gate
 *   node backend/bot/backtest-net.js LINKUSDT binance 40 180     ← dias
 *   node backend/bot/backtest-net.js LINKUSDT binance 40 1800c   ← candles (sufixo "c")
 *                                     symbol   exchange capital   periodo
 */

const path = require('path');
const ti   = require('technicalindicators');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { toGateSymbol } = require('../utils/toGateSymbol');

const SYMBOL   = (process.argv[2] || 'LINKUSDT').toUpperCase();
const EXCHANGE = (process.argv[3] || 'binance').toLowerCase();
const CAPITAL  = parseFloat(process.argv[4] || '40');

// 5º arg: número de dias (ex: 90) ou candles com sufixo "c" (ex: 1800c)
const _arg5    = process.argv[5] || '90';
const _candles = _arg5.endsWith('c');
const DAYS     = _candles ? null : parseInt(_arg5);
const CANDLES  = _candles ? parseInt(_arg5) : null;

const RSI_PERIOD       = 14;
const RSI_BUY          = 30;
const RSI_SELL         = 70;
const ENTRY_DISCOUNT   = 0.01;
const STOP_LOSS_PCT    = 0.03;
const PENDING_CANCEL   = 0.005; // cancela se preço subir 0.5% acima do gatilho
const PENDING_MAX_H    = 24;    // máximo de candles em PENDING (1h cada = 24h)

const BINANCE_BASE = 'https://api.binance.com';
const GATE_BASE    = 'https://api.gateio.ws/api/v4';

// ── Fetch candles ─────────────────────────────────────────────────────────────
async function fetchBatch(endTimeMs) {
  if (EXCHANGE === 'gate') {
    const pair    = toGateSymbol(SYMBOL);
    const toSec   = Math.floor(endTimeMs / 1000);
    const fromSec = toSec - 1000 * 3600;
    const url     = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=1h&limit=1000&from=${fromSec}&to=${toSec}`;
    const raw     = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Gate.io: ${JSON.stringify(raw)}`);
    return raw.map(c => ({ openTime: Number(c[0]) * 1000, close: parseFloat(c[2]) }));
  } else {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=1h&limit=1000&endTime=${endTimeMs}`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Binance: ${JSON.stringify(raw)}`);
    return raw.map(c => ({ openTime: Number(c[0]), close: parseFloat(c[4]) }));
  }
}

async function fetchCandles() {
  const needed = CANDLES ? CANDLES + RSI_PERIOD + 50 : DAYS * 24 + RSI_PERIOD + 50;
  let all      = [];
  let endTime  = Date.now();

  process.stdout.write(`⏳ Buscando candles 1h de ${SYMBOL} (${EXCHANGE})…`);

  while (all.length < needed) {
    const batch = await fetchBatch(endTime);
    if (!batch.length) break;
    all     = [...batch, ...all];
    endTime = batch[0].openTime - 1;
    process.stdout.write('.');
    if (batch.length < 1000) break;
    if (all.length >= needed) break;
    await new Promise(r => setTimeout(r, 150));
  }

  process.stdout.write('\n');

  const seen = new Set();
  return all
    .filter(c => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; })
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-needed);
}

// ── Simulação ─────────────────────────────────────────────────────────────────
function simulate(candles) {
  const closes = candles.map(c => c.close);
  const rsiAll = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  const rsiOff = closes.length - rsiAll.length; // rsiAll[i] = RSI at closes[i + rsiOff]

  const trades       = [];
  const cancelled    = []; // entradas que não atingiram o alvo ou foram canceladas
  let capital        = CAPITAL;
  let phase          = 'WATCHING';
  let position       = null;  // PENDING info
  let entry          = null;  // BOUGHT info

  for (let i = rsiOff; i < candles.length; i++) {
    const rsi   = rsiAll[i - rsiOff];
    const close = closes[i];
    if (rsi == null) continue;

    if (phase === 'WATCHING') {
      if (rsi < RSI_BUY) {
        const limitPrice = close * (1 - ENTRY_DISCOUNT);
        position = { triggerIdx: i, triggerPrice: close, limitPrice, triggerRsi: rsi };
        phase    = 'PENDING';
      }

    } else if (phase === 'PENDING') {
      const elapsed    = i - position.triggerIdx;
      const priceRec   = close > position.triggerPrice * (1 + PENDING_CANCEL);
      const timedOut   = elapsed > PENDING_MAX_H;
      const targetHit  = close <= position.limitPrice;

      if (targetHit) {
        const buyPrice = close; // mercado ≈ limitPrice
        const stopLoss = buyPrice * (1 - STOP_LOSS_PCT);
        entry = {
          buyIdx: i, buyPrice, buyQty: capital / buyPrice,
          buyUsdt: capital, stopLoss,
          rsiEntry: rsi,
          pendingCandles: elapsed,
          triggerPrice: position.triggerPrice,
          triggerRsi: position.triggerRsi,
          limitPrice: position.limitPrice,
        };
        position = null;
        phase    = 'BOUGHT';
      } else if (priceRec || timedOut) {
        const reason = priceRec ? 'preço recuperou' : `timeout ${PENDING_MAX_H}h`;
        cancelled.push({
          time: candles[position.triggerIdx].openTime,
          triggerPrice: position.triggerPrice,
          limitPrice: position.limitPrice,
          triggerRsi: position.triggerRsi,
          pendingCandles: elapsed,
          reason,
        });
        position = null;
        phase    = 'WATCHING';
      }

    } else if (phase === 'BOUGHT') {
      let exitReason = null;
      if (close <= entry.stopLoss) {
        exitReason = 'STOP_LOSS';
      } else if (rsi > RSI_SELL) {
        exitReason = 'RSI_SELL';
      }

      if (exitReason) {
        const exitPrice = exitReason === 'STOP_LOSS' ? entry.stopLoss : close;
        const usdtOut   = entry.buyQty * exitPrice;
        const pnlUsdt   = usdtOut - entry.buyUsdt;
        const pnlPct    = (pnlUsdt / entry.buyUsdt) * 100;
        capital        += pnlUsdt;

        trades.push({
          n:              trades.length + 1,
          entryTime:      candles[entry.buyIdx].openTime,
          exitTime:       candles[i].openTime,
          triggerTime:    candles[entry.buyIdx - entry.pendingCandles].openTime,
          triggerPrice:   entry.triggerPrice,
          triggerRsi:     entry.triggerRsi,
          entryPrice:     entry.buyPrice,
          exitPrice,
          pnlUsdt,
          pnlPct,
          capital,
          rsiEntry:       entry.rsiEntry,
          rsiExit:        rsi,
          exitReason,
          durationMs:     candles[i].openTime - candles[entry.buyIdx].openTime,
          pendingCandles: entry.pendingCandles,
          open:           false,
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
      n:           trades.length + 1,
      entryTime:   candles[entry.buyIdx].openTime,
      exitTime:    null,
      triggerTime:  candles[entry.buyIdx - entry.pendingCandles].openTime,
      triggerPrice: entry.triggerPrice,
      triggerRsi:   entry.triggerRsi,
      entryPrice:   entry.buyPrice,
      exitPrice:   lastClose,
      pnlUsdt, pnlPct,
      capital:     capital + pnlUsdt,
      rsiEntry:    entry.rsiEntry,
      rsiExit:     null,
      exitReason:  'ABERTA',
      durationMs:  candles[candles.length - 1].openTime - candles[entry.buyIdx].openTime,
      pendingCandles: entry.pendingCandles,
      open:        true,
    });
  }

  // PENDING no final do período (não chegou ao alvo)
  if (phase === 'PENDING' && position) {
    cancelled.push({
      time: candles[position.triggerIdx].openTime,
      triggerPrice: position.triggerPrice,
      limitPrice: position.limitPrice,
      triggerRsi: position.triggerRsi,
      pendingCandles: candles.length - 1 - position.triggerIdx,
      reason: 'fim do período',
    });
  }

  return { trades, cancelled, finalCapital: capital };
}

// ── Helpers de formatação ─────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';

function fmtDate(ms) {
  if (!ms) return '(aberta)        ';
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDur(ms) {
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function pad(str, n) { return String(str).padEnd(n); }
function rpad(str, n) { return String(str).padStart(n); }

function fmtP(n) {
  if (n == null) return '—';
  return n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const candles = await fetchCandles();
  if (candles.length < RSI_PERIOD + 10) {
    console.error('❌ Candles insuficientes para o backtest.');
    process.exit(1);
  }

  const { trades, cancelled, finalCapital } = simulate(candles);

  const exLabel    = EXCHANGE === 'gate' ? 'Gate.io' : 'Binance';
  const from       = fmtDate(candles[RSI_PERIOD].openTime);
  const to         = fmtDate(candles[candles.length - 1].openTime);
  const totalSinal = trades.length + cancelled.length;
  const periodDesc = CANDLES ? `${candles.length} candles` : `${DAYS} dias`;
  const DIV        = '─'.repeat(118);

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  console.log(`\n📊 Backtest NET: ${SYMBOL}  |  ${exLabel}  |  ${periodDesc}`);
  console.log(`   Estratégia : RSI(${RSI_PERIOD},1h) < ${RSI_BUY} → aguarda -${ENTRY_DISCOUNT * 100}% (máx ${PENDING_MAX_H}h)  |  stop loss -${STOP_LOSS_PCT * 100}%  |  saída RSI > ${RSI_SELL}`);
  console.log(`   Capital    : $${CAPITAL.toFixed(2)}   Período : ${from} → ${to}`);
  console.log(`   Sinais RSI<${RSI_BUY}: ${totalSinal} total  (${trades.length} atingiram alvo -${ENTRY_DISCOUNT * 100}%  |  ${cancelled.length} não atingiram)`);

  // ── Tabela de trades ────────────────────────────────────────────────────────
  if (!trades.length) {
    console.log(`\n   ${Y}Nenhuma entrada executada neste período.${X}`);
  } else {
    console.log(`\n${DIV}`);
    //          #    Sinal RSI<30      RSI   Espera  Compra            P.entrada    Saída             P.saída    PnL%    PnL $    Capital    Duração  Motivo
    console.log(
      `  ${rpad('#', 2)}` +
      `  ${pad('── Sinal RSI<30 ──', 18)}` +
      `  ${pad('RSI', 5)}` +
      `  ${pad('Espera', 7)}` +
      `  ${pad('── Compra ──────', 16)}` +
      `  ${pad('P.entrada', 10)}` +
      `  ${pad('── Saída ───────', 16)}` +
      `  ${pad('P.saída', 10)}` +
      `  ${pad('PnL%', 7)}` +
      `  ${pad('PnL $', 8)}` +
      `  ${pad('Capital', 8)}` +
      `  ${pad('Duração', 7)}` +
      `  Motivo`,
    );
    console.log(DIV);

    for (const t of trades) {
      const pnlPos   = t.pnlUsdt >= 0;
      const color    = t.open ? Y : t.exitReason === 'STOP_LOSS' ? R : pnlPos ? G : R;
      const sign     = pnlPos ? '+' : '';
      const espera   = t.pendingCandles > 0 ? `+${t.pendingCandles}h` : ' imediato';
      const motivo   = t.exitReason === 'STOP_LOSS' ? `${R}🛑 STOP -${STOP_LOSS_PCT * 100}%${X}`
                     : t.exitReason === 'RSI_SELL'  ? `${G}✅ RSI>${RSI_SELL}${X}`
                     :                                `${Y}🔓 ABERTA${X}`;
      const rsiStr   = `${t.rsiEntry.toFixed(1)} → ${t.rsiExit != null ? t.rsiExit.toFixed(1) : '?'}`;

      console.log(
        `  ${rpad(t.n, 2)}` +
        `  ${pad(fmtDate(t.triggerTime), 18)}` +
        `  ${pad(t.triggerRsi != null ? t.triggerRsi.toFixed(1) : t.rsiEntry.toFixed(1), 5)}` +
        `  ${pad(espera, 7)}` +
        `  ${pad(fmtDate(t.entryTime), 16)}` +
        `  ${pad('$' + fmtP(t.entryPrice), 10)}` +
        `  ${pad(fmtDate(t.exitTime), 16)}` +
        `  ${pad('$' + fmtP(t.exitPrice), 10)}` +
        `  ${color}${pad(sign + t.pnlPct.toFixed(1) + '%', 7)}${X}` +
        `  ${color}${pad(sign + '$' + Math.abs(t.pnlUsdt).toFixed(2), 8)}${X}` +
        `  ${pad('$' + t.capital.toFixed(2), 8)}` +
        `  ${pad(fmtDur(t.durationMs), 7)}` +
        `  ${motivo}  (RSI ${rsiStr})`,
      );
    }

    console.log(DIV);
  }

  // ── Resumo ─────────────────────────────────────────────────────────────────
  {
    const closed   = trades.filter(t => !t.open);
    const wins     = closed.filter(t => t.exitReason === 'RSI_SELL' && t.pnlUsdt >= 0);
    const stops    = closed.filter(t => t.exitReason === 'STOP_LOSS');
    const losses   = closed.filter(t => t.pnlUsdt < 0 && t.exitReason !== 'STOP_LOSS');
    const totalPnl = closed.reduce((s, t) => s + t.pnlUsdt, 0);
    const pnlPct   = (totalPnl / CAPITAL) * 100;
    const avgDur   = closed.length
      ? fmtDur(closed.reduce((s, t) => s + t.durationMs, 0) / closed.length)
      : '—';
    const winRate  = closed.length ? (wins.length / closed.length * 100).toFixed(0) : '—';
    const pnlSign  = totalPnl >= 0 ? '+' : '';
    const pnlColor = totalPnl >= 0 ? G : R;

    console.log('\n  Resumo dos trades fechados');
    console.log(`  ${'─'.repeat(40)}`);
    console.log(`  Fechados      : ${closed.length}  (${G}✅ ${wins.length} RSI>70${X}  ${R}🛑 ${stops.length} stop${X}  ${R}❌ ${losses.length} outra perda${X})`);
    if (trades.some(t => t.open)) console.log(`  Aberta agora  : ${Y}1 posição em curso (inclusa no capital estimado)${X}`);
    console.log(`  Win rate      : ${winRate}%`);
    console.log(`  PnL total     : ${pnlColor}${pnlSign}$${totalPnl.toFixed(2)}  (${pnlSign}${pnlPct.toFixed(1)}%)${X}`);
    console.log(`  Capital       : $${CAPITAL.toFixed(2)} → $${finalCapital.toFixed(2)}`);
    console.log(`  Duração média : ${avgDur}`);
  }

  // ── Sinais RSI<30 que não atingiram o alvo ─────────────────────────────────
  if (cancelled.length) {
    const DIV2 = '─'.repeat(90);
    console.log(`\n  Sinais RSI<${RSI_BUY} que NÃO atingiram o alvo -${ENTRY_DISCOUNT * 100}%`);
    console.log(`  ${DIV2}`);
    console.log(
      `  ${pad('Sinal (RSI<30)', 18)}` +
      `  ${pad('RSI', 5)}` +
      `  ${pad('Gatilho $', 11)}` +
      `  ${pad(`Alvo -${ENTRY_DISCOUNT * 100}%`, 11)}` +
      `  ${pad('Esperou', 8)}` +
      `  Cancelado porque`,
    );
    console.log(`  ${DIV2}`);
    for (const c of cancelled) {
      console.log(
        `  ${pad(fmtDate(c.time), 18)}` +
        `  ${pad(c.triggerRsi.toFixed(1), 5)}` +
        `  ${pad('$' + fmtP(c.triggerPrice), 11)}` +
        `  ${pad('$' + fmtP(c.limitPrice), 11)}` +
        `  ${pad(c.pendingCandles + 'h', 8)}` +
        `  ${Y}${c.reason}${X}`,
      );
    }
    console.log(`  ${DIV2}`);
    const missedPct = (cancelled.length / totalSinal * 100).toFixed(0);
    console.log(`  ${cancelled.length} de ${totalSinal} sinais não aproveitados (${missedPct}%)`);
    console.log(`  Motivo mais comum: price recovery antes de cair -${ENTRY_DISCOUNT * 100}%`);
  }

  console.log();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
