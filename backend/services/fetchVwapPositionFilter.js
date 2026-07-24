'use strict';

const router = require('express').Router();
const { computeVwapWithBands } = require('../utils/vwapSession');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { closedCandlesOnly } = require('../bot/ma-cross/strategyEngine');
const { buildVwapPositionFilterName } = require('../utils/filterNames');
const vwapPositionCache = require('../cache/vwapPositionCache');

const CANDLES_LIMIT = 500;
const CONCURRENCY = 25;
const MIN_CANDLES = 10;
const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_BAND_MULTIPLIERS = new Set([1, 2, 3]);

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

// GET /services/vwap-position-filter?interval=1h&session=daily&bandMultiplier=2&position=near_bottom&proximityPct=20
router.get('/vwap-position-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '1h';
    const session = req.query.session === 'weekly' ? 'weekly' : 'daily';
    const bandMultiplier = parseInt(req.query.bandMultiplier ?? '2', 10);
    const position = req.query.position === 'near_top' ? 'near_top' : 'near_bottom';
    const proximityPct = parseFloat(req.query.proximityPct ?? '20');

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!ALLOWED_BAND_MULTIPLIERS.has(bandMultiplier)) {
      return res.status(400).json({ error: 'bandMultiplier suportado: 1, 2 ou 3' });
    }
    if (!Number.isFinite(proximityPct) || proximityPct <= 0 || proximityPct > 100) {
      return res.status(400).json({ error: 'proximityPct deve estar entre 0 e 100' });
    }

    const proxRounded = Math.round(proximityPct * 10) / 10;
    const name = buildVwapPositionFilterName(interval, session, bandMultiplier, position, proxRounded);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = vwapPositionCache.matchesCachedPreset({
      interval, session, bandMultiplier, position, proximityPct: proxRounded,
    });
    if (presetKey) {
      const cached = await vwapPositionCache.getCachedResult(symbols, presetKey, { force });
      if (cached) {
        return res.json({ ...cached, name });
      }
    }

    const now = Date.now();

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles: raw } = await getCandlesForScreening(symbol, interval, CANDLES_LIMIT);
        const candles = closedCandlesOnly(raw);
        if (!candles?.length || candles.length < MIN_CANDLES) return null;

        const points = computeVwapWithBands(candles, { session, bandMultipliers: [bandMultiplier] });
        if (!points.length) return null;

        const last = points[points.length - 1];
        const upper = last[`upper${bandMultiplier}`];
        const lower = last[`lower${bandMultiplier}`];
        const width = upper - lower;
        if (!(width > 0)) return null;

        const close = parseFloat(candles[candles.length - 1].close);
        const percentV = Math.min(100, Math.max(0, ((close - lower) / width) * 100));
        const matches = position === 'near_bottom'
          ? percentV <= proxRounded
          : percentV >= 100 - proxRounded;
        if (!matches) return null;

        return {
          symbol,
          percentV: Math.round(percentV * 100) / 100,
          close,
          vwap: last.value,
          upper,
          lower,
        };
      } catch {
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => (position === 'near_bottom' ? a.percentV - b.percentV : b.percentV - a.percentV));

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
      session,
      bandMultiplier,
      position,
      proximityPct: proxRounded,
      scannedAt: now,
    });
  } catch (err) {
    console.error('[vwap-position-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
