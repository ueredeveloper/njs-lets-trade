'use strict';

/**
 * Backtest — estratégia RSI dual-intervalo (15m entrada / 5m saída)
 *
 * Entrada : RSI(14) no candle 15m < 30  +  variação ≥ 0.5%  +  Filtro MA50(1h)
 * Saída   : RSI(14) no candle  5m ≥ 70  (ou RSI 15m volta ≤ 70 sem dados 5m)
 * Stop    : preço cai ≥ 5% da compra
 *
 * Uso:
 *   node backend/bot/backtest-rsi.js [SÍMBOLO]
 *
 * Exemplos:
 *   node backend/bot/backtest-rsi.js
 *   node backend/bot/backtest-rsi.js ALGOUSDT
 *   node backend/bot/backtest-rsi.js LINKUSDT
 */

const path = require('path');
const fs   = require('fs');
const ti   = require('technicalindicators');

// ── Parâmetros ────────────────────────────────────────────────────────────────
const RSI_PERIOD    = 14;
const RSI_BUY       = 30;    // RSI(15m) < este valor → possível entrada
const RSI_SELL      = 70;    // RSI(5m)  ≥ este valor → saída
const VARIATION_MIN = 0.5;   // % variação mínima do candle 15m (high-low/low)
const MA50_DIST_MAX = 3;     // % distância máxima da MA50(1h)
const STOP_LOSS_PCT = 0.05;  // 5% de queda → stop-loss
const FEE_RATE      = 0.002; // 0.2% por lado (compra + venda)
const SELL_DISCOUNT = 0.005; // 0.5% abaixo do close na venda (padrão 15m)

// ── Símbolo via argumento ─────────────────────────────────────────────────────
const SYMBOL = (process.argv[2] || 'EDUUSDT').toUpperCase();

// ── Carrega e normaliza candles ───────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data/candlestick');

function loadCandles(filename) {
  const fullPath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    console.error(`\n❌ Arquivo não encontrado: ${filename}`);
    console.error(`   Verifique se o símbolo "${SYMBOL}" está correto.`);
    console.error(`   Arquivos disponíveis: ls backend/data/candlestick/${SYMBOL}*.json\n`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  return raw
    .map(c => ({
      openTime: c.openTime,
      open:  parseFloat(c.open),
      high:  parseFloat(c.high),
      low:   parseFloat(c.low),
      close: parseFloat(c.close),
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

const candles1h  = loadCandles(`${SYMBOL}-1h.json`);
const candles15m = loadCandles(`${SYMBOL}-15m.json`);
const candles5m  = loadCandles(`${SYMBOL}-5m.json`);

// ── Utilitários ───────────────────────────────────────────────────────────────
const CANDLE_15M_MS = 15 * 60 * 1000;

function fmtTime(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtPnl(pnl) {
  return (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '%';
}

// Pré-computa RSI para toda a série de uma vez (mais eficiente)
function buildRsiSeries(candles) {
  const closes = candles.map(c => c.close);
  const rsiAll = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  // rsiAll[0] corresponde ao fechamento do candle no índice RSI_PERIOD
  return candles.map((_, i) => (i < RSI_PERIOD ? null : rsiAll[i - RSI_PERIOD]));
}

const rsi15mSeries = buildRsiSeries(candles15m);
const rsi5mSeries  = buildRsiSeries(candles5m);

// Busca binária: primeiro índice com openTime >= ts
function lowerBound(arr, ts) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].openTime < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Último índice 1h com openTime <= ts
function last1hIdxUpTo(ts) {
  let lo = 0, hi = candles1h.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles1h[mid].openTime <= ts) lo = mid;
    else hi = mid - 1;
  }
  return candles1h[lo].openTime <= ts ? lo : -1;
}

// ── Filtro MA50 (1h) ──────────────────────────────────────────────────────────
// Regra principal : preço dentro de ±3% da MA50 → ok
// Regra de exceção: preço abaixo de -3% MAS um dos últimos 10 candles 1h
//                   cruzou a MA50 (low <= ma50 <= high) → ok (retornando)
function checkMa50(ts, currentPrice) {
  const endIdx = last1hIdxUpTo(ts);
  if (endIdx < 49) {
    return { ok: false, ma50: null, distPct: null, crossCandle: null, crossAgo: null, crossTime: null };
  }

  const last50  = candles1h.slice(endIdx - 49, endIdx + 1);
  const ma50    = last50.reduce((s, c) => s + c.close, 0) / 50;
  const distPct = (currentPrice - ma50) / ma50 * 100;

  if (Math.abs(distPct) <= MA50_DIST_MAX) {
    return { ok: true, ma50, distPct, crossCandle: null, crossAgo: null, crossTime: null };
  }

  // Acima de +3%: bloqueio direto
  if (distPct > MA50_DIST_MAX) {
    return { ok: false, ma50, distPct, crossCandle: null, crossAgo: null, crossTime: null };
  }

  // Abaixo de -3%: verifica cruzamento nos últimos 10 candles 1h
  const recentStart = Math.max(0, endIdx - 9);
  const recent10    = candles1h.slice(recentStart, endIdx + 1);
  const crossIdx    = recent10.findIndex(c => c.low <= ma50 && c.high >= ma50);
  if (crossIdx !== -1) {
    const cc = recent10[crossIdx];
    return {
      ok: true, ma50, distPct,
      crossCandle: cc,
      crossAgo:    recent10.length - crossIdx,  // 1 = candle mais recente dos 10
      crossTime:   fmtTime(cc.openTime),
    };
  }

  return { ok: false, ma50, distPct, crossCandle: null, crossAgo: null, crossTime: null };
}

// ── Simulação ─────────────────────────────────────────────────────────────────
const trades = [];
let phase    = 'WATCHING';
let buyTrade = null;

const sep  = '═'.repeat(72);
const dash = '─'.repeat(72);

console.log('\n' + sep);
console.log(` BACKTEST  ${SYMBOL}`);
console.log(` Entrada  : RSI(15m) < ${RSI_BUY}  |  var >= ${VARIATION_MIN}%  |  MA50(1h) +-${MA50_DIST_MAX}%`);
console.log(` Saida    : RSI(5m)  >= ${RSI_SELL}  |  stop-loss -${STOP_LOSS_PCT * 100}%`);
console.log(` Periodo  : ${fmtTime(candles15m[0].openTime)} -> ${fmtTime(candles15m.at(-1).openTime)}  (${candles15m.length} candles 15m)`);
console.log(` 5m dados : ${fmtTime(candles5m[0].openTime)} -> ${fmtTime(candles5m.at(-1).openTime)}  (${candles5m.length} candles 5m)`);
console.log(sep + '\n');

for (let i = RSI_PERIOD; i < candles15m.length; i++) {
  const c15     = candles15m[i];
  const rsi15m  = rsi15mSeries[i];
  const closeTs = c15.openTime + CANDLE_15M_MS;  // timestamp de fechamento do candle 15m

  // ── WATCHING: checa sinal de entrada ────────────────────────────────────
  if (phase === 'WATCHING') {
    if (rsi15m === null || rsi15m >= RSI_BUY) continue;

    const variation = ((c15.high - c15.low) / c15.low) * 100;
    if (variation < VARIATION_MIN) continue;

    const ma50r = checkMa50(closeTs, c15.close);
    const ma50Str = ma50r.ma50 !== null
      ? `${ma50r.ma50.toFixed(4)}  dist=${ma50r.distPct >= 0 ? '+' : ''}${ma50r.distPct.toFixed(2)}%`
      : 'n/a';
    const crossLine = ma50r.crossCandle
      ? `\n   Cross MA50  : ${ma50r.crossAgo}h atras (${ma50r.crossTime})` +
        `  O=${ma50r.crossCandle.open.toFixed(4)}` +
        `  H=${ma50r.crossCandle.high.toFixed(4)}` +
        `  L=${ma50r.crossCandle.low.toFixed(4)}` +
        `  C=${ma50r.crossCandle.close.toFixed(4)}`
      : '';

    if (!ma50r.ok) {
      // Imprime entradas bloqueadas para análise
      console.log(`⛔ BLOQUEADO ${fmtTime(closeTs)}` +
        `  RSI(15m)=${rsi15m.toFixed(2)}` +
        `  close=${c15.close.toFixed(4)}` +
        `  MA50(1h)=${ma50Str}${crossLine}`);
      continue;
    }

    // Entrada confirmada
    phase = 'BOUGHT';
    buyTrade = {
      idx15m: i, entryTime: closeTs, entryPrice: c15.close,
      rsi15m, variation, ...ma50r, entryCandle: c15,
    };

    console.log(dash);
    console.log(`\U0001F7E2 ENTRADA   ${fmtTime(buyTrade.entryTime)}`);
    console.log(`   Preco     : ${c15.close.toFixed(4)} USDT`);
    console.log(`   Candle 15m: O=${c15.open.toFixed(4)} H=${c15.high.toFixed(4)} L=${c15.low.toFixed(4)} C=${c15.close.toFixed(4)}  var=${variation.toFixed(2)}%`);
    console.log(`   RSI(15m)  : ${rsi15m.toFixed(2)}`);
    console.log(`   MA50(1h)  : ${ma50Str}${crossLine}`);

  // ── BOUGHT / ABOVE_70: checa saída ──────────────────────────────────────
  } else {
    // Itera candles 5m que fecham dentro deste candle 15m
    const j0 = lowerBound(candles5m, c15.openTime);
    const j1 = lowerBound(candles5m, closeTs);
    let exited = false;

    for (let j = j0; j < j1 && j < candles5m.length; j++) {
      const c5    = candles5m[j];
      const rsi5m = rsi5mSeries[j];
      if (rsi5m === null) continue;

      // Stop-loss: o low do candle 5m tocou o nível
      if (c5.low <= buyTrade.entryPrice * (1 - STOP_LOSS_PCT)) {
        const exitPrice   = buyTrade.entryPrice * (1 - STOP_LOSS_PCT);
        const pnl         = (exitPrice * (1 - SELL_DISCOUNT) * (1 - FEE_RATE) - buyTrade.entryPrice * (1 + FEE_RATE)) / (buyTrade.entryPrice * (1 + FEE_RATE)) * 100;
        const durationMin = Math.round((c5.openTime - buyTrade.entryTime) / 60000);
        console.log(`\U0001F6D1 STOP-LOSS ${fmtTime(c5.openTime)}  preco~${exitPrice.toFixed(4)}  PnL=${fmtPnl(pnl)}  dur=${durationMin}min`);
        trades.push({ ...buyTrade, exitTime: c5.openTime, exitPrice, pnl, reason: 'stop-loss' });
        phase = 'WATCHING'; buyTrade = null; exited = true; break;
      }

      if (phase === 'BOUGHT') {
        if (rsi5m >= RSI_SELL) {
          // Venda imediata: RSI(5m) atingiu zona de venda
          const exitPrice   = c5.close * (1 - SELL_DISCOUNT);
          const pnl         = (exitPrice * (1 - FEE_RATE) - buyTrade.entryPrice * (1 + FEE_RATE)) / (buyTrade.entryPrice * (1 + FEE_RATE)) * 100;
          const durationMin = Math.round((c5.openTime - buyTrade.entryTime) / 60000);
          console.log(`\U0001F534 SAIDA     ${fmtTime(c5.openTime)}  RSI(5m)=${rsi5m.toFixed(2)}>=${RSI_SELL}  preco=${exitPrice.toFixed(4)}  PnL=${fmtPnl(pnl)}  dur=${durationMin}min`);
          trades.push({ ...buyTrade, exitTime: c5.openTime, exitPrice, pnl, reason: 'RSI5m>=70' });
          phase = 'WATCHING'; buyTrade = null; exited = true; break;
        }
        // RSI(15m) já passou de 70: aguarda retorno ou RSI(5m)>=70
        if (rsi15m !== null && rsi15m > RSI_SELL) phase = 'ABOVE_70';

      } else if (phase === 'ABOVE_70') {
        if (rsi5m >= RSI_SELL) {
          const exitPrice   = c5.close * (1 - SELL_DISCOUNT);
          const pnl         = (exitPrice * (1 - FEE_RATE) - buyTrade.entryPrice * (1 + FEE_RATE)) / (buyTrade.entryPrice * (1 + FEE_RATE)) * 100;
          const durationMin = Math.round((c5.openTime - buyTrade.entryTime) / 60000);
          console.log(`\U0001F534 SAIDA     ${fmtTime(c5.openTime)}  RSI(5m)=${rsi5m.toFixed(2)}>=${RSI_SELL} [ABOVE_70]  preco=${exitPrice.toFixed(4)}  PnL=${fmtPnl(pnl)}  dur=${durationMin}min`);
          trades.push({ ...buyTrade, exitTime: c5.openTime, exitPrice, pnl, reason: 'RSI5m>=70@ABOVE_70' });
          phase = 'WATCHING'; buyTrade = null; exited = true; break;
        }
        // RSI(15m) voltou abaixo de 70: vende agora
        if (rsi15m !== null && rsi15m <= RSI_SELL) {
          const exitPrice   = c5.close * (1 - SELL_DISCOUNT);
          const pnl         = (exitPrice * (1 - FEE_RATE) - buyTrade.entryPrice * (1 + FEE_RATE)) / (buyTrade.entryPrice * (1 + FEE_RATE)) * 100;
          const durationMin = Math.round((c5.openTime - buyTrade.entryTime) / 60000);
          console.log(`\U0001F534 SAIDA     ${fmtTime(c5.openTime)}  RSI(15m)=${rsi15m.toFixed(2)}<=${RSI_SELL} (retorno)  preco=${exitPrice.toFixed(4)}  PnL=${fmtPnl(pnl)}  dur=${durationMin}min`);
          trades.push({ ...buyTrade, exitTime: c5.openTime, exitPrice, pnl, reason: 'RSI15m<=70' });
          phase = 'WATCHING'; buyTrade = null; exited = true; break;
        }
      }
    }

    // Fallback: sem candles 5m nesta janela — usa somente RSI(15m)
    if (!exited && buyTrade) {
      if (c15.low <= buyTrade.entryPrice * (1 - STOP_LOSS_PCT)) {
        const exitPrice   = buyTrade.entryPrice * (1 - STOP_LOSS_PCT);
        const pnl         = (exitPrice * (1 - SELL_DISCOUNT) * (1 - FEE_RATE) - buyTrade.entryPrice * (1 + FEE_RATE)) / (buyTrade.entryPrice * (1 + FEE_RATE)) * 100;
        const durationMin = Math.round((closeTs - buyTrade.entryTime) / 60000);
        console.log(`\U0001F6D1 STOP-LOSS ${fmtTime(closeTs)}  preco~${exitPrice.toFixed(4)} [15m]  PnL=${fmtPnl(pnl)}  dur=${durationMin}min`);
        trades.push({ ...buyTrade, exitTime: closeTs, exitPrice, pnl, reason: 'stop-loss@15m' });
        phase = 'WATCHING'; buyTrade = null;
      } else if (phase === 'BOUGHT' && rsi15m !== null && rsi15m > RSI_SELL) {
        phase = 'ABOVE_70';
      } else if (phase === 'ABOVE_70' && rsi15m !== null && rsi15m <= RSI_SELL) {
        const exitPrice   = c15.close * (1 - SELL_DISCOUNT);
        const pnl         = (exitPrice * (1 - FEE_RATE) - buyTrade.entryPrice * (1 + FEE_RATE)) / (buyTrade.entryPrice * (1 + FEE_RATE)) * 100;
        const durationMin = Math.round((closeTs - buyTrade.entryTime) / 60000);
        console.log(`\U0001F534 SAIDA     ${fmtTime(closeTs)}  RSI(15m)=${rsi15m.toFixed(2)} [fallback 15m]  preco=${exitPrice.toFixed(4)}  PnL=${fmtPnl(pnl)}  dur=${durationMin}min`);
        trades.push({ ...buyTrade, exitTime: closeTs, exitPrice, pnl, reason: 'RSI15m<=70@fallback' });
        phase = 'WATCHING'; buyTrade = null;
      }
    }
  }
}

// Posição ainda aberta ao final dos dados
if (buyTrade) {
  const last = candles15m.at(-1);
  const pnl  = (last.close * (1 - FEE_RATE) - buyTrade.entryPrice * (1 + FEE_RATE)) / (buyTrade.entryPrice * (1 + FEE_RATE)) * 100;
  console.log(`\n⏳ POSICAO ABERTA  entrada=${fmtTime(buyTrade.entryTime)}  preco entrada=${buyTrade.entryPrice.toFixed(4)}  preco atual=${last.close.toFixed(4)}  PnL nao realizado=${fmtPnl(pnl)}`);
}

// ── Resumo final ──────────────────────────────────────────────────────────────
console.log('\n' + sep);
console.log(' RESUMO');
console.log(sep);

if (trades.length === 0) {
  console.log(' Nenhuma operacao fechada no periodo.');
} else {
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const total  = trades.reduce((s, t) => s + t.pnl, 0);
  const avgPnl = total / trades.length;
  const avgDur = Math.round(trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / trades.length / 60000);

  console.log(` Operacoes     : ${trades.length}  |  Ganhos: ${wins.length} (${(wins.length/trades.length*100).toFixed(0)}%)  |  Perdas: ${losses.length}`);
  console.log(` PnL acumulado : ${fmtPnl(total)}`);
  console.log(` PnL medio     : ${fmtPnl(avgPnl)}`);
  console.log(` Melhor        : ${fmtPnl(Math.max(...trades.map(t => t.pnl)))}`);
  console.log(` Pior          : ${fmtPnl(Math.min(...trades.map(t => t.pnl)))}`);
  console.log(` Duracao media : ${avgDur} min`);

  console.log('\n Motivos de saida:');
  const reasons = {};
  trades.forEach(t => { reasons[t.reason] = (reasons[t.reason] || 0) + 1; });
  Object.entries(reasons).forEach(([r, n]) => console.log(`   ${r.padEnd(25)}: ${n}`));

  console.log('\n Entradas de compra:');
  console.log(` ${'#'.padStart(2)}  ${'Data/Hora'.padEnd(14)} ${'Preco'.padStart(10)} ${'RSI(15m)'.padStart(9)} ${'Var%'.padStart(6)} ${'MA50dist'.padStart(9)} ${'MA50cross'.padStart(12)}`);
  console.log(' ' + '─'.repeat(70));
  trades.forEach((t, n) => {
    const crossStr = t.crossCandle ? `${t.crossAgo}h atras` : 'dentro +-3%';
    console.log(` ${String(n+1).padStart(2)}  ${fmtTime(t.entryTime).padEnd(14)} ${t.entryPrice.toFixed(4).padStart(10)} ${t.rsi15m.toFixed(2).padStart(9)} ${(t.variation.toFixed(2)+'%').padStart(6)} ${((t.distPct>=0?'+':'')+t.distPct.toFixed(2)+'%').padStart(9)} ${crossStr.padStart(12)}`);
  });

  console.log('\n Operacoes completas (entrada -> saida):');
  console.log(` ${'#'.padStart(2)}  ${'Entrada'.padEnd(14)} ${'Saida'.padEnd(14)} ${'Motivo'.padEnd(22)} ${'PnL'.padStart(7)} ${'Dur(min)'.padStart(8)}`);
  console.log(' ' + '─'.repeat(72));
  trades.forEach((t, n) => {
    const dur = Math.round((t.exitTime - t.entryTime) / 60000);
    console.log(` ${String(n+1).padStart(2)}  ${fmtTime(t.entryTime).padEnd(14)} ${fmtTime(t.exitTime).padEnd(14)} ${t.reason.padEnd(22)} ${fmtPnl(t.pnl).padStart(7)} ${String(dur).padStart(8)}`);
  });
}
console.log(sep + '\n');
