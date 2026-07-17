'use strict';
/**
 * Para cada trade real do ma-cross nas ultimas 2 semanas, acha o fundo (menor
 * low) num lookback antes da entrada e mede quanto o preco ja tinha subido
 * (recuperado) daquele fundo ate o preco de entrada. Cruza a recuperacao com
 * o resultado (PnL) do trade e simula exigir uma recuperacao minima (2%, 3%,
 * etc.) como filtro extra de entrada, pra ver se teria melhorado o resultado.
 *
 * Uso: node backend/bot/ma-cross/analyze-dip-recovery-2w.js
 *      node backend/bot/ma-cross/analyze-dip-recovery-2w.js --days 14
 *      node backend/bot/ma-cross/analyze-dip-recovery-2w.js --interval 1h --lookback 24
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const IV_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--interval');
const IV = IV_ARG || '1h';
const LOOKBACK_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--lookback');
const LOOKBACK = LOOKBACK_ARG ? Number(LOOKBACK_ARG) : 24; // candles antes da entrada p/ achar o fundo

const INTERVAL_MS = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
const PAD_MS = { '15m': 5 * 86_400_000, '1h': 10 * 86_400_000, '4h': 30 * 86_400_000 };

const THRESHOLDS = [0, 1, 2, 3, 4, 5];

function fromMsArg() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(fromArg.includes('T') ? fromArg : `${fromArg}T00:00:00-03:00`).getTime();
  const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
  const days = daysArg ? Number(daysArg) : 14;
  return Date.now() - days * 86_400_000;
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
  const from = Math.floor(startMs / 1000);
  const to = Math.floor(endMs / 1000);
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
  const raw = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    openTime: Number(c[0]) * 1000,
    open: +c[5], high: +c[3], low: +c[4], close: +c[2],
  }));
}

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const cCache = new Map();

async function loadCandles(exchange, symbol, entryMs) {
  const key = `${exchange}:${symbol}`;
  if (cCache.has(key)) return cCache.get(key);
  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const end = Date.now() + 86_400_000;
  const candles = await fetcher(symbol, IV, entryMs - PAD_MS[IV], end);
  cCache.set(key, candles);
  return candles;
}

function candlesClosedBefore(candles, entryMs) {
  const ms = INTERVAL_MS[IV];
  return (candles ?? []).filter(c => c.openTime + ms <= entryMs);
}

/** Acha o menor low nos ultimos LOOKBACK candles fechados antes da entrada, e
 *  calcula quanto o preco de entrada ja recuperou desse fundo. */
function dipRecoverySignal(closed, entryPrice) {
  if (!closed || closed.length < LOOKBACK) return null;
  const window = closed.slice(-LOOKBACK);
  let low = Infinity;
  let lowAt = null;
  for (const c of window) {
    if (c.low < low) { low = c.low; lowAt = c.openTime; }
  }
  if (!Number.isFinite(low) || low <= 0) return null;

  const recoveryPct = ((entryPrice - low) / low) * 100;
  return { low, lowAt, recoveryPct };
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const entryPrice = +trade.entry_price;

  const candles = await loadCandles(exchange, symbol, entryMs);
  const closed = candlesClosedBefore(candles, entryMs);
  const signal = dipRecoverySignal(closed, entryPrice);

  const pnl = trade.pnl_usdt != null ? +trade.pnl_usdt : null;
  const isClosed = trade.exit_time != null && pnl != null;

  return { symbol, exchange, entryMs, entryPrice, pnlUsdt: pnl, closed: isClosed, signal };
}

function bucketLabel(pct) {
  if (pct < 0) return '< 0% (ainda caindo)';
  if (pct < 1) return '0% – 1%';
  if (pct < 2) return '1% – 2%';
  if (pct < 3) return '2% – 3%';
  if (pct < 5) return '3% – 5%';
  return '>= 5%';
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();
  console.log(`\n═══ Recuperação pós-fundo (dip) nos trades ma-cross — ${IV}, lookback ${LOOKBACK} candles ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      results.push(await analyzeTrade(t));
      process.stderr.write(' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const valid = results.filter(r => !r.error && r.signal && r.closed);
  const pnlReal = valid.reduce((s, r) => s + r.pnlUsdt, 0);
  const winsReal = valid.filter(r => r.pnlUsdt >= 0).length;

  console.log('── Resumo geral ──');
  console.log(`Trades fechados analisados: ${valid.length} (de ${trades.length} no período)`);
  console.log(`PnL real total: ${pnlReal >= 0 ? '+' : ''}${pnlReal.toFixed(2)} USDT  |  Win rate real: ${valid.length ? (winsReal / valid.length * 100).toFixed(0) : 0}%\n`);

  // ── Por faixa de recuperação ──
  const buckets = new Map();
  for (const r of valid) {
    const label = bucketLabel(r.signal.recoveryPct);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(r);
  }
  const order = ['< 0% (ainda caindo)', '0% – 1%', '1% – 2%', '2% – 3%', '3% – 5%', '>= 5%'];

  console.log('── PnL/win rate por faixa de recuperação do fundo até a entrada ──');
  console.log('Faixa                 | Trades | Wins | Win rate | PnL total | PnL médio');
  console.log('-----------------------|--------|------|----------|-----------|----------');
  for (const label of order) {
    const list = buckets.get(label);
    if (!list || !list.length) continue;
    const wins = list.filter(r => r.pnlUsdt >= 0).length;
    const pnlTotal = list.reduce((s, r) => s + r.pnlUsdt, 0);
    const pnlAvg = pnlTotal / list.length;
    console.log(
      `${label.padEnd(22)} | ${String(list.length).padStart(6)} | ${String(wins).padStart(4)} | ${(wins / list.length * 100).toFixed(0).padStart(7)}% | ${pnlTotal.toFixed(2).padStart(9)} | ${pnlAvg.toFixed(2).padStart(8)}`,
    );
  }

  // ── Simulação: exigir recuperação mínima X% como filtro de entrada ──
  console.log('\n── Simulação: exigir recuperação mínima do fundo antes de entrar ──');
  console.log('Mínimo | Mantidos | Bloqueados | Win rate mantidos | PnL mantidos | PnL bloqueados | Efeito líquido');
  console.log('-------|----------|------------|--------------------|--------------|-----------------|----------------');
  for (const th of THRESHOLDS) {
    const kept = valid.filter(r => r.signal.recoveryPct >= th);
    const blocked = valid.filter(r => r.signal.recoveryPct < th);
    const pnlKept = kept.reduce((s, r) => s + r.pnlUsdt, 0);
    const pnlBlocked = blocked.reduce((s, r) => s + r.pnlUsdt, 0);
    const winRateKept = kept.length ? (kept.filter(r => r.pnlUsdt >= 0).length / kept.length * 100) : 0;
    const delta = pnlKept - pnlReal;
    console.log(
      `>= ${String(th).padStart(2)}%  | ${String(kept.length).padStart(8)} | ${String(blocked.length).padStart(10)} | ${winRateKept.toFixed(0).padStart(17)}% | ${pnlKept.toFixed(2).padStart(12)} | ${pnlBlocked.toFixed(2).padStart(15)} | ${(delta >= 0 ? '+' : '') + delta.toFixed(2)}`,
    );
  }

  // ── Detalhe trade a trade ──
  console.log('\n── Detalhe (ordenado por recuperação do fundo) ──');
  console.log('Símbolo     | Entrada           | Recuperação | Fundo         | PnL');
  console.log('------------|-------------------|-------------|---------------|--------');
  for (const r of [...valid].sort((a, b) => a.signal.recoveryPct - b.signal.recoveryPct)) {
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(17)} | ${fmtPct(r.signal.recoveryPct).padStart(11)} | ${fmtDt(r.signal.lowAt).padEnd(13)} | ${(r.pnlUsdt >= 0 ? '+' : '') + r.pnlUsdt.toFixed(2)}`,
    );
  }

  const skipped = results.filter(r => !r.error && (!r.signal || !r.closed));
  if (skipped.length) {
    console.log(`\n(${skipped.length} trade(s) sem sinal válido ou ainda aberto(s), excluídos das estatísticas)`);
  }
  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: erro — ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
