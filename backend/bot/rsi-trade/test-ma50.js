'use strict';

/**
 * Análise MA50(1h) — calibra ma50_lower_pct por moeda e salva no Supabase.
 *
 * Uso:
 *   node backend/bot/test-ma50.js GENIUSUSDT          → analisa e salva uma moeda
 *   node backend/bot/test-ma50.js GENIUSUSDT gate      → idem, Gate.io
 *   node backend/bot/test-ma50.js --all                → analisa todas e salva todas
 *   node backend/bot/test-ma50.js --all --dry-run      → só exibe, não salva
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { fetchBinanceCandles, fetchGateCandles, fetchBinanceCurrentPrice, fetchGateCurrentPrice } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Supabase ──────────────────────────────────────────────────────────────────
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_USER   = process.env.SUPABASE_DEFAULT_USER_ID;

async function loadFavorites() {
  if (!SB_URL || !SB_KEY || !SB_USER) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DEFAULT_USER_ID não definidos no .env');
  const url = `${SB_URL}/rest/v1/favorites_trade?user_id=eq.${encodeURIComponent(SB_USER)}&select=symbol,exchange&order=position.asc`;
  const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!res.ok) throw new Error(`Supabase GET: HTTP ${res.status}`);
  return res.json();
}

async function saveToSupabase(symbol, ma50LowerPct) {
  if (DRY_RUN) { console.log(`  [dry-run] ${symbol} → ma50_lower_pct = ${ma50LowerPct}`); return; }
  if (!SB_URL || !SB_KEY || !SB_USER) { console.warn('  Supabase não configurado — pulando gravação.'); return; }
  const url = `${SB_URL}/rest/v1/favorites_trade?user_id=eq.${encodeURIComponent(SB_USER)}&symbol=eq.${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    method:  'PATCH',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body:    JSON.stringify({ ma50_lower_pct: ma50LowerPct }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.warn(`  ⚠️  Supabase PATCH ${symbol}: HTTP ${res.status} — ${txt.slice(0, 200)}`);
    if (res.status === 400 && txt.includes('ma50_lower_pct')) {
      console.warn('  → Coluna ma50_lower_pct não existe. Crie-a na tabela favorites_trade (tipo numeric, nullable).');
    }
  }
}

// ── Precomputa MA50 ───────────────────────────────────────────────────────────
function buildMa50Array(candles) {
  const ma50 = new Array(candles.length).fill(null);
  for (let i = 49; i < candles.length; i++) {
    let sum = 0;
    for (let k = i - 49; k <= i; k++) sum += candles[k].close;
    ma50[i] = sum / 50;
  }
  return ma50;
}

// ── Zonas e parâmetros ────────────────────────────────────────────────────────
const ZONES = [
  { label: '0/-1%',  min: -1,  max:  0 },
  { label: '-1/-2%', min: -2,  max: -1 },
  { label: '-2/-3%', min: -3,  max: -2 },
  { label: '-3/-4%', min: -4,  max: -3 },
  { label: '-4/-5%', min: -5,  max: -4 },
  { label: '-5/-6%', min: -6,  max: -5 },
];
const LOOK_FWD      = 72;  // horas de janela após entrada
const COOLDOWN      = 12;  // candles entre entradas para evitar duplicata
const MIN_OK        = 80;  // % mínimo de recuperação para zona "segura"
const MIN_SAMPLES   = 5;   // mínimo de episódios para zona ser considerada confiável
const DEFAULT_LOWER = -3;  // fallback quando dados insuficientes ou zona não confiável

// ── Core: análise por moeda ───────────────────────────────────────────────────
async function analyzeZones(symbol, fetchCandles) {
  const candles = await fetchCandles(symbol, 1000, '1h');
  if (candles.length < 120) return null;

  const ma50arr = buildMa50Array(candles);
  const zoneResults = [];

  for (const zone of ZONES) {
    const results = [];
    let skip = 0;

    for (let i = 49; i < candles.length - LOOK_FWD; i++) {
      if (skip > 0) { skip--; continue; }
      if (ma50arr[i] === null) continue;
      const distPct = (candles[i].close - ma50arr[i]) / ma50arr[i] * 100;
      if (distPct < zone.min || distPct >= zone.max) continue;

      const entry = candles[i].close;
      let maxGain = 0, maxLoss = 0, recovered = false;

      for (let j = i + 1; j <= Math.min(i + LOOK_FWD, candles.length - 1); j++) {
        const change = (candles[j].close - entry) / entry * 100;
        if (change > maxGain) maxGain = change;
        if (change < maxLoss) maxLoss = change;
        if (ma50arr[j] !== null && candles[j].close >= ma50arr[j]) recovered = true;
      }

      results.push({ maxGain, maxLoss, recovered });
      skip = COOLDOWN;
    }

    if (!results.length) { zoneResults.push(null); continue; }
    const nUp  = results.filter(r => r.recovered).length;
    zoneResults.push({
      n: results.length, nUp,
      pct:  nUp / results.length * 100,
      avgG: results.reduce((s, r) => s + r.maxGain,          0) / results.length,
      avgL: results.reduce((s, r) => s + Math.abs(r.maxLoss), 0) / results.length,
    });
  }

  // Zona mais profunda com pct ≥ MIN_OK e amostras suficientes
  let suggested = DEFAULT_LOWER;
  for (let i = ZONES.length - 1; i >= 0; i--) {
    const r = zoneResults[i];
    if (r && r.pct >= MIN_OK && r.n >= MIN_SAMPLES) {
      suggested = ZONES[i].min; // ex: -6 para zona -5/-6%
      break;
    }
  }

  return { days: Math.round(candles.length / 24), zones: zoneResults, suggested };
}

// ── Saída detalhada (modo single) ─────────────────────────────────────────────
function printDetailed(symbol, data) {
  const log = (...a) => console.log(`[${symbol}]`, ...a);
  log(`\n📉 Análise abaixo da MA50(1h)  |  Janela: ${LOOK_FWD}h  |  Dados: ≈${data.days} dias`);
  log('"Subiu" = voltou ≥ MA50 dentro da janela  |  "Caiu" = nunca voltou\n');
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    const r = data.zones[i];
    if (!r) { log(`  ${z.label.padEnd(10)}: — sem episódios`); continue; }
    const nDown = r.n - r.nUp;
    const safe  = r.pct >= MIN_OK ? '✅' : '⚠️ ';
    log(`  ${safe} ${z.label.padEnd(10)}: ${String(r.n).padStart(3)} entradas | ▲ ${String(r.nUp).padStart(2)} subiu  ▼ ${String(nDown).padStart(2)} caiu  (${r.pct.toFixed(0)}% ok) | +${r.avgG.toFixed(2)}% / -${r.avgL.toFixed(2)}%`);
    log(`       ${''.padEnd(10)}${'▲'.repeat(r.nUp)}${'▼'.repeat(nDown)}`);
  }
  log(`\n→ ma50_lower_pct = ${data.suggested}%  (limite negativo sugerido)`);
}

// ── Saída em tabela (modo --all) ──────────────────────────────────────────────
function printTable(rows) {
  const header = ['Moeda'.padEnd(16), ...ZONES.map(z => z.label.padStart(10)), '  Gravado'];
  console.log('\n' + header.join('  '));
  console.log('─'.repeat(header.join('  ').length));
  for (const { symbol, data, error, saved } of rows) {
    if (error || !data) {
      console.log(`${symbol.padEnd(16)}  ${'erro'.padStart(10)}  — ${String(error ?? 'dados insuficientes').slice(0, 60)}`);
      continue;
    }
    const cols = data.zones.map(r => {
      if (!r) return '—'.padStart(10);
      const mark = r.pct >= MIN_OK ? '✅' : '⚠️ ';
      return `${mark}${r.pct.toFixed(0).padStart(3)}%(${r.n})`.padStart(10);
    });
    const savedStr = saved !== undefined ? `  ${saved}%` : '  n/a';
    console.log(`${symbol.padEnd(16)}  ${cols.join('  ')}${savedStr}`);
  }
  console.log(`\nLegenda: ✅ ≥ ${MIN_OK}% recuperou à MA50 em ${LOOK_FWD}h  |  ⚠️  < ${MIN_OK}%`);
  console.log(`"Gravado" = ma50_lower_pct salvo no Supabase${DRY_RUN ? ' (DRY RUN — nada foi salvo)' : ''}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const arg = process.argv[2] || '';

  if (arg === '--all') {
    console.log('Carregando favoritos do Supabase…');
    const favs = await loadFavorites();
    if (!favs.length) { console.error('Nenhum favorito encontrado.'); process.exit(1); }
    console.log(`${favs.length} moedas encontradas. Buscando candles em paralelo…`);

    const rows = await Promise.all(favs.map(async ({ symbol, exchange }) => {
      const exch         = (exchange || 'binance').toLowerCase();
      const pair         = exch === 'gate' ? toGateSymbol(symbol) : symbol;
      const fetchCandles = exch === 'gate' ? fetchGateCandles : fetchBinanceCandles;
      try {
        const data = await analyzeZones(pair, fetchCandles);
        if (!data) return { symbol, data: null, error: 'candles insuficientes', saved: undefined };
        await saveToSupabase(symbol, data.suggested);
        return { symbol, data, error: null, saved: data.suggested };
      } catch (err) {
        return { symbol, data: null, error: err.message, saved: undefined };
      }
    }));

    printTable(rows);

  } else {
    const symbol   = arg || 'GENIUSUSDT';
    const exchange = (process.argv.filter(a => a !== '--dry-run')[3] || 'binance').toLowerCase();
    const pair            = exchange === 'gate' ? toGateSymbol(symbol) : symbol;
    const fetchCandles    = exchange === 'gate' ? fetchGateCandles    : fetchBinanceCandles;
    const getCurrentPrice = exchange === 'gate'
      ? () => fetchGateCurrentPrice(pair)
      : () => fetchBinanceCurrentPrice(symbol);

    // Posição atual
    const [candles100, price] = await Promise.all([
      fetchCandles(pair, 100, '1h'),
      getCurrentPrice(),
    ]);
    if (candles100.length >= 50) {
      const ma50arr = buildMa50Array(candles100);
      const ma50    = ma50arr[candles100.length - 1];
      const distPct = (price - ma50) / ma50 * 100;
      console.log(`[${symbol}]\n📍 Posição atual: preço=${price}  MA50(1h)=${ma50.toFixed(6)}  dist=${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}%`);
    }

    const data = await analyzeZones(pair, fetchCandles);
    if (!data) { console.error('Candles insuficientes.'); process.exit(1); }
    printDetailed(symbol, data);

    console.log(`\nSalvando ma50_lower_pct=${data.suggested} para ${symbol} no Supabase…`);
    await saveToSupabase(symbol, data.suggested);
    if (!DRY_RUN) console.log('✅ Salvo.');
  }
})().catch(err => { console.error('Erro:', err.message); process.exit(1); });
