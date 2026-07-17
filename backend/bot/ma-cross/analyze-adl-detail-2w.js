'use strict';
/**
 * Detalha, trade a trade, o efeito do filtro ADL(1h, divergência) nos
 * trades reais do ma-cross das últimas 2 semanas: quais seriam bloqueados,
 * quais seriam mantidos, quanto de perda seria evitado e quanto de ganho
 * seria perdido (custo de oportunidade) — por trade e por símbolo.
 *
 * Regra testada: ADL(1h) subindo E preço(1h) subindo nos últimos N candles
 * fechados (10 candles ~ 10h) antes da entrada = confirma. Qualquer outra
 * combinação = bloqueia (inclui divergência preço↑/ADL↓ e o inverso).
 *
 * Uso: node backend/bot/ma-cross/analyze-adl-detail-2w.js
 *      node backend/bot/ma-cross/analyze-adl-detail-2w.js --days 14
 *      node backend/bot/ma-cross/analyze-adl-detail-2w.js --interval 4h
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const IV_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--interval');
const IV = IV_ARG || '1h';
const INTERVAL_MS = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
const LOOKBACK = { '15m': 10, '1h': 10, '4h': 6 };
const PAD_MS = { '15m': 5 * 86_400_000, '1h': 20 * 86_400_000, '4h': 45 * 86_400_000 };

function fromMsArg() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();
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
      out.push({ openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] });
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
    open: +c[5], high: +c[3], low: +c[4], close: +c[2], volume: +c[6],
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

function adlSignal(candles) {
  const lb = LOOKBACK[IV];
  if (!candles || candles.length < lb + 20) return null;

  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const close = candles.map(c => c.close);
  const volume = candles.map(c => c.volume);

  const adl = ti.ADL.calculate({ high, low, close, volume });
  if (adl.length < lb + 1) return null;

  const adlNow = adl[adl.length - 1];
  const adlPrior = adl[adl.length - 1 - lb];
  const priceNow = close[close.length - 1];
  const pricePrior = close[close.length - 1 - lb];

  const adlRising = adlNow > adlPrior;
  const priceRising = priceNow > pricePrior;
  const avgVol = volume.slice(-lb).reduce((s, v) => s + v, 0) / lb || 1;
  const adlDeltaNorm = ((adlNow - adlPrior) / avgVol) * 100;
  const pricePctChange = pricePrior ? ((priceNow / pricePrior) - 1) * 100 : null;

  let pattern;
  if (priceRising && adlRising) pattern = 'CONVERGE_ALTA';
  else if (priceRising && !adlRising) pattern = 'DIVERGE_BAIXISTA';
  else if (!priceRising && adlRising) pattern = 'DIVERGE_ALTISTA';
  else pattern = 'CONVERGE_BAIXA';

  return {
    confirms: priceRising && adlRising,
    pattern,
    adlDeltaNorm,
    pricePctChange,
  };
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;

  const candles = await loadCandles(exchange, symbol, entryMs);
  const closed = candlesClosedBefore(candles, entryMs);
  const signal = adlSignal(closed);

  const pnl = trade.pnl_usdt != null ? +trade.pnl_usdt : null;
  const isClosed = trade.exit_time != null && pnl != null;

  return {
    symbol, exchange, entryMs,
    entryPrice: +trade.entry_price,
    pnlUsdt: pnl,
    closed: isClosed,
    signal,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();
  console.log(`\n═══ Detalhe: filtro ADL(${IV}, divergência) nos trades ma-cross ═══`);
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
  const kept = valid.filter(r => r.signal.confirms);
  const blocked = valid.filter(r => !r.signal.confirms);

  const pnlReal = valid.reduce((s, r) => s + r.pnlUsdt, 0);
  const pnlKept = kept.reduce((s, r) => s + r.pnlUsdt, 0);
  const pnlBlocked = blocked.reduce((s, r) => s + r.pnlUsdt, 0);

  const blockedLosers = blocked.filter(r => r.pnlUsdt < 0);
  const blockedWinners = blocked.filter(r => r.pnlUsdt >= 0);
  const avoidedLoss = blockedLosers.reduce((s, r) => s + r.pnlUsdt, 0);   // negativo
  const foregoneGain = blockedWinners.reduce((s, r) => s + r.pnlUsdt, 0); // positivo

  console.log('── Resumo geral ──');
  console.log(`Trades analisados: ${valid.length} (de ${trades.length} no período)`);
  console.log(`Mantidos pelo filtro (converge alta): ${kept.length}  |  Bloqueados: ${blocked.length}\n`);
  console.log(`PnL real (todos):            ${pnlReal >= 0 ? '+' : ''}${pnlReal.toFixed(2)} USDT`);
  console.log(`PnL se só mantidos:           ${pnlKept >= 0 ? '+' : ''}${pnlKept.toFixed(2)} USDT`);
  console.log(`PnL dos bloqueados:           ${pnlBlocked >= 0 ? '+' : ''}${pnlBlocked.toFixed(2)} USDT`);
  console.log(`  → perda evitada (bloqueados que eram loss): ${avoidedLoss.toFixed(2)} USDT (${blockedLosers.length} trades)`);
  console.log(`  → ganho perdido (bloqueados que eram win):  +${foregoneGain.toFixed(2)} USDT (${blockedWinners.length} trades)`);
  console.log(`  → efeito líquido do filtro: ${(pnlKept - pnlReal >= 0 ? '+' : '')}${(pnlKept - pnlReal).toFixed(2)} USDT\n`);

  const winRateKept = kept.length ? (kept.filter(r => r.pnlUsdt >= 0).length / kept.length * 100) : 0;
  const winRateBlocked = blocked.length ? (blocked.filter(r => r.pnlUsdt >= 0).length / blocked.length * 100) : 0;
  console.log(`Win rate mantidos: ${winRateKept.toFixed(0)}%  |  Win rate bloqueados: ${winRateBlocked.toFixed(0)}%\n`);

  // Por símbolo
  const bySym = new Map();
  for (const r of valid) {
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, { n: 0, kept: 0, blocked: 0, pnlReal: 0, pnlKept: 0 });
    const s = bySym.get(r.symbol);
    s.n++;
    s.pnlReal += r.pnlUsdt;
    if (r.signal.confirms) { s.kept++; s.pnlKept += r.pnlUsdt; }
    else s.blocked++;
  }
  console.log('── Por símbolo (ordenado por PnL real, piores primeiro) ──');
  console.log('Símbolo     | Trades | Mantidos | Bloq | PnL real | PnL c/ filtro');
  console.log('------------|--------|----------|------|----------|---------------');
  for (const [sym, s] of [...bySym.entries()].sort((a, b) => a[1].pnlReal - b[1].pnlReal)) {
    console.log(
      `${sym.padEnd(11)} | ${String(s.n).padStart(6)} | ${String(s.kept).padStart(8)} | ${String(s.blocked).padStart(4)} | ${s.pnlReal.toFixed(2).padStart(8)} | ${s.pnlKept.toFixed(2).padStart(13)}`,
    );
  }

  console.log('\n── Piores trades BLOQUEADOS pelo filtro (perda evitada) ──');
  for (const r of [...blockedLosers].sort((a, b) => a.pnlUsdt - b.pnlUsdt).slice(0, 12)) {
    const s = r.signal;
    console.log(
      `  ${r.symbol.padEnd(11)} ${fmtDt(r.entryMs)}  PnL ${r.pnlUsdt.toFixed(2).padStart(7)}  |  preço ${fmtPct(s.pricePctChange)}  ADL ${fmtPct(s.adlDeltaNorm)}  → ${s.pattern}`,
    );
  }

  if (blockedWinners.length) {
    console.log('\n── Trades VENCEDORES que o filtro teria bloqueado (custo de oportunidade) ──');
    for (const r of [...blockedWinners].sort((a, b) => b.pnlUsdt - a.pnlUsdt)) {
      const s = r.signal;
      console.log(
        `  ${r.symbol.padEnd(11)} ${fmtDt(r.entryMs)}  PnL +${r.pnlUsdt.toFixed(2).padStart(6)}  |  preço ${fmtPct(s.pricePctChange)}  ADL ${fmtPct(s.adlDeltaNorm)}  → ${s.pattern}`,
      );
    }
  }

  console.log('\n── Melhores trades MANTIDOS pelo filtro ──');
  for (const r of [...kept].sort((a, b) => b.pnlUsdt - a.pnlUsdt).slice(0, 8)) {
    const s = r.signal;
    console.log(
      `  ${r.symbol.padEnd(11)} ${fmtDt(r.entryMs)}  PnL ${(r.pnlUsdt >= 0 ? '+' : '') + r.pnlUsdt.toFixed(2).padStart(6)}  |  preço ${fmtPct(s.pricePctChange)}  ADL ${fmtPct(s.adlDeltaNorm)}  → ${s.pattern}`,
    );
  }

  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: erro — ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
