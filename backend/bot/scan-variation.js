'use strict';

/**
 * Scan de variação 5m + RSI(14)
 *
 * Lê todos os arquivos *-5m.json de backend/data/candlestick,
 * calcula o RSI(14) mais recente e a variação das últimas 24h,
 * e agrupa as moedas por faixa de variação (0-1%, 1-2%, etc.).
 *
 * Uso:
 *   node backend/bot/scan-variation.js
 *   node backend/bot/scan-variation.js --rsi-only   # exibe apenas RSI < 30 ou > 70
 */

const path = require('path');
const fs   = require('fs');
const ti   = require('technicalindicators');

// ── Configuração ──────────────────────────────────────────────────────────────
const RSI_PERIOD  = 14;
const CANDLES_24H = 288; // 5min × 288 = 24 horas
const DATA_DIR    = path.join(__dirname, '../data/candlestick');
const RSI_ONLY    = process.argv.includes('--rsi-only');

// ── ANSI colors ───────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadCloses(symbol) {
  const fullPath = path.join(DATA_DIR, `${symbol}-5m.json`);
  const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  return raw
    .sort((a, b) => a.openTime - b.openTime)
    .map(c => parseFloat(c.close));
}

function lastRsi(closes) {
  if (closes.length < RSI_PERIOD + 1) return null;
  const vals = ti.RSI.calculate({ values: closes, period: RSI_PERIOD });
  const v = vals[vals.length - 1];
  return v != null ? v : null;
}

function variation24h(closes) {
  const window = closes.slice(-CANDLES_24H);
  if (window.length < 2) return null;
  return ((window[window.length - 1] - window[0]) / window[0]) * 100;
}

function variationBucket(pct) {
  // retorna o inteiro inferior da faixa (ex: 2.7% → bucket 2, -1.3% → bucket -2)
  const sign  = pct >= 0 ? 1 : -1;
  const floor = Math.floor(Math.abs(pct));
  return sign * floor;
}

function bucketLabel(b) {
  if (b >= 0) return `+${b}% a +${b + 1}%`;
  return `${b}% a ${b + 1}%`;
}

function varStr(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

// ── Carrega todos os símbolos ─────────────────────────────────────────────────
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('-5m.json'));
process.stdout.write(`Analisando ${files.length} moedas (5m)... `);

const results = [];
for (const file of files) {
  const symbol = file.replace('-5m.json', '');
  try {
    const closes = loadCloses(symbol);
    const rsi    = lastRsi(closes);
    if (rsi === null) continue;
    const vari = variation24h(closes);
    if (vari === null) continue;
    results.push({ symbol, rsi, variation: vari, bucket: variationBucket(vari) });
  } catch {
    // arquivo corrompido ou vazio — ignora
  }
}
console.log(`${C.green}OK${C.reset} (${results.length} válidas)\n`);

// ── Agrupamento por faixa de variação ─────────────────────────────────────────
const display = RSI_ONLY
  ? results.filter(r => r.rsi < 30 || r.rsi > 70)
  : results;

const groups = new Map();
for (const r of display) {
  if (!groups.has(r.bucket)) groups.set(r.bucket, []);
  groups.get(r.bucket).push(r);
}

const sortedBuckets = [...groups.keys()].sort((a, b) => b - a);

// ── Renderização da tabela ────────────────────────────────────────────────────
const W = { sym: 20, var: 12, rsi: 9, sig: 12 };
const LINE = '─'.repeat(W.sym + W.var + W.rsi + W.sig);

function rsiColor(rsi) {
  if (rsi < 30) return C.green;
  if (rsi > 70) return C.red;
  return C.reset;
}

function rsiLabel(rsi) {
  if (rsi < 30) return 'OVERSOLD';
  if (rsi > 70) return 'OVERBOUGHT';
  return '-';
}

const title = RSI_ONLY
  ? ' VARIAÇÃO 5M + RSI  [apenas RSI < 30 ou > 70]'
  : ' VARIAÇÃO 5M + RSI  [todas as moedas]';

console.log(C.bold + C.white + '╔' + '═'.repeat(W.sym + W.var + W.rsi + W.sig) + '╗' + C.reset);
console.log(C.bold + C.white + '║' + title.padEnd(W.sym + W.var + W.rsi + W.sig) + '║' + C.reset);
console.log(C.bold + C.white + '╚' + '═'.repeat(W.sym + W.var + W.rsi + W.sig) + '╝' + C.reset);

for (const bucket of sortedBuckets) {
  const group = groups.get(bucket);
  group.sort((a, b) => b.variation - a.variation);

  const bucketColor = bucket >= 0 ? C.green : C.red;
  const label = bucketLabel(bucket);

  console.log(`\n${bucketColor}${C.bold}▶ ${label}  (${group.length} moeda${group.length !== 1 ? 's' : ''})${C.reset}`);
  console.log(C.gray + LINE + C.reset);
  console.log(
    C.bold +
    'Símbolo'.padEnd(W.sym) +
    'Variação 24h'.padStart(W.var) +
    'RSI(14)'.padStart(W.rsi) +
    '  Sinal' +
    C.reset
  );
  console.log(C.gray + LINE + C.reset);

  for (const r of group) {
    const vc   = r.variation >= 0 ? C.green : C.red;
    const rc   = rsiColor(r.rsi);
    const vs   = varStr(r.variation).padStart(W.var);
    const rs   = r.rsi.toFixed(1).padStart(W.rsi);
    const sig  = rsiLabel(r.rsi);

    console.log(
      r.symbol.padEnd(W.sym) +
      vc + vs + C.reset +
      rc + rs + C.reset +
      '  ' + rc + sig + C.reset
    );
  }

  console.log(C.gray + LINE + C.reset);
}

// ── Resumo ────────────────────────────────────────────────────────────────────
const oversold   = results.filter(r => r.rsi < 30).sort((a, b) => a.rsi - b.rsi);
const overbought = results.filter(r => r.rsi > 70).sort((a, b) => b.rsi - a.rsi);

console.log(`\n${C.bold}Resumo${C.reset}`);
console.log(`  Total analisado:       ${results.length} moedas`);
console.log(`  ${C.green}RSI < 30 (OVERSOLD):   ${oversold.length} moedas${C.reset}`);
console.log(`  ${C.red}RSI > 70 (OVERBOUGHT): ${overbought.length} moedas${C.reset}`);

if (oversold.length > 0) {
  console.log(`\n${C.green}${C.bold}Oversold — RSI < 30 (oportunidade de compra)${C.reset}`);
  console.log(C.gray + '─'.repeat(48) + C.reset);
  for (const r of oversold) {
    const vs = varStr(r.variation);
    const vc = r.variation >= 0 ? C.green : C.red;
    console.log(
      `  ${r.symbol.padEnd(18)} RSI: ${C.green}${r.rsi.toFixed(1).padStart(5)}${C.reset}  Var: ${vc}${vs.padStart(8)}${C.reset}`
    );
  }
}

if (overbought.length > 0) {
  console.log(`\n${C.red}${C.bold}Overbought — RSI > 70 (sinal de venda)${C.reset}`);
  console.log(C.gray + '─'.repeat(48) + C.reset);
  for (const r of overbought) {
    const vs = varStr(r.variation);
    const vc = r.variation >= 0 ? C.green : C.red;
    console.log(
      `  ${r.symbol.padEnd(18)} RSI: ${C.red}${r.rsi.toFixed(1).padStart(5)}${C.reset}  Var: ${vc}${vs.padStart(8)}${C.reset}`
    );
  }
}

console.log('');
