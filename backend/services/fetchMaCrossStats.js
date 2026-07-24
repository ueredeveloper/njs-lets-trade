const router = require('express').Router();
const analyseMaCrossStats = require('../utils/analyseMaCrossStats');
const mcFavoritesStatsCache = require('../cache/mcFavoritesStatsCache');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');

// GET /services/ma-cross-stats?symbol=BTCUSDT&entryInterval=15m&exitInterval=1h&period1=9&period2=21
router.get('/ma-cross-stats', async (req, res) => {
  const {
    symbol,
    entryInterval,
    exitInterval,
    period1,
    period2,
    tolerancePct,
    source,
  } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });
  }

  const sym = symbol.toUpperCase();
  const options = {
    entryInterval: entryInterval ?? '15m',
    exitInterval: exitInterval ?? entryInterval ?? '15m',
    period1: period1 ? parseInt(period1, 10) : 9,
    period2: period2 ? parseInt(period2, 10) : 21,
    tolerancePct: tolerancePct ? parseFloat(tolerancePct) : 0,
    source: source ?? null,
  };
  const cacheKey = `macross|${sym}|${options.entryInterval}|${options.exitInterval}|${options.period1}|${options.period2}|${options.tolerancePct}|${options.source ?? 'binance'}`;
  const ttlMs = Math.min(intervalMs(options.entryInterval), intervalMs(options.exitInterval));

  try {
    const { value, cache } = await mcFavoritesStatsCache.getOrCompute(
      sym, cacheKey, ttlMs,
      () => analyseMaCrossStats(sym, options),
    );
    res.json({ ...value, cache });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
