'use strict';
/**
 * Para cada trade real do ma-cross fechado nas ultimas 2 semanas, mede a
 * MAIOR alta que o preco chegou a atingir entre a entrada e a saida (MFE —
 * maximum favorable excursion), usando candles finos (5m). Compara com o
 * resultado real do trade pra responder: "os trades que fecharam no
 * prejuizo chegaram a subir 2%/3% antes de reverter?" — ou seja, se um
 * take-profit fixo de 2%/3% teria travado ganho antes da saida (normalmente
 * MA_CROSS_EXIT_FALLBACK) reverter o trade pra negativo.
 *
 * Uso: node backend/bot/ma-cross/analyze-mfe-takeprofit-2w.js
 *      node backend/bot/ma-cross/analyze-mfe-takeprofit-2w.js --days 14
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FINE_IV = '5m';
const FINE_IV_MS = 300_000;
const THRESHOLDS = [1, 1.5, 2, 2.5, 3, 4, 5];

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
function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '—';
  const min = ms / 60_000;
  if (min < 60) return `${min.toFixed(0)}min`;
  return `${(min / 60).toFixed(1)}h`;
}

/** Simula: se o preço atinge o alvo de TP antes da saída real, "vende" lá
 *  (ganho = tpPct, menos aproximação de fee/slippage já embutida no pnl_pct
 *  real não é replicada aqui — é uma estimativa bruta em cima do preço). */
function simulateTp(candlesInTrade, entryPrice, tpPct, realPnlPct) {
  const target = entryPrice * (1 + tpPct / 100);
  for (const c of candlesInTrade) {
    if (c.high >= target) return tpPct;
  }
  return realPnlPct;
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

  return {
    symbol, exchange, entryMs, exitMs, entryPrice,
    durationMs: exitMs - entryMs,
    pnlPct, pnlUsdt,
    mfePct,
    inTrade,
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
  console.log(`\n═══ MFE (alta máxima durante o trade) vs take-profit fixo — trades ma-cross ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&entry_time=not.is.null&pnl_pct=not.is.null&order=entry_time.asc`,
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
  const realPnlUsdtTotal = valid.reduce((s, r) => s + r.pnlUsdt, 0);
  const winsReal = valid.filter(r => r.pnlPct >= 0).length;

  console.log('── Resumo geral ──');
  console.log(`Trades analisados: ${valid.length} (de ${trades.length} no período)`);
  console.log(`PnL real: soma pct ${fmtPct(realPnlPctTotal)}  |  soma USDT ${realPnlUsdtTotal.toFixed(2)}  |  win rate ${(winsReal / valid.length * 100).toFixed(0)}%`);
  console.log(`Duração média do trade: ${fmtDur(valid.reduce((s, r) => s + r.durationMs, 0) / valid.length)}\n`);

  // ── Quantos perdedores chegaram a subir 2%/3%+ antes de reverter? ──
  const losers = valid.filter(r => r.pnlPct < 0);
  console.log(`── Perdedores (${losers.length} trades) que chegaram a subir X% antes de reverter e fechar no prejuízo ──`);
  console.log('Alta mínima | Perdedores que chegaram lá | % dos perdedores');
  console.log('------------|---------------------------|------------------');
  for (const th of THRESHOLDS) {
    const reached = losers.filter(r => r.mfePct >= th);
    console.log(`>= ${String(th).padStart(4)}%   | ${String(reached.length).padStart(25)} | ${(losers.length ? reached.length / losers.length * 100 : 0).toFixed(0).padStart(15)}%`);
  }

  // ── Simulação: take-profit fixo em X% ──
  console.log('\n── Simulação: vender automaticamente ao atingir take-profit fixo de X% ──');
  console.log('TP     | PnL simulado (soma pct) | Δ vs real | Win rate simulado | Trades que bateram o TP');
  console.log('-------|--------------------------|-----------|--------------------|------------------------');
  for (const th of THRESHOLDS) {
    const simPct = valid.map(r => simulateTp(r.inTrade, r.entryPrice, th, r.pnlPct));
    const simTotal = simPct.reduce((s, v) => s + v, 0);
    const simWins = simPct.filter(v => v >= 0).length;
    const hitCount = valid.filter(r => r.mfePct >= th).length;
    const delta = simTotal - realPnlPctTotal;
    console.log(
      `+${String(th).padStart(4)}% | ${fmtPct(simTotal).padStart(24)} | ${(delta >= 0 ? '+' : '') + delta.toFixed(2) + 'pp'.padStart(0)}`.padEnd(0)
      + ` | ${(simWins / valid.length * 100).toFixed(0).padStart(18)}% | ${String(hitCount).padStart(23)}`,
    );
  }

  // ── Detalhe dos perdedores que quase foram ganhadores ──
  console.log('\n── Perdedores que chegaram a subir >= 2% (melhores candidatos a take-profit) ──');
  console.log('Símbolo     | Entrada           | Duração | MFE (alta max) | PnL real | Motivo saída');
  console.log('------------|-------------------|---------|----------------|----------|-------------------------');
  for (const r of [...losers].filter(r => r.mfePct >= 2).sort((a, b) => b.mfePct - a.mfePct)) {
    console.log(
      `${r.symbol.padEnd(11)} | ${fmtDt(r.entryMs).padEnd(17)} | ${fmtDur(r.durationMs).padStart(7)} | ${fmtPct(r.mfePct).padStart(14)} | ${fmtPct(r.pnlPct).padStart(8)} | ${r.exitReason ?? '—'}`,
    );
  }

  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
