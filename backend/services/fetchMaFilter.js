const router = require('express').Router();
const { SMA } = require('technicalindicators');
const getCandles = require('../binance/getCandles');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { get: cacheGet, storeFromCandles } = require('../cache/rsiCache');
const { checkMaVsCandle } = require('../utils/maCandleCompare');
const { buildMaFilterName } = require('../utils/filterNames');

const CANDLES_LIMIT = 200;
const CONCURRENCY   = 30;
const CACHED_PERIODS = new Set([50]);

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

function buildMaFromCandles(candles, period) {
  const closes = candles.map(c => parseFloat(c.close));
  if (closes.length < period) return null;
  const arr = SMA.calculate({ values: closes, period });
  return arr.length ? arr[arr.length - 1] : null;
}

router.get('/ma-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '1h';
    const period   = parseInt(req.query.period ?? '50', 10);
    const compare  = req.query.compare ?? 'above';
    const candle   = req.query.candle ?? 'close';

    if (!CACHED_PERIODS.has(period)) {
      return res.status(400).json({ error: `MA${period} não disponível via cache (suportado: 50)` });
    }

    const lang = req.query.lang === 'pt' ? 'pt' : 'en';
    const name = buildMaFilterName(interval, period, compare, candle, lang);

    const { list: symbols } = await getActiveUsdtPairs();
    const matched = [];
    const misses  = [];

    for (const symbol of symbols) {
      const entry = cacheGet(symbol, interval);
      if (!entry?.ma50) {
        misses.push(symbol);
        continue;
      }
      if (checkMaVsCandle(entry.ma50, entry.lastCandle, compare, candle)) {
        matched.push(symbol);
      }
    }

    if (misses.length > 0) {
      const extra = await runWithConcurrency(misses, async (symbol) => {
        try {
          const candles = await getCandles(symbol, interval, CANDLES_LIMIT);
          if (!candles?.length) return null;
          storeFromCandles(symbol, interval, candles);
          const ma = buildMaFromCandles(candles, period);
          const last = candles[candles.length - 1];
          if (checkMaVsCandle(ma, last, compare, candle)) return symbol;
          return null;
        } catch {
          return null;
        }
      }, CONCURRENCY);
      matched.push(...extra);
    }

    res.json({ name, list: matched });
  } catch (err) {
    console.error('[ma-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
