'use strict';

const router = require('express').Router();
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { closedCandlesOnly } = require('../bot/ma-cross/strategyEngine');
const { simulateBbMedianTrendTrades, DEFAULT_MEDIAN_LOOKBACK } = require('../utils/bbMedianTrendTrades');
const { buildBollingerMedianTrendFilterName } = require('../utils/filterNames');
const { ALL_INTERVALS, BB_PERIODS, BB_STD_DEVS } = require('../bot/bollinger-bands/tradeConfigSchema');
const bbMedianTrendCache = require('../cache/bbMedianTrendCache');

const CONCURRENCY = 20;

// Mesmos intervalos/período/desvio padrão aceitos pelo seletor de entrada do favorito
// Bollinger Bands (ver backend/bot/bollinger-bands/tradeConfigSchema.js).
const ALLOWED_INTERVALS = new Set(ALL_INTERVALS);
const ALLOWED_PERIODS = new Set(BB_PERIODS);
const ALLOWED_STD_DEVS = new Set(BB_STD_DEVS);
const ALLOWED_LOOKBACKS = new Set([50, 100, 150, 200, 300, 700]);
const ALLOWED_SIDES = new Set(['pos', 'neg', 'all']);
/** Abaixo disso a média não é confiável (1-2 trades podem ser puro outlier). */
const MIN_TRADES = 2;

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    });
  }
  return results;
}

function avgPct(list) {
  if (!list.length) return null;
  return list.reduce((s, v) => s + v, 0) / list.length;
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

/**
 * Trades teóricos de mean-reversion na Bollinger Band (compra na banda inferior, vende na
 * superior) filtrados pela regra de tendência da linha mediana (ver
 * backend/utils/bbMedianTrendTrades.js) — mesma regra do bot real (entry.medianTrendFilter em
 * backend/bot/bollinger-bands/strategyEngine.js), simulada nos últimos `lookback` candles
 * fechados. Ao contrário do bbwidth (que mede distância entre as bandas), aqui o que importa
 * é quantos trades a regra teria feito e qual a média de ganho/perda deles.
 *
 * `side` escolhe que subconjunto de trades entra na média exibida/usada pra ordenar: só
 * ganhos (pos, padrão), só perdas (neg) ou todos (all) — winRatePct/totalTrades sempre
 * refletem TODOS os trades simulados, independente do side escolhido.
 *
 * GET /services/bollinger-median-trend-filter?interval=15m&period=20&stdDev=2&lookback=700&side=pos&order=best
 */
router.get('/bollinger-median-trend-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '15m';
    const period = parseInt(req.query.period ?? '20', 10);
    const stdDev = parseFloat(req.query.stdDev ?? '2');
    const lookback = parseInt(req.query.lookback ?? '700', 10);
    const side = ALLOWED_SIDES.has(req.query.side) ? req.query.side : 'pos';
    const order = req.query.order === 'worst' ? 'worst' : 'best';

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!ALLOWED_PERIODS.has(period)) {
      return res.status(400).json({ error: 'período suportado: 10, 20 ou 30' });
    }
    if (!ALLOWED_STD_DEVS.has(stdDev)) {
      return res.status(400).json({ error: 'desvio padrão suportado: 1, 2 ou 3' });
    }
    if (!ALLOWED_LOOKBACKS.has(lookback)) {
      return res.status(400).json({ error: 'lookback suportado: 50, 100, 150, 200, 300 ou 700' });
    }

    const name = buildBollingerMedianTrendFilterName(interval, period, stdDev, lookback, side);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = bbMedianTrendCache.matchesCachedPreset({ interval, period, stdDev, lookback });
    if (presetKey) {
      const cached = await bbMedianTrendCache.getCachedResult(symbols, presetKey, { force, side, order });
      if (cached) return res.json({ ...cached, name });
    }

    const minCandles = period + DEFAULT_MEDIAN_LOOKBACK + 5;
    const limit = lookback + minCandles;

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles: raw } = await getCandlesForScreening(symbol, interval, limit);
        const candles = closedCandlesOnly(raw);
        if (!candles?.length || candles.length < minCandles) return null;

        const trades = simulateBbMedianTrendTrades(candles, { period, stdDev, tradeWindow: lookback });
        if (!trades.length) return null;

        const pnls = trades.map(t => t.pnlPct);
        const wins = pnls.filter(p => p > 0);
        const losses = pnls.filter(p => p <= 0);

        const sideList = side === 'pos' ? wins : side === 'neg' ? losses : pnls;
        if (sideList.length < MIN_TRADES) return null;

        const last = candles[candles.length - 1];

        return {
          symbol,
          avgPct: round2(avgPct(sideList)),
          avgWinPct: round2(avgPct(wins)),
          avgLossPct: round2(avgPct(losses)),
          avgAllPct: round2(avgPct(pnls)),
          totalTrades: trades.length,
          winTrades: wins.length,
          lossTrades: losses.length,
          winRatePct: round2((wins.length / trades.length) * 100),
          close: parseFloat(last.close),
        };
      } catch (err) {
        console.warn(`[bollinger-median-trend-filter] ${symbol}:`, err.message);
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => (order === 'best' ? b.avgPct - a.avgPct : a.avgPct - b.avgPct));

    const details = {};
    for (const row of matched) {
      const { symbol, ...meta } = row;
      details[symbol] = meta;
    }

    res.json({
      name,
      list: matched.map(r => r.symbol),
      details,
      interval,
      period,
      stdDev,
      lookback,
      side,
      order,
      scannedAt: Date.now(),
    });
  } catch (err) {
    console.error('[bollinger-median-trend-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
