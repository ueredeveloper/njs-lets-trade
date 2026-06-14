'use strict';

/**
 * Backtest — histórico de entradas do bot RSI(14,1h) + EMA200(1h)
 *
 * Simula exatamente a estratégia do hourlyRsiBot.js sobre dados reais.
 *
 * Uso:
 *   node backend/bot/backtest-hourly.js LINKUSDT
 *   node backend/bot/backtest-hourly.js LINKUSDT gate
 *   node backend/bot/backtest-hourly.js LINKUSDT binance 100 180    ← dias
 *   node backend/bot/backtest-hourly.js LINKUSDT binance 100 1800c  ← candles (sufixo "c")
 *                                        symbol   exchange capital   periodo
 */

const path = require('path');
const ti   = require('technicalindicators');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { toGateSymbol } = require('../utils/toGateSymbol');

const SYMBOL   = (process.argv[2] || 'LINKUSDT').toUpperCase();
const EXCHANGE = (process.argv[3] || 'binance').toLowerCase();
const CAPITAL  = parseFloat(process.argv[4] || '40');

// 5º arg: dias (ex: 90) ou candles com sufixo "c" (ex: 1800c)
const _arg5    = process.argv[5] || '90';
const _candles = _arg5.endsWith('c');
const DAYS     = _candles ? null : parseInt(_arg5);
const CANDLES  = _candles ? parseInt(_arg5) : null;

const EMA_PERIOD = 200;
const RSI_PERIOD = 14;
const RSI_BUY    = 30;
const RSI_SELL   = 70;

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
  const needed = CANDLES ? CANDLES + EMA_PERIOD + 50 : DAYS * 24 + EMA_PERIOD + 50;
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

  // Deduplica e ordena
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
  const emaAll = ti.EMA.calculate({ values: closes, period: EMA_PERIOD });

  const rsiOff = closes.length - rsiAll.length;
  const emaOff = closes.length - emaAll.length;

  const trades   = [];
  const blocked  = []; // RSI < 30 mas preço abaixo da EMA200
  let capital    = CAPITAL;
  let position   = null;

  for (let i = Math.max(rsiOff, emaOff); i < candles.length; i++) {
    const rsiIdx = i - rsiOff;
    const emaIdx = i - emaOff;
    if (rsiIdx < 0 || emaIdx < 0) continue;

    const rsi    = rsiAll[rsiIdx];
    const ema200 = emaAll[emaIdx];
    const close  = closes[i];
    if (rsi == null || ema200 == null) continue;

    const bullish = close > ema200;

    if (!position) {
      if (rsi < RSI_BUY) {
        if (!bullish) {
          blocked.push({ time: candles[i].openTime, rsi, close, ema200 });
        } else {
          position = {
            entryTime:   candles[i].openTime,
            entryPrice:  close,
            entryQty:    capital / close,
            entryUsdt:   capital,
            entryRsi:    rsi,
            entryEma200: ema200,
          };
        }
      }
    } else {
      if (rsi > RSI_SELL) {
        const usdtOut = position.entryQty * close;
        const pnlUsdt = usdtOut - position.entryUsdt;
        const pnlPct  = (pnlUsdt / position.entryUsdt) * 100;
        capital      += pnlUsdt;

        trades.push({
          n:          trades.length + 1,
          entryTime:  position.entryTime,
          exitTime:   candles[i].openTime,
          entryPrice: position.entryPrice,
          exitPrice:  close,
          entryUsdt:  position.entryUsdt,
          usdtOut,
          pnlUsdt,
          pnlPct,
          capital,
          entryRsi:   position.entryRsi,
          exitRsi:    rsi,
          duration:   candles[i].openTime - position.entryTime,
          open:       false,
        });

        position = null;
      }
    }
  }

  // Posição ainda aberta ao final do período
  if (position) {
    const lastClose = closes[closes.length - 1];
    const usdtOut   = position.entryQty * lastClose;
    const pnlUsdt   = usdtOut - position.entryUsdt;
    const pnlPct    = (pnlUsdt / position.entryUsdt) * 100;

    trades.push({
      n:          trades.length + 1,
      entryTime:  position.entryTime,
      exitTime:   null,
      entryPrice: position.entryPrice,
      exitPrice:  lastClose,
      entryUsdt:  position.entryUsdt,
      usdtOut,
      pnlUsdt,
      pnlPct,
      capital:    capital + pnlUsdt,
      entryRsi:   position.entryRsi,
      exitRsi:    null,
      duration:   candles[candles.length - 1].openTime - position.entryTime,
      open:       true,
    });
  }

  return { trades, blocked, finalCapital: capital };
}

// ── Formatação ────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';

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
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return r ? `${d}d ${r}h` : `${d}d`;
}

function pad(str, n, right = false) {
  const s = String(str);
  return right ? s.padStart(n) : s.padEnd(n);
}

function fmtPrice(p) {
  return p < 0.01 ? p.toFixed(6) : p < 1 ? p.toFixed(4) : p.toFixed(2);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const candles = await fetchCandles();
  if (candles.length < EMA_PERIOD + RSI_PERIOD + 10) {
    console.error('❌ Candles insuficientes para o backtest.');
    process.exit(1);
  }

  const { trades, blocked, finalCapital } = simulate(candles);

  const exLabel  = EXCHANGE === 'gate' ? 'Gate.io' : 'Binance';
  const from     = fmtDate(candles[EMA_PERIOD].openTime);
  const to       = fmtDate(candles[candles.length - 1].openTime);
  const divider  = '─'.repeat(100);

  console.log(`\n📊 Backtest: ${SYMBOL}  |  ${exLabel}  |  RSI(${RSI_PERIOD},1h) < ${RSI_BUY} + EMA${EMA_PERIOD}(1h)  |  capital $${CAPITAL.toFixed(2)}`);
  console.log(`   Período : ${from} → ${to}  (${candles.length} candles)`);
  console.log(divider);

  if (!trades.length) {
    console.log('   Nenhuma entrada encontrada neste período.');
  } else {
    // Cabeçalho da tabela
    console.log(
      `  ${pad('#', 3)}` +
      `  ${pad('Entrada', 16)}` +
      `  ${pad('Preço ent.', 11)}` +
      `  ${pad('Saída', 16)}` +
      `  ${pad('Preço saída', 11)}` +
      `  ${pad('PnL%', 7)}` +
      `  ${pad('PnL $', 9)}` +
      `  ${pad('Capital', 9)}` +
      `  ${pad('Duração', 8)}` +
      `  RSI e/s`
    );
    console.log(divider);

    for (const t of trades) {
      const color   = t.open ? Y : t.pnlUsdt >= 0 ? G : R;
      const sign    = t.pnlUsdt >= 0 ? '+' : '';
      const openTag = t.open ? ' 🔓' : '';

      console.log(
        `  ${pad(t.n, 3)}` +
        `  ${pad(fmtDate(t.entryTime), 16)}` +
        `  ${pad('$' + fmtPrice(t.entryPrice), 11)}` +
        `  ${pad(fmtDate(t.exitTime), 16)}` +
        `  ${pad('$' + fmtPrice(t.exitPrice), 11)}` +
        `  ${color}${pad(sign + t.pnlPct.toFixed(1) + '%', 7)}${X}` +
        `  ${color}${pad(sign + '$' + Math.abs(t.pnlUsdt).toFixed(2), 9)}${X}` +
        `  ${pad('$' + t.capital.toFixed(2), 9)}` +
        `  ${pad(fmtDur(t.duration), 8)}` +
        `  ${t.entryRsi.toFixed(1)} / ${t.exitRsi != null ? t.exitRsi.toFixed(1) : '—'}` +
        openTag
      );
    }

    console.log(divider);

    // Resumo
    const closed  = trades.filter(t => !t.open);
    const wins    = closed.filter(t => t.pnlUsdt > 0);
    const losses  = closed.filter(t => t.pnlUsdt <= 0);
    const totalPnl = closed.reduce((s, t) => s + t.pnlUsdt, 0);
    const pnlPct  = (totalPnl / CAPITAL) * 100;
    const avgDur  = closed.length
      ? fmtDur(closed.reduce((s, t) => s + t.duration, 0) / closed.length)
      : '—';
    const winRate = closed.length ? (wins.length / closed.length * 100).toFixed(0) : '—';

    console.log(`\n  Trades fechados : ${closed.length}  (${G}${wins.length} ✅ ganho${wins.length !== 1 ? 's' : ''}${X}  ${R}${losses.length} ❌ perda${losses.length !== 1 ? 's' : ''}${X})`);
    if (trades.some(t => t.open)) console.log(`  Posição aberta  : 1  ${Y}(🔓 ainda em curso)${X}`);
    console.log(`  Win rate        : ${winRate}%`);
    const pnlColor = totalPnl >= 0 ? G : R;
    const pnlSign  = totalPnl >= 0 ? '+' : '';
    console.log(`  PnL total       : ${pnlColor}${pnlSign}$${totalPnl.toFixed(2)}  (${pnlSign}${pnlPct.toFixed(1)}%)${X}`);
    console.log(`  Capital         : $${CAPITAL.toFixed(2)} → $${finalCapital.toFixed(2)}`);
    console.log(`  Duração média   : ${avgDur}`);
  }

  // Entradas bloqueadas pela EMA200
  if (blocked.length) {
    console.log(`\n${divider}`);
    console.log(`  ${Y}⚠️  Entradas bloqueadas pela EMA200 (RSI < ${RSI_BUY} mas preço abaixo da EMA200):${X}`);
    console.log(divider);
    for (const b of blocked) {
      const distPct = ((b.close - b.ema200) / b.ema200 * 100).toFixed(1);
      console.log(
        `  ${fmtDate(b.time)}` +
        `   RSI=${b.rsi.toFixed(1)}` +
        `   Preço=$${fmtPrice(b.close)}` +
        `   EMA200=$${fmtPrice(b.ema200)}` +
        `   dist=${distPct}%`
      );
    }
    console.log(`\n  Total bloqueadas: ${blocked.length}`);
  }

  console.log();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
