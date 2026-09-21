'use strict';

/**
 * Backtest dos "Setups Matadores" (backend/bot/candle-setups) — Estatísticas → aba Setups.
 * Uma moeda (`symbol`) ou TODO o mercado USDT da Binance (sem `symbol`), só COMPRA, 15m por padrão.
 * Usa os mesmos detectores/simulador do futuro bot (nada é recalculado à parte).
 *
 * Um setup por vez em cada moeda (posição/ordem pendente ativa bloqueia novos sinais do MESMO setup);
 * os setups selecionados rodam independentes uns dos outros sobre os mesmos candles.
 */

const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const getTickers = require('../binance/cachedTicker24hr');
const { getGateFavoriteSymbols } = require('../gate/getGateFavoriteSymbols');
const { getAllGateCurrencies } = require('../gate/getAllGateCurrencies');
const { toSeries, createDetector, intervalMs } = require('../bot/candle-setups/setupDetectors');
const { simulateSetupTrade } = require('../bot/candle-setups/setupSimulator');
const { normalizeCandleSetupsOptions, SETUP_LABELS } = require('../bot/candle-setups/tradeConfigSchema');

const CONCURRENCY = 15;
const DEFAULT_MAX_ROWS = 300;
const BY_SYMBOL_MAX_ROWS = 40;

/** Faixas de risco (R em % do preço) — mostra onde o custo come o resultado. */
const RISK_BUCKETS = [
  { label: '< 1%', max: 1 },
  { label: '1 – 1,5%', max: 1.5 },
  { label: '1,5 – 2%', max: 2 },
  { label: '2 – 3%', max: 3 },
  { label: '≥ 3%', max: Infinity },
];

const round = (v, d = 2) => parseFloat(Number(v).toFixed(d));

function emptyCounters() {
  return { signals: 0, blockedSmallRisk: 0, blockedBigRisk: 0, notFilled: { expired: 0, stopBreak: 0, pending: 0, invalidRisk: 0 } };
}

/**
 * Roda os setups selecionados sobre candles já carregados (puro — usado pelos testes).
 * @returns {{ candles:number, from:string|null, to:string|null, perSetup:Object<string,{counters:object,trades:object[],pending:object[]}> }}
 */
function runSetupsOnCandles(candles, options) {
  const opts = options.setups ? options : normalizeCandleSetupsOptions(options);
  const s = toSeries(candles);
  const perSetup = {};
  for (const id of opts.setups) {
    const counters = emptyCounters();
    const trades = [];
    const pending = [];
    perSetup[id] = { counters, trades, pending };
    if (s.n < 10) continue;
    const params = opts.params[id];
    const det = createDetector(id, s, params, opts.common, opts.interval);
    let busyUntil = -1;
    for (let i = Math.max(det.warmup, 3); i < s.n; i++) {
      if (i <= busyUntil) continue;
      const sig = det.detect(i);
      if (!sig) continue;
      counters.signals++;
      if (opts.common.minRiskPct > 0 && sig.riskPct < opts.common.minRiskPct) { counters.blockedSmallRisk++; continue; }
      if (opts.common.maxRiskPct > 0 && sig.riskPct > opts.common.maxRiskPct) { counters.blockedBigRisk++; continue; }
      const sim = simulateSetupTrade(s, sig, {
        common: opts.common, targets: params.exit.targets, costs: opts.costs, positionSizeUsd: opts.positionSizeUsd,
      });
      if (!sim.filled) {
        counters.notFilled[sim.reason]++;
        busyUntil = sim.endIndex;
        if (sim.reason === 'pending') {
          pending.push({
            setup: id, signalDate: new Date(sig.signalTime).toISOString(),
            triggerPrice: sig.trigger, stopPrice: sig.stop, riskPct: round(sig.riskPct), levels: sig.levels,
          });
        }
        continue;
      }
      trades.push(sim.trade);
      busyUntil = sim.exitIndex + opts.common.cooldownCandles;
      if (sim.open) break;
    }
  }
  return {
    candles: s.n,
    from: s.n ? new Date(s.t[0]).toISOString() : null,
    to: s.n ? new Date(s.t[s.n - 1]).toISOString() : null,
    perSetup,
  };
}

/** Métricas de um conjunto de trades (open entra marcado a mercado, como no RSI Momentum). */
function summarizeTrades(trades) {
  const n = trades.length;
  if (!n) {
    return { trades: 0, closed: 0, wins: 0, winRatePct: null, avgPnlPct: null, avgR: null, totalPnlUsd: 0,
      profitFactor: null, target: 0, partial: 0, stop: 0, time: 0, open: 0, avgRiskPct: null, avgHoldMs: null,
      firstTargetPct: null, allTargetsPct: null };
  }
  const closed = trades.filter((t) => t.outcome !== 'open');
  const wins = closed.filter((t) => t.pnlPct > 0).length;
  const grossWin = trades.reduce((sum, t) => sum + (t.pnlPct > 0 ? t.pnlPct : 0), 0);
  const grossLoss = trades.reduce((sum, t) => sum + (t.pnlPct < 0 ? -t.pnlPct : 0), 0);
  const count = (o) => trades.filter((t) => t.outcome === o).length;
  return {
    trades: n,
    closed: closed.length,
    wins,
    winRatePct: closed.length ? round((wins / closed.length) * 100, 1) : null,
    avgPnlPct: round(trades.reduce((sum, t) => sum + t.pnlPct, 0) / n),
    avgR: round(trades.reduce((sum, t) => sum + t.rNet, 0) / n),
    totalPnlUsd: round(trades.reduce((sum, t) => sum + t.pnlUsd, 0)),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    target: count('target'),
    partial: count('partial'),
    stop: count('stop'),
    time: count('time'),
    open: count('open'),
    avgRiskPct: round(trades.reduce((sum, t) => sum + t.riskPct, 0) / n),
    avgHoldMs: Math.round(trades.reduce((sum, t) => sum + t.holdMs, 0) / n),
    firstTargetPct: closed.length ? round((closed.filter((t) => t.targetsHit >= 1).length / closed.length) * 100, 1) : null,
    allTargetsPct: closed.length ? round((count('target') / closed.length) * 100, 1) : null,
  };
}

function computeRiskBuckets(trades) {
  const buckets = RISK_BUCKETS.map((b) => ({ ...b, list: [] }));
  for (const t of trades) (buckets.find((b) => t.riskPct < b.max) ?? buckets[buckets.length - 1]).list.push(t);
  return buckets.map((b) => {
    const sm = summarizeTrades(b.list);
    return { label: b.label, trades: sm.trades, winRatePct: sm.winRatePct, avgPnlPct: sm.avgPnlPct, avgR: sm.avgR };
  });
}

function computeBySymbol(trades) {
  const map = new Map();
  for (const t of trades) {
    if (!map.has(t.symbol)) map.set(t.symbol, []);
    map.get(t.symbol).push(t);
  }
  return [...map.entries()]
    .map(([symbol, list]) => {
      const sm = summarizeTrades(list);
      return { symbol, source: list[0].source, trades: sm.trades, winRatePct: sm.winRatePct, avgPnlPct: sm.avgPnlPct, avgR: sm.avgR, totalPnlUsd: sm.totalPnlUsd };
    })
    .sort((a, b) => b.avgPnlPct - a.avgPnlPct)
    .slice(0, BY_SYMBOL_MAX_ROWS);
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

/** Descarta o candle ainda em formação (o backtest só decide em candle FECHADO). */
function dropOpenCandle(candles, interval) {
  if (!candles?.length) return [];
  const last = candles[candles.length - 1];
  const closeMs = Number(last.closeTime) || (Number(last.openTime) + intervalMs(interval));
  return closeMs > Date.now() ? candles.slice(0, -1) : candles;
}

async function loadClosedCandles(symbol, source, interval, candleCount) {
  const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
  return dropOpenCandle(await fetchCandles(symbol, interval, candleCount), interval);
}

/**
 * @param {object} rawOptions
 * @param {string} [rawOptions.symbol]  Uma moeda; sem ele varre o mercado USDT da Binance.
 * @param {string} [rawOptions.source]  'gate' pra rodar a moeda na Gate.io.
 * @param {number} [rawOptions.minVolumeUsdt=0]   Volume 24h mínimo (modo mercado).
 * @param {boolean} [rawOptions.includeGateFavorites=false] Inclui favoritos Gate (modo mercado).
 * @param {number} [rawOptions.maxRows=300]       Máx. de ocorrências devolvidas (agregados usam todas).
 * Demais campos: ver normalizeCandleSetupsOptions.
 */
async function analyseCandleSetupsBacktest(rawOptions = {}) {
  const opts = normalizeCandleSetupsOptions(rawOptions);
  const maxRows = rawOptions.maxRows > 0 ? rawOptions.maxRows : DEFAULT_MAX_ROWS;
  const minVolumeUsdt = Number(rawOptions.minVolumeUsdt) > 0 ? Number(rawOptions.minVolumeUsdt) : 0;
  const singleSymbol = rawOptions.symbol ? String(rawOptions.symbol).toUpperCase() : null;

  let workItems;
  let symbolsTotal = 1;
  let symbolsBlockedByVolume = 0;
  let gateFavoritesScanned = 0;
  const volumeMap = new Map();

  if (singleSymbol) {
    workItems = [{ symbol: singleSymbol, source: rawOptions.source ?? null }];
  } else {
    const { list: allSymbols } = await getActiveUsdtPairs();
    symbolsTotal = allSymbols.length;
    try {
      const tickers = await getTickers();
      for (const t of tickers) volumeMap.set(t.symbol, Number(t.quoteVolume));
    } catch { /* fail-open: sem volume, o filtro não bloqueia nada */ }
    let symbols = allSymbols;
    if (minVolumeUsdt > 0 && volumeMap.size > 0) {
      symbols = allSymbols.filter((sym) => (volumeMap.get(sym) ?? 0) >= minVolumeUsdt);
      symbolsBlockedByVolume = allSymbols.length - symbols.length;
    }
    workItems = symbols.map((symbol) => ({ symbol, source: null }));

    if (rawOptions.includeGateFavorites) {
      try {
        const binanceSet = new Set(allSymbols);
        const favs = (await getGateFavoriteSymbols()).filter((sym) => !binanceSet.has(sym));
        const gateVol = new Map((await getAllGateCurrencies().catch(() => [])).map((c) => [c.symbol, Number(c.volume) || 0]));
        for (const sym of favs) {
          if (minVolumeUsdt > 0 && gateVol.size > 0 && (gateVol.get(sym) ?? 0) < minVolumeUsdt) continue;
          if (gateVol.has(sym)) volumeMap.set(sym, gateVol.get(sym));
          workItems.push({ symbol: sym, source: 'gate' });
        }
      } catch (err) {
        console.warn('[candle-setups-backtest] favoritos Gate ignorados:', err.message);
      }
    }
  }

  const results = await runWithConcurrency(workItems, async ({ symbol, source }) => {
    try {
      const candles = await loadClosedCandles(symbol, source, opts.interval, opts.candleCount);
      return { symbol, source, run: runSetupsOnCandles(candles, opts) };
    } catch (err) {
      if (singleSymbol) throw err;
      return null; // falha pontual por par (sem candles etc.) não derruba a varredura
    }
  }, CONCURRENCY);
  const valid = results.filter(Boolean);
  gateFavoritesScanned = valid.filter((v) => v.source === 'gate').length;

  const allOccurrences = [];
  const bySetup = [];
  const pending = [];
  for (const id of opts.setups) {
    const counters = emptyCounters();
    const trades = [];
    for (const { symbol, source, run } of valid) {
      const r = run.perSetup[id];
      if (!r) continue;
      counters.signals += r.counters.signals;
      counters.blockedSmallRisk += r.counters.blockedSmallRisk;
      counters.blockedBigRisk += r.counters.blockedBigRisk;
      for (const k of Object.keys(counters.notFilled)) counters.notFilled[k] += r.counters.notFilled[k];
      const volumeUsd = volumeMap.has(symbol) ? Number(volumeMap.get(symbol)) || 0 : null;
      for (const t of r.trades) trades.push({ symbol, source: source ?? 'binance', volumeUsd, ...t });
      for (const p of r.pending) pending.push({ symbol, source: source ?? 'binance', ...p });
    }
    allOccurrences.push(...trades);
    bySetup.push({
      setup: id,
      label: SETUP_LABELS[id],
      ...counters,
      summary: summarizeTrades(trades),
      riskBuckets: computeRiskBuckets(trades),
      bySymbol: singleSymbol ? [] : computeBySymbol(trades),
    });
  }
  allOccurrences.sort((a, b) => new Date(b.signalDate) - new Date(a.signalDate));
  pending.sort((a, b) => new Date(b.signalDate) - new Date(a.signalDate));

  const first = valid[0]?.run;
  return {
    scope: singleSymbol ? 'symbol' : 'market',
    symbol: singleSymbol,
    interval: opts.interval,
    candleCount: opts.candleCount,
    candles: first?.candles ?? 0,
    from: first?.from ?? null,
    to: first?.to ?? null,
    positionSizeUsd: opts.positionSizeUsd,
    common: opts.common,
    costs: opts.costs,
    params: Object.fromEntries(opts.setups.map((id) => [id, opts.params[id]])),
    setups: opts.setups,
    minVolumeUsdt,
    symbolsTotal,
    symbolsScanned: valid.length,
    symbolsBlockedByVolume,
    gateFavoritesScanned,
    bySetup,
    pending: pending.slice(0, 50),
    occurrences: allOccurrences.slice(0, maxRows),
    occurrencesTruncated: allOccurrences.length > maxRows,
  };
}

module.exports = { analyseCandleSetupsBacktest, runSetupsOnCandles, summarizeTrades, dropOpenCandle };
