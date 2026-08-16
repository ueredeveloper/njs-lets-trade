'use strict';
/**
 * Para os trades VENCEDORES do bollinger-bands em 3m: mede o quanto o preço ainda caiu
 * depois do sinal/compra antes de fechar no take-profit, e simula o efeito de exigir um
 * pullback de -1% (comprar só quando o preço cair 1% abaixo do preço do sinal) — se o low
 * do candle já alcança esse nível antes da saída, o trade ainda teria acontecido, só que
 * com um preço de entrada melhor (PnL% maior pro mesmo exit_price).
 *
 * Uso: node backend/bot/bollinger-bands/analyze-3m-pullback.js [--pullback-pct 1]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function argNum(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? Number(v) : def;
}
const PULLBACK_PCT = argNum('--pullback-pct', 1);

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
  const stepMs = 60_000;
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const from = Math.floor(cursor / 1000);
    const to = Math.min(Math.floor(endMs / 1000), from + 1000 * (stepMs / 1000));
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      out.push({ openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2] });
    }
    const last = Number(raw[raw.length - 1][0]) * 1000;
    if (last <= cursor) break;
    cursor = last + stepMs;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

function fmtDt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

async function analyzeTrade(trade) {
  const symbol = trade.symbol;
  const exchange = trade.exchange ?? 'binance';
  const entryPrice = parseFloat(trade.entry_price);
  const exitPrice = parseFloat(trade.exit_price);
  const signalPrice = trade.entry_signal_price != null ? parseFloat(trade.entry_signal_price) : entryPrice;
  const windowStartMs = new Date(trade.entry_signal_time ?? trade.entry_time).getTime();
  const entryMs = new Date(trade.entry_time).getTime();
  const exitMs = new Date(trade.exit_time).getTime();

  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  // 1m candles pra ter resolução fina do menor preço até a saída (3m já é o intervalo do sinal).
  const candles = await fetcher(symbol, '1m', windowStartMs, exitMs);
  if (!candles.length) return { symbol, exchange, error: 'sem candles' };

  let lowestLow = entryPrice;
  let lowestAt = null;
  for (const c of candles) {
    if (c.low < lowestLow) { lowestLow = c.low; lowestAt = c.openTime; }
  }
  const drawdownFromEntryPct = ((entryPrice - lowestLow) / entryPrice) * 100;
  const drawdownFromSignalPct = ((signalPrice - lowestLow) / signalPrice) * 100;

  // Simula pullback: compraria no primeiro candle (após o sinal) cujo low <= gatilho.
  const triggerPrice = signalPrice * (1 - PULLBACK_PCT / 100);
  let pullbackFillMs = null;
  let pullbackFillPrice = null;
  for (const c of candles) {
    if (c.openTime < windowStartMs) continue;
    if (c.low <= triggerPrice) { pullbackFillMs = c.openTime; pullbackFillPrice = Math.min(triggerPrice, c.open); break; }
  }
  const wouldFill = pullbackFillMs != null;
  const pnlRealPct = parseFloat(trade.pnl_pct);
  const pnlSimPct = wouldFill ? ((exitPrice - pullbackFillPrice) / pullbackFillPrice) * 100 : null;

  return {
    symbol, exchange, entryPrice, exitPrice, signalPrice,
    entryMs, exitMs, lowestLow, lowestAt,
    drawdownFromEntryPct, drawdownFromSignalPct,
    pnlRealPct, wouldFill, pullbackFillMs, pullbackFillPrice, pnlSimPct,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.bollinger-bands&interval=eq.3m&pnl_pct=gt.0&exit_time=not.is.null&order=entry_time.asc`,
  );

  console.log(`\n═══ bollinger-bands 3m — trades vencedores: drawdown pós-sinal e simulação de pullback -${PULLBACK_PCT}% ═══`);
  console.log(`Trades encontrados: ${trades.length}\n`);

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

  const ok = results.filter(r => !r.error);
  console.log('\nSímbolo     | Entrada         | Sinal           | Low pós-sinal   | Queda vs entrada | Queda vs sinal | PnL real | Pullback -1% preencheria? | PnL simulado');
  console.log('------------|-----------------|-----------------|-----------------|-------------------|-----------------|----------|----------------------------|-------------');
  for (const r of ok) {
    console.log(
      `${r.symbol.padEnd(11)} | ${String(r.entryPrice).padEnd(15)} | ${String(r.signalPrice).padEnd(15)} | ${String(r.lowestLow).padEnd(15)} | `
      + `${fmtPct(r.drawdownFromEntryPct).padStart(17)} | ${fmtPct(r.drawdownFromSignalPct).padStart(15)} | ${fmtPct(r.pnlRealPct).padStart(8)} | `
      + `${(r.wouldFill ? 'SIM' : 'não').padEnd(26)} | ${r.wouldFill ? fmtPct(r.pnlSimPct) : '—'}`,
    );
  }

  const withDrawdown = ok.filter(r => r.drawdownFromEntryPct >= PULLBACK_PCT);
  const fillCount = ok.filter(r => r.wouldFill).length;
  console.log(`\n── Resumo ──`);
  console.log(`Trades vencedores analisados: ${ok.length}`);
  console.log(`Caíram >= ${PULLBACK_PCT}% abaixo do preço de entrada antes de sair: ${withDrawdown.length} (${((withDrawdown.length/ok.length)*100).toFixed(0)}%)`);
  console.log(`Teriam sido preenchidos com pullback de -${PULLBACK_PCT}% do preço do sinal: ${fillCount} (${((fillCount/ok.length)*100).toFixed(0)}%)`);
  if (fillCount) {
    const filled = ok.filter(r => r.wouldFill);
    const avgReal = filled.reduce((s, r) => s + r.pnlRealPct, 0) / filled.length;
    const avgSim = filled.reduce((s, r) => s + r.pnlSimPct, 0) / filled.length;
    console.log(`PnL médio real (apenas os que preencheriam):     ${fmtPct(avgReal)}`);
    console.log(`PnL médio simulado (entrada com pullback):       ${fmtPct(avgSim)}  (Δ ${fmtPct(avgSim - avgReal)})`);
  }
  const missed = ok.filter(r => !r.wouldFill);
  if (missed.length) {
    console.log(`\nTrades que NÃO teriam disparado com o pullback (perderiam o trade todo): ${missed.map(r => r.symbol).join(', ')}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
