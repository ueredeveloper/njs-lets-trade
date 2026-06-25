'use strict';

const router = require('express').Router();
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const maTimeCache = require('../cache/maTimeAboveCache');
const { buildMaPctFilterName } = require('../utils/filterNames');

const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_PERIODS     = new Set([50]);

router.get('/ma-time-above-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '1h';
    const period   = parseInt(req.query.period ?? '50', 10);
    const minPct   = parseFloat(req.query.minPct ?? '70');
    const force    = req.query.force === '1';

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!ALLOWED_PERIODS.has(period)) {
      return res.status(400).json({ error: 'período suportado: 50' });
    }
    if (!Number.isFinite(minPct) || minPct < 0 || minPct > 100) {
      return res.status(400).json({ error: 'minPct deve estar entre 0 e 100' });
    }

    const minPctRounded = Math.round(minPct);
    const name = buildMaPctFilterName(interval, period, minPctRounded);

    const { list: symbols } = await getActiveUsdtPairs();
    const cacheStats = await maTimeCache.ensureAll(symbols, interval, period, { force });

    const matched = [];
    for (const symbol of symbols) {
      const entry = maTimeCache.get(symbol, interval, period);
      if (entry?.pctAboveMa != null && entry.pctAboveMa >= minPctRounded) {
        matched.push(symbol);
      }
    }

    res.json({
      name,
      list: matched,
      minPct: minPctRounded,
      interval,
      period,
      cache: cacheStats,
    });
  } catch (err) {
    console.error('[ma-time-above-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
