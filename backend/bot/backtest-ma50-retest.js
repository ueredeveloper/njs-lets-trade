'use strict';

/**
 * MA50 Retest Pattern — detecta dois pontos-chave:
 *
 *  1. FIM DA QUEDA   — primeiro candle em que a distância close→MA50 começa a diminuir
 *                      após ≥ MIN_SEPARATION candles consecutivos de afastamento.
 *                      Representa o local-mínimo do ciclo abaixo da MA50.
 *
 *  2. CRUZAMENTO ↑   — candle em que o close fecha acima da MA50 vindo de abaixo.
 *                      Representa o início do movimento de alta.
 *
 * Uso (API Binance):
 *   node backend/bot/backtest-ma50-retest.js [SYMBOL] [DAYS] [INTERVAL]
 *   node backend/bot/backtest-ma50-retest.js EDUUSDT 10 1h
 *
 * Uso (arquivo local de 1m, agrega para o INTERVAL desejado):
 *   node backend/bot/backtest-ma50-retest.js EDUUSDT 10 1h --file backend/data/candlestick/EDUUSDT-1m.json
 */

const path = require('path');
const fs   = require('fs');
const ti   = require('technicalindicators');

const SYMBOL      = process.argv[2] || 'EDUUSDT';
const DAYS_BACK   = parseInt(process.argv[3] || '10', 10);
const INTERVAL    = process.argv[4] || '1h';
const MA_PERIOD   = 50;

const fileArgIdx  = process.argv.indexOf('--file');
const LOCAL_FILE  = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : null;

// Número mínimo de candles consecutivos em afastamento para validar que houve
// um movimento de queda real (filtra ruídos de 1-2 candles).
const MIN_SEPARATION = 3;

const G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';

function fmtDate(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

function fmtP(p) {
  if (p == null) return '—';
  return p < 0.001 ? p.toFixed(6) : p < 0.1 ? p.toFixed(5) : p < 1 ? p.toFixed(4) : p.toFixed(3);
}

function intervalToMs(iv) {
  const m = iv.match(/^(\d+)([mhd])$/);
  const units = { m: 60_000, h: 3_600_000, d: 86_400_000 };
  return m ? parseInt(m[1]) * units[m[2]] : 3_600_000;
}

async function fetchKlines(symbol, interval, limit = 1000, startTime = null) {
  let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (startTime) url += `&startTime=${startTime}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).map(k => ({
    openTime: Number(k[0]),
    open: parseFloat(k[1]), high: parseFloat(k[2]),
    low:  parseFloat(k[3]), close: parseFloat(k[4]),
  }));
}

/**
 * Lê um arquivo JSON local de candles de 1m e agrega para o intervalo alvo.
 * Cada candle do arquivo pode ter os valores como string (formato Binance) ou number.
 */
function loadAndAggregate(filePath, targetInterval, daysBack) {
  const raw     = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  const ivMs    = intervalToMs(targetInterval);
  const cutoff  = Date.now() - daysBack * 86_400_000 - MA_PERIOD * ivMs;

  // Agrupa candles de 1m em buckets do intervalo alvo
  const buckets = new Map();
  for (const c of raw) {
    const t     = Number(c.openTime);
    if (t < cutoff) continue;
    const key   = Math.floor(t / ivMs) * ivMs; // início do candle agregado
    if (!buckets.has(key)) {
      buckets.set(key, { openTime: key, open: parseFloat(c.open), high: -Infinity, low: Infinity, close: 0 });
    }
    const b = buckets.get(key);
    b.high  = Math.max(b.high, parseFloat(c.high));
    b.low   = Math.min(b.low,  parseFloat(c.low));
    b.close = parseFloat(c.close); // último candle do bucket sobrescreve
  }

  return [...buckets.values()].sort((a, b) => a.openTime - b.openTime);
}

// ── Lógica de detecção — reutilizável no bot ──────────────────────────────────

/**
 * Para cada candle com MA50 disponível, retorna a fase em relação à MA50.
 *
 * @param {number} dist     close - MA50 do candle atual  (negativo = abaixo)
 * @param {number} prevDist close - MA50 do candle anterior
 * @returns {'above'|'crossover_up'|'separating'|'approaching'|'flat'}
 */
function getMA50Phase(dist, prevDist) {
  if (prevDist <= 0 && dist > 0) return 'crossover_up'; // cruzou de baixo para cima
  if (dist > 0)                  return 'above';
  const delta = dist - prevDist; // positivo = aproximando (dist menos negativa)
  if (delta < 0) return 'separating';  // afastando
  if (delta > 0) return 'approaching'; // aproximando
  return 'flat';
}

/**
 * Detecta eventos num array de candles com MA50 pré-calculada.
 *
 * Retorna array de eventos:
 *   { type: 'bottom',    ...candle, ma50, dist, sepCount }
 *   { type: 'crossover', ...candle, ma50, dist }
 */
function detectMA50RetestEvents(data, minSeparation = MIN_SEPARATION) {
  const events = [];
  let sepCount    = 0;
  let foundBottom = false;

  for (let i = 1; i < data.length; i++) {
    const d     = data[i];
    const phase = getMA50Phase(d.dist, data[i - 1].dist);

    if (phase === 'crossover_up') {
      events.push({ type: 'crossover', ...d });
      sepCount    = 0;
      foundBottom = false;
    } else if (phase === 'above') {
      sepCount    = 0;
      foundBottom = false;
    } else if (phase === 'separating') {
      sepCount++;
      foundBottom = false;
    } else if (phase === 'approaching' && !foundBottom && sepCount >= minSeparation) {
      // Primeiro candle de aproximação após separação suficiente → fundo do ciclo
      events.push({ type: 'bottom', ...d, sepCount });
      foundBottom = true;
    }
  }

  return events;
}

// ── Script de backtest ────────────────────────────────────────────────────────

(async () => {
  const fonte = LOCAL_FILE ? `arquivo ${LOCAL_FILE}` : `Binance API`;
  console.log(`\n${B}MA50(${MA_PERIOD}) Retest — ${SYMBOL} ${INTERVAL}${X}  (${fonte})\n`);
  console.log(`   Padrão: queda abaixo MA50 (≥${MIN_SEPARATION} candles) → aproximação → cruzamento ↑\n`);

  let candles;
  if (LOCAL_FILE) {
    process.stdout.write(`   Lendo ${LOCAL_FILE} e agregando para ${INTERVAL}...`);
    candles = loadAndAggregate(LOCAL_FILE, INTERVAL, DAYS_BACK);
    console.log(` ${candles.length} candles ${INTERVAL} OK\n`);
  } else {
    const startTime = Date.now() - DAYS_BACK * 86_400_000 - MA_PERIOD * intervalToMs(INTERVAL);
    process.stdout.write(`   Buscando candles...`);
    candles = await fetchKlines(SYMBOL, INTERVAL, 1000, startTime);
    console.log(` ${candles.length} OK\n`);
  }

  // Calcula MA50
  const closes  = candles.map(c => c.close);
  const ma50Arr = ti.SMA.calculate({ values: closes, period: MA_PERIOD });
  const offset  = closes.length - ma50Arr.length;

  // Array unificado: apenas candles com MA50 disponível
  const data = ma50Arr.map((ma50, j) => ({
    ...candles[j + offset],
    ma50,
    dist: candles[j + offset].close - ma50,  // negativo = abaixo da MA50
  }));

  const events = detectMA50RetestEvents(data);

  // ── Tabela de eventos ─────────────────────────────────────────────────────

  const W = 74;
  console.log('─'.repeat(W));
  console.log('DATA          EVENTO                  CLOSE       MA50    DIST MA50');
  console.log('─'.repeat(W));

  for (const e of events) {
    const distPct = (e.dist / e.ma50 * 100);
    const sign    = distPct >= 0 ? '+' : '';

    if (e.type === 'bottom') {
      const label = `Fim queda  sep=${e.sepCount}c`.padEnd(22);
      console.log(
        `${Y}${fmtDate(e.openTime)}${X}  ${Y}${label}${X}`,
        `${fmtP(e.close).padStart(10)}`,
        `${fmtP(e.ma50).padStart(8)}`,
        `  ${Y}${sign}${distPct.toFixed(2)}%${X}`,
      );
    } else {
      const label = 'Cruzou ↑ MA50'.padEnd(22);
      console.log(
        `${G}${fmtDate(e.openTime)}${X}  ${G}${label}${X}`,
        `${fmtP(e.close).padStart(10)}`,
        `${fmtP(e.ma50).padStart(8)}`,
        `  ${G}${sign}${distPct.toFixed(2)}%${X}`,
      );
    }
  }

  console.log('─'.repeat(W));

  const bottoms    = events.filter(e => e.type === 'bottom');
  const crossovers = events.filter(e => e.type === 'crossover');
  console.log(`\nEventos: ${Y}${bottoms.length} fundos${X}  ${G}${crossovers.length} cruzamentos${X}\n`);

  // ── Movimentos completos (fundo → cruzamento) ─────────────────────────────

  if (bottoms.length && crossovers.length) {
    console.log(`${B}Movimentos completos (fundo → cruzamento MA50):${X}`);
    for (const cross of crossovers) {
      const bot = bottoms.filter(b => b.openTime < cross.openTime).pop();
      if (!bot) continue;
      const gainPct = ((cross.close - bot.close) / bot.close * 100);
      const hours   = Math.round((cross.openTime - bot.openTime) / intervalToMs(INTERVAL));
      const ivLabel = INTERVAL === '1h' ? 'h' : ` candles ${INTERVAL}`;
      console.log(
        `  ${Y}Fundo  ${fmtDate(bot.openTime)}${X}`,
        `close=${fmtP(bot.close)} (${(bot.dist/bot.ma50*100).toFixed(1)}% MA50)`,
        `→ ${G}Cruzamento ${fmtDate(cross.openTime)}${X}`,
        `close=${fmtP(cross.close)}`,
        `| ${G}+${gainPct.toFixed(2)}%${X} em ${hours}${ivLabel}`,
      );
    }
    console.log('');
  }

  // ── Referência: funções para o bot ────────────────────────────────────────
  console.log(`${D}/* Para usar no bot:
   getMA50Phase(dist, prevDist)          → fase do candle atual
   detectMA50RetestEvents(data)          → array de eventos históricos
   Sinal de compra: phase === 'crossover_up' após ciclo com bottom detectado
*/${X}\n`);

})().catch(err => { console.error('\n❌', err.message); process.exit(1); });

module.exports = { getMA50Phase, detectMA50RetestEvents };
