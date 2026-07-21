'use strict';

const router = require('express').Router();
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { computeMa } = require('../utils/movingAverage');
const { buildMaDistanceFilterName, parseCompareToken } = require('../utils/filterNames');
const maDistanceCache = require('../cache/maDistanceCache');

const CANDLES_LIMIT = 200;
const CONCURRENCY = 25;
const ALLOWED_PERIODS = new Set([9, 21, 50, 200]);
const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);

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

router.get('/ma-distance-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '4h';
    const period = parseInt(req.query.period ?? '21', 10);
    const compareRaw = req.query.compare ?? 'above';
    const compare = parseCompareToken(compareRaw) === 'below' ? 'below' : 'above';
    const lang = req.query.lang === 'pt' ? 'pt' : 'en';

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: 'intervalo não suportado' });
    }
    if (!ALLOWED_PERIODS.has(period)) {
      return res.status(400).json({ error: 'período inválido (use 9, 21, 50 ou 200)' });
    }

    const name = buildMaDistanceFilterName(interval, period, compare, lang);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = maDistanceCache.matchesCachedPreset({ interval, period, compare });
    if (presetKey) {
      const cached = await maDistanceCache.getCachedResult(symbols, presetKey, { force, lang });
      if (cached) {
        return res.json({ ...cached, name });
      }
    }

    const minCandles = period + 5;
    const limit = Math.max(CANDLES_LIMIT, minCandles + 10);
    const now = Date.now();

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles } = await getCandlesForScreening(symbol, interval, limit);
        if (!candles?.length || candles.length < minCandles) return null;

        const ma = computeMa(candles, period);
        if (ma == null || ma <= 0) return null;
        const close = parseFloat(candles[candles.length - 1].close);
        if (!Number.isFinite(close)) return null;

        const gapPct = Math.round(((close / ma) - 1) * 10000) / 100;
        const isAbove = gapPct >= 0;
        if (compare === 'above' && !isAbove) return null;
        if (compare === 'below' && isAbove) return null;

        return {
          symbol,
          gapPct,
          absGapPct: Math.abs(gapPct),
          ma,
          price: close,
          direction: isAbove ? 'up' : 'down',
        };
      } catch {
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => b.absGapPct - a.absGapPct);

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
      compare,
      scannedAt: now,
    });
  } catch (err) {
    console.error('[ma-distance-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
