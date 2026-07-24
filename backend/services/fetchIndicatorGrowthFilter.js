'use strict';

const router = require('express').Router();
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { computeIndicatorGrowth } = require('../utils/indicatorGrowthEngines');
const { buildIndicatorGrowthFilterName } = require('../utils/filterNames');
const indicatorGrowthCache = require('../cache/indicatorGrowthCache');

const CANDLES_LIMIT = 1000;
const BATCH_SIZE = 20;
/** Abaixo disso a média não é confiável (1-2 ciclos podem ser puro outlier). */
const MIN_OCCURRENCES = indicatorGrowthCache.MIN_OCCURRENCES;
const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_ENGINES = new Set(['bollinger', 'rsi', 'maCross']);

function parseParams(engine, query) {
  if (engine === 'bollinger') {
    return {
      period: parseInt(query.period ?? '20', 10),
      stdDev: parseFloat(query.stdDev ?? '2'),
    };
  }
  if (engine === 'rsi') {
    return {
      period: parseInt(query.rsiPeriod ?? '14', 10),
      oversold: parseInt(query.oversold ?? '30', 10),
      overbought: parseInt(query.overbought ?? '70', 10),
    };
  }
  // maCross
  return {
    period1: parseInt(query.period1 ?? '9', 10),
    period2: parseInt(query.period2 ?? '21', 10),
    interval: query.interval ?? '4h',
  };
}

async function runInBatches(items, fn, batchSize) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    });
  }
  return results;
}

// GET /services/indicator-growth-filter?indicator=bollinger&interval=4h&period=20&stdDev=2&thresholdPct=10
router.get('/indicator-growth-filter', async (req, res) => {
  try {
    const engine = req.query.indicator;
    const interval = req.query.interval ?? '4h';
    const thresholdPct = parseFloat(req.query.thresholdPct ?? '10');

    if (!ALLOWED_ENGINES.has(engine)) {
      return res.status(400).json({ error: `indicador não suportado: ${engine}` });
    }
    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!Number.isFinite(thresholdPct)) {
      return res.status(400).json({ error: 'thresholdPct inválido' });
    }

    const params = parseParams(engine, req.query);
    const name = buildIndicatorGrowthFilterName(engine, interval, params, thresholdPct);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = indicatorGrowthCache.matchesCachedPreset({ engine, interval, params });
    if (presetKey) {
      const cached = await indicatorGrowthCache.getCachedResult(symbols, presetKey, thresholdPct, { force });
      if (cached) return res.json({ ...cached, name });
    }

    const matched = await runInBatches(symbols, async (symbol) => {
      try {
        const { candles } = await getCandlesForScreening(symbol, interval, CANDLES_LIMIT);
        const result = computeIndicatorGrowth(engine, candles, params);
        if (!result || result.totalOccurrences < MIN_OCCURRENCES) return null;
        if (result.avgAppreciationPercent < thresholdPct) return null;
        return { symbol, ...result };
      } catch (err) {
        console.error(`[indicator-growth-filter] ${symbol}:`, err.message);
        return null;
      }
    }, BATCH_SIZE);

    matched.sort((a, b) => b.avgAppreciationPercent - a.avgAppreciationPercent);

    const details = {};
    for (const row of matched) {
      const { symbol, ...meta } = row;
      details[symbol] = meta;
    }

    res.json({
      name,
      list: matched.map(r => r.symbol),
      details,
      engine,
      interval,
      params,
      thresholdPct,
      scannedAt: Date.now(),
    });
  } catch (err) {
    console.error('[indicator-growth-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
