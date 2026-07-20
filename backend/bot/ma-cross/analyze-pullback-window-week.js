'use strict';
/**
 * Para todas as moedas favoritadas do ma-cross, roda o backtest das últimas N
 * semanas com a config real de cada uma e compara contra duas mudanças propostas:
 *   1. requirePullback=false — remove a exigência de o candle de entrada estar
 *      mais perto da MA21 do que no candle do sinal (removia o bloqueio NO_PULLBACK,
 *      que era o maior bloqueio isolado na análise de 7 dias).
 *   2. maFilters (MA50 1h adaptativo) maxDipPct 0.5% → 1% — afrouxa o piso adaptativo
 *      (segundo maior bloqueio isolado, BELOW_ADAPTIVE_FLOOR).
 * Reporta o histograma completo de outcomes por variante e a comparação por moeda
 * entre a config atual e a combinação das duas mudanças.
 *
 * Uso: node backend/bot/ma-cross/analyze-pullback-window-week.js
 *      node backend/bot/ma-cross/analyze-pullback-window-week.js --days 14
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { runMaCrossBacktest } = require('./maCrossBacktest');
const { configFromRow } = require('./tradeConfigSchema');
const { getRequiredSpecs, INTERVAL_MS } = require('./strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DAYS_ARG = process.argv.find((a, i) => process.argv[i - 1] === '--days');
const DAYS = DAYS_ARG ? Number(DAYS_ARG) : 14;

const VARIANTS = [
  { id: 'base',        label: 'Config atual' },
  { id: 'noApproach',  label: 'entryEmaApproach.enabled=false', approachEnabled: false },
];

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function withOverrides(baseConfig, { requirePullback, maxDipPct, approachEnabled }) {
  const c = JSON.parse(JSON.stringify(baseConfig));
  if (requirePullback != null) c.execution.pullbackEntry.requirePullback = requirePullback;
  if (maxDipPct != null) {
    const filters = c.maFilters ?? [];
    const f = filters.find(f => f.period === 50 && f.interval === '1h') ?? filters[0];
    if (f) f.maxDipPct = maxDipPct;
  }
  if (approachEnabled != null) c.entryEmaApproach.enabled = approachEnabled;
  return c;
}

async function fetchCMap(symbol, exchange, config, sinceMs) {
  const specs = getRequiredSpecs(config);
  const cMap = {};
  for (const { interval, limit } of specs) {
    const ivMs = INTERVAL_MS[interval] ?? 3_600_000;
    const spanLimit = Math.ceil((Date.now() - sinceMs) / ivMs) + 60;
    const need = Math.min(1000, Math.max(limit, spanLimit));
    const candles = exchange === 'gate'
      ? await fetchGateCandles(toGateSymbol(symbol), need, interval)
      : await fetchBinanceCandles(symbol, need, interval);
    cMap[interval] = candles;
    await new Promise(r => setTimeout(r, 60));
  }
  return cMap;
}

function tallyReasons(entryLog) {
  const reasons = new Map();
  for (const e of entryLog) {
    reasons.set(e.outcome, (reasons.get(e.outcome) ?? 0) + 1);
  }
  return reasons;
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const sinceMs = Date.now() - DAYS * 86_400_000;
  const rows = await sbGet('rsi_multi_bot_state', '?strategy_id=eq.ma-cross&select=symbol,exchange,initial_capital,trade_config');
  console.log(`\n═══ Impacto do entryEmaApproach (padrão de 5 candles 4h) — ${rows.length} moedas ma-cross, últimos ${DAYS} dias ═══\n`);

  const agg = new Map(VARIANTS.map(v => [v.id, {
    label: v.label, entrySignals: 0, trades: 0, wins: 0, totalPnlUsdt: 0, reasons: new Map(),
  }]));

  // Por moeda: base vs combo (trades e PnL)
  const perSymbol = [];

  let processed = 0;
  for (const row of rows) {
    const baseConfig = configFromRow(row);
    if (!baseConfig) continue;
    const capital = Number(row.initial_capital) || 40;

    let cMap;
    try {
      cMap = await fetchCMap(row.symbol, row.exchange, baseConfig, sinceMs);
    } catch (err) {
      process.stderr.write(`  ${row.symbol}: erro ao buscar candles — ${err.message}\n`);
      continue;
    }

    const bySymbol = {};

    for (const variant of VARIANTS) {
      const config = withOverrides(baseConfig, variant);
      let result;
      try {
        result = await runMaCrossBacktest({
          symbol: row.symbol, config, exchange: row.exchange, capital, cMap, sinceMs,
        });
      } catch (err) {
        process.stderr.write(`  ${row.symbol} [${variant.id}]: erro no backtest — ${err.message}\n`);
        continue;
      }
      if (result.error) continue;

      const reasons = tallyReasons(result.entryLog ?? []);
      const total = (result.entryLog ?? []).length;
      const bought = (reasons.get('BOUGHT') ?? 0) + (reasons.get('POSITION_OPEN') ?? 0);

      const a = agg.get(variant.id);
      a.entrySignals += total;
      a.trades += result.summary?.trades ?? 0;
      a.wins += result.summary?.wins ?? 0;
      a.totalPnlUsdt += result.summary?.totalPnlUsdt ?? 0;
      for (const [reason, count] of reasons) {
        a.reasons.set(reason, (a.reasons.get(reason) ?? 0) + count);
      }

      bySymbol[variant.id] = {
        bought, trades: result.summary?.trades ?? 0, pnl: result.summary?.totalPnlUsdt ?? 0,
        notFound: reasons.get('EMA_APPROACH_NOT_FOUND') ?? 0, tooFar: reasons.get('EMA_APPROACH_TOO_FAR') ?? 0,
      };
    }

    if (bySymbol.base && bySymbol.noApproach) {
      perSymbol.push({ symbol: row.symbol, base: bySymbol.base, combo: bySymbol.noApproach });
    }

    processed++;
    process.stderr.write(`  [${processed}/${rows.length}] ${row.symbol} ok\n`);
  }

  console.log('── Por moeda: config atual vs "entryEmaApproach desligado" ──');
  perSymbol.sort((a, b) => (b.combo.trades - b.base.trades) - (a.combo.trades - a.base.trades));
  console.log('Símbolo       | Base: bloq NOT_FOUND/TOO_FAR | Base trades/PnL | Sem approach trades/PnL');
  console.log('--------------|-------------------------------|-------------------|-------------------------');
  for (const s of perSymbol) {
    const blk = `${s.base.notFound}/${s.base.tooFar}`;
    console.log(
      `${s.symbol.padEnd(13)} | ${blk.padStart(29)} | `
      + `${String(s.base.trades).padStart(2)} / $${s.base.pnl.toFixed(2).padStart(7)} | `
      + `${String(s.combo.trades).padStart(2)} / $${s.combo.pnl.toFixed(2).padStart(7)}`,
    );
  }

  console.log('\n── Agregado — todas as moedas, por variante (histograma completo de outcomes) ──');
  for (const v of VARIANTS) {
    const a = agg.get(v.id);
    const winPct = a.trades ? ((a.wins / a.trades) * 100).toFixed(0) : '—';
    const bought = (a.reasons.get('BOUGHT') ?? 0) + (a.reasons.get('POSITION_OPEN') ?? 0);
    console.log(`\n${a.label} — sinais=${a.entrySignals}, comprou=${bought}, trades=${a.trades}, win=${winPct}%, PnL=$${a.totalPnlUsdt.toFixed(2)}`);
    const sorted = [...a.reasons.entries()].filter(([r]) => r !== 'BOUGHT' && r !== 'POSITION_OPEN').sort((x, y) => y[1] - x[1]);
    for (const [reason, count] of sorted) {
      console.log(`    ${String(count).padStart(4)}  ${reason}`);
    }
  }

  console.log('\nObs.: PnL USDT é a soma do lucro/prejuízo em dólares dos trades fechados na janela, não %.');
}

main().catch(err => { console.error(err); process.exit(1); });
