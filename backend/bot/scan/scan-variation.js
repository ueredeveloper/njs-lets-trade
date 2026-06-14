'use strict';

/**
 * Scan de variação 5m + RSI(14)
 *
 * 1. Busca todos os símbolos da Binance (1 chamada).
 * 2. Para os arquivos locais que NÃO existem na Binance → atualiza via Gate.io.
 * 3. Calcula RSI(14) e variação das últimas 24h de cada moeda.
 * 4. Agrupa por faixa de variação e imprime tabela colorida.
 *
 * Uso:
 *   node backend/bot/scan-variation.js
 *   node backend/bot/scan-variation.js --rsi-only      # apenas RSI < 30 ou > 70
 *   node backend/bot/scan-variation.js --skip-update   # não atualiza Gate.io
 */

const path = require('path');
const fs   = require('fs');
const ti   = require('technicalindicators');

const { getGateCandles } = require('../gate/getGateCandles');

// ── Configuração ──────────────────────────────────────────────────────────────
const RSI_PERIOD    = 14;
const CANDLES_24H   = 288;       // 5min × 288 = 24 horas
const GATE_LIMIT      = 1000;    // candles a buscar por símbolo
const GATE_INTERVALS  = ['1m', '5m', '15m', '30m', '4h', '8h'];
const CONCURRENCY     = 5;       // símbolos simultâneos (cada um faz N intervalos)
const BINANCE_BASE  = 'https://api.binance.com';
const DATA_DIR      = path.join(__dirname, '../data/candlestick');

const RSI_ONLY    = process.argv.includes('--rsi-only');
const SKIP_UPDATE = process.argv.includes('--skip-update');

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

// ── Helpers — análise ─────────────────────────────────────────────────────────
function loadCloses(symbol) {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${symbol}-5m.json`), 'utf8'));
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
  const win = closes.slice(-CANDLES_24H);
  if (win.length < 2) return null;
  return ((win[win.length - 1] - win[0]) / win[0]) * 100;
}

function variationBucket(pct) {
  const sign  = pct >= 0 ? 1 : -1;
  const floor = Math.floor(Math.abs(pct));
  return sign * floor;
}

function varStr(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function bucketLabel(b) {
  return b >= 0 ? `+${b}% a +${b + 1}%` : `${b}% a ${b + 1}%`;
}

// ── Helpers — rede ────────────────────────────────────────────────────────────

/** Retorna Set com todos os símbolos negociados na Binance Spot (1 chamada). */
async function fetchBinanceSymbols() {
  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/ticker/price`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return new Set(data.map(t => t.symbol));
  } catch (err) {
    console.warn(`${C.yellow}⚠ Binance indisponível (${err.message}) — pulando filtro de exchange.${C.reset}`);
    return null; // null = não foi possível distinguir
  }
}

/** Executa promises em lotes de `limit` simultâneos. */
async function pool(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batch_results = await Promise.allSettled(batch.map(fn));
    results.push(...batch_results);
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const files   = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('-5m.json'));
  const symbols = files.map(f => f.replace('-5m.json', ''));

  // ── Etapa 1: Identificar moedas Gate.io-only ────────────────────────────────
  let gateOnly = [];
  if (!SKIP_UPDATE) {
    process.stdout.write('Buscando símbolos da Binance... ');
    const binanceSet = await fetchBinanceSymbols();

    if (binanceSet) {
      gateOnly = symbols.filter(s => !binanceSet.has(s));
      console.log(`${C.green}OK${C.reset} — ${binanceSet.size} pares Binance`);
      console.log(`  ${C.cyan}Exclusivas Gate.io: ${gateOnly.length} de ${symbols.length} moedas${C.reset}`);
    } else {
      console.log('Pulando atualização Gate.io.');
    }
  } else {
    console.log(`${C.yellow}[--skip-update] Sem atualização de candles.${C.reset}`);
  }

  // ── Etapa 2: Atualizar candles Gate.io ─────────────────────────────────────
  if (gateOnly.length > 0) {
    const ivLabel = GATE_INTERVALS.join(', ');
    console.log(`\nAtualizando ${gateOnly.length} moedas via Gate.io [${ivLabel}] (${CONCURRENCY} simultâneas)...`);

    let ok = 0, fail = 0;
    const results = await pool(gateOnly, CONCURRENCY, async (symbol) => {
      for (const iv of GATE_INTERVALS) {
        try {
          await getGateCandles(symbol, iv, GATE_LIMIT);
        } catch (err) {
          const msg = err?.message ?? '';
          if (!msg.includes('404') && !msg.includes('INVALID_CURRENCY')) {
            console.warn(`  ${C.yellow}⚠ ${symbol} ${iv}: ${msg}${C.reset}`);
          }
        }
      }
    });

    results.forEach(r => { r.status === 'fulfilled' ? ok++ : fail++; });

    console.log(`  ${C.green}✔ ${ok} atualizadas${C.reset}${fail ? `  ${C.red}✘ ${fail} com erro${C.reset}` : ''}\n`);
  }

  // ── Etapa 3: Análise RSI + variação ────────────────────────────────────────
  process.stdout.write(`Analisando ${symbols.length} moedas (5m)... `);

  const results = [];
  for (const symbol of symbols) {
    try {
      const closes = loadCloses(symbol);
      const rsi    = lastRsi(closes);
      if (rsi === null) continue;
      const vari = variation24h(closes);
      if (vari === null) continue;
      results.push({ symbol, rsi, variation: vari, bucket: variationBucket(vari) });
    } catch {
      // arquivo corrompido ou vazio
    }
  }
  console.log(`${C.green}OK${C.reset} (${results.length} válidas)\n`);

  // ── Etapa 4: Agrupamento ────────────────────────────────────────────────────
  const display = RSI_ONLY
    ? results.filter(r => r.rsi < 30 || r.rsi > 70)
    : results;

  const groups = new Map();
  for (const r of display) {
    if (!groups.has(r.bucket)) groups.set(r.bucket, []);
    groups.get(r.bucket).push(r);
  }

  const sortedBuckets = [...groups.keys()].sort((a, b) => b - a);

  // ── Etapa 5: Tabela ─────────────────────────────────────────────────────────
  const W    = { sym: 20, var: 12, rsi: 9 };
  const LINE = '─'.repeat(W.sym + W.var + W.rsi + 14);

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

  console.log(C.bold + C.white + '╔' + '═'.repeat(LINE.length) + '╗' + C.reset);
  console.log(C.bold + C.white + '║' + title.padEnd(LINE.length) + '║' + C.reset);
  console.log(C.bold + C.white + '╚' + '═'.repeat(LINE.length) + '╝' + C.reset);

  for (const bucket of sortedBuckets) {
    const group = groups.get(bucket);
    group.sort((a, b) => b.variation - a.variation);

    const bucketColor = bucket >= 0 ? C.green : C.red;

    console.log(`\n${bucketColor}${C.bold}▶ ${bucketLabel(bucket)}  (${group.length} moeda${group.length !== 1 ? 's' : ''})${C.reset}`);
    console.log(C.gray + LINE + C.reset);
    console.log(C.bold + 'Símbolo'.padEnd(W.sym) + 'Variação 24h'.padStart(W.var) + 'RSI(14)'.padStart(W.rsi) + '  Sinal' + C.reset);
    console.log(C.gray + LINE + C.reset);

    for (const r of group) {
      const vc  = r.variation >= 0 ? C.green : C.red;
      const rc  = rsiColor(r.rsi);
      console.log(
        r.symbol.padEnd(W.sym) +
        vc + varStr(r.variation).padStart(W.var) + C.reset +
        rc + r.rsi.toFixed(1).padStart(W.rsi) + C.reset +
        '  ' + rc + rsiLabel(r.rsi) + C.reset
      );
    }
    console.log(C.gray + LINE + C.reset);
  }

  // ── Etapa 6: Resumo ─────────────────────────────────────────────────────────
  const oversold   = results.filter(r => r.rsi < 30).sort((a, b) => a.rsi - b.rsi);
  const overbought = results.filter(r => r.rsi > 70).sort((a, b) => b.rsi - a.rsi);

  console.log(`\n${C.bold}Resumo${C.reset}`);
  console.log(`  Total analisado:       ${results.length} moedas`);
  console.log(`  ${C.cyan}Atualizadas Gate.io:   ${gateOnly.length} moedas${C.reset}`);
  console.log(`  ${C.green}RSI < 30 (OVERSOLD):   ${oversold.length} moedas${C.reset}`);
  console.log(`  ${C.red}RSI > 70 (OVERBOUGHT): ${overbought.length} moedas${C.reset}`);

  if (oversold.length > 0) {
    console.log(`\n${C.green}${C.bold}Oversold — RSI < 30 (oportunidade de compra)${C.reset}`);
    console.log(C.gray + '─'.repeat(50) + C.reset);
    for (const r of oversold) {
      const vc = r.variation >= 0 ? C.green : C.red;
      console.log(`  ${r.symbol.padEnd(18)} RSI: ${C.green}${r.rsi.toFixed(1).padStart(5)}${C.reset}  Var: ${vc}${varStr(r.variation).padStart(8)}${C.reset}`);
    }
  }

  if (overbought.length > 0) {
    console.log(`\n${C.red}${C.bold}Overbought — RSI > 70 (sinal de venda)${C.reset}`);
    console.log(C.gray + '─'.repeat(50) + C.reset);
    for (const r of overbought) {
      const vc = r.variation >= 0 ? C.green : C.red;
      console.log(`  ${r.symbol.padEnd(18)} RSI: ${C.red}${r.rsi.toFixed(1).padStart(5)}${C.reset}  Var: ${vc}${varStr(r.variation).padStart(8)}${C.reset}`);
    }
  }

  console.log('');
})();
