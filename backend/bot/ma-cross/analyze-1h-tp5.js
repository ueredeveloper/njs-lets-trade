'use strict';
/**
 * Para todos os trades reais do ma-cross fechados (entrada configurada em 1h — que hoje é
 * o padrão em todos os símbolos ativos), simula: "e se a saída fosse sempre um take-profit
 * fixo de 5% (Venda — Alvo % histórico BB), em vez do exit real (MA cross / stop / etc)?"
 *
 * Usa candles finos (5m) entre entrada e saída real para achar a maior alta (MFE) e checar
 * se o preço bateu +5% antes da saída real ocorrer. Se bateu, a venda simulada acontece lá
 * (5%); senão, mantém o resultado real do trade (o TP nunca teria disparado).
 *
 * Uso: node backend/bot/ma-cross/analyze-1h-tp5.js
 *      node backend/bot/ma-cross/analyze-1h-tp5.js --days 30
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FINE_IV = '5m';
const FINE_IV_MS = 300_000;
const TP_PCT = 5;

function fromMsArg() {
  const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
  const days = daysArg ? Number(daysArg) : 60;
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
function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '—';
  const min = ms / 60_000;
  if (min < 60) return `${min.toFixed(0)}min`;
  return `${(min / 60).toFixed(1)}h`;
}

function simulateTp5(candlesInTrade, entryPrice, realPnlPct) {
  const target = entryPrice * (1 + TP_PCT / 100);
  for (const c of candlesInTrade) {
    if (c.high >= target) return { pct: TP_PCT, hit: true };
  }
  return { pct: realPnlPct, hit: false };
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exitMs = new Date(trade.exit_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;
  const entryPrice = +trade.entry_price;
  const pnlPct = trade.pnl_pct != null ? +trade.pnl_pct : null;
  const pnlUsdt = trade.pnl_usdt != null ? +trade.pnl_usdt : null;

  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const raw = await fetcher(symbol, FINE_IV, entryMs - FINE_IV_MS, exitMs + FINE_IV_MS);
  const inTrade = raw.filter(c => c.openTime >= entryMs - FINE_IV_MS && c.openTime <= exitMs);

  if (!inTrade.length) return { symbol, exchange, error: 'sem candles 5m no período do trade' };

  const maxHigh = Math.max(...inTrade.map(c => c.high));
  const mfePct = ((maxHigh - entryPrice) / entryPrice) * 100;
  const sim = simulateTp5(inTrade, entryPrice, pnlPct);

  return {
    symbol, exchange, entryMs, exitMs, entryPrice,
    durationMs: exitMs - entryMs,
    pnlPct, pnlUsdt, mfePct,
    simPct: sim.pct, tpHit: sim.hit,
    exitReason: trade.exit_reason,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();

  console.log(`\n═══ Trades ma-cross (entrada 1h) — real vs "Venda alvo 5% histórico BB" ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&entry_time=not.is.null&exit_time=not.is.null&pnl_pct=not.is.null&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross fechado neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      const r = await analyzeTrade(t);
      results.push(r);
      process.stderr.write(r.error ? ` skip (${r.error})\n` : ' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message });
    }
  }

  const valid = results.filter(r => !r.error);
  const realPnlPctTotal = valid.reduce((s, r) => s + r.pnlPct, 0);
  const realPnlUsdtTotal = valid.reduce((s, r) => s + (r.pnlUsdt ?? 0), 0);
  const winsReal = valid.filter(r => r.pnlPct >= 0).length;

  const simPnlPctTotal = valid.reduce((s, r) => s + r.simPct, 0);
  const winsSim = valid.filter(r => r.simPct >= 0).length;
  const hitCount = valid.filter(r => r.tpHit).length;

  console.log('\n── Resumo geral ──');
  console.log(`Trades analisados: ${valid.length} (de ${trades.length} no período)`);
  console.log(`REAL : soma pct ${fmtPct(realPnlPctTotal)}  |  soma USDT ${realPnlUsdtTotal.toFixed(2)}  |  win rate ${(winsReal / valid.length * 100).toFixed(0)}%`);
  console.log(`SIM 5%: soma pct ${fmtPct(simPnlPctTotal)}  |  win rate ${(winsSim / valid.length * 100).toFixed(0)}%  |  bateram +5% antes da saída real: ${hitCount}/${valid.length} (${(hitCount / valid.length * 100).toFixed(0)}%)`);
  console.log(`Δ soma pct (sim - real): ${fmtPct(simPnlPctTotal - realPnlPctTotal)}`);

  console.log('\n── Detalhe por trade ──');
  console.log('Símbolo     | Entrada           | Duração | MFE      | PnL real | PnL sim 5% | Bateu TP | Motivo saída real');
  console.log('------------|-------------------|---------|----------|----------|------------|----------|-------------------------');
  for (const r of valid) {
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(17)} | ${fmtDur(r.durationMs).padStart(7)} | `
      + `${fmtPct(r.mfePct).padStart(8)} | ${fmtPct(r.pnlPct).padStart(8)} | ${fmtPct(r.simPct).padStart(10)} | `
      + `${(r.tpHit ? 'sim' : 'não').padStart(8)} | ${r.exitReason ?? '—'}`,
    );
  }

  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
