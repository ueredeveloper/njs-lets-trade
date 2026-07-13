'use strict';

const router = require('express').Router();
const { BollingerBands } = require('technicalindicators');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { closedCandlesOnly } = require('../bot/ma-cross/strategyEngine');
const { buildBollingerPositionFilterName } = require('../utils/filterNames');
const bbPositionCache = require('../cache/bbPositionCache');

const CANDLES_LIMIT = 200;
const CONCURRENCY = 25;
const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_PERIODS = new Set([10, 20, 30]);
const ALLOWED_STD_DEVS = new Set([1, 2, 3]);

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

// GET /services/bollinger-band-position-filter?interval=4h&period=20&stdDev=2&position=near_bottom&proximityPct=20
router.get('/bollinger-band-position-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '4h';
    const period = parseInt(req.query.period ?? '20', 10);
    const stdDev = parseFloat(req.query.stdDev ?? '2');
    const position = req.query.position === 'near_top' ? 'near_top' : 'near_bottom';
    const proximityPct = parseFloat(req.query.proximityPct ?? '20');

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!ALLOWED_PERIODS.has(period)) {
      return res.status(400).json({ error: 'período suportado: 10, 20 ou 30' });
    }
    if (!ALLOWED_STD_DEVS.has(stdDev)) {
      return res.status(400).json({ error: 'desvio padrão suportado: 1, 2 ou 3' });
    }
    if (!Number.isFinite(proximityPct) || proximityPct <= 0 || proximityPct > 100) {
      return res.status(400).json({ error: 'proximityPct deve estar entre 0 e 100' });
    }

    const proxRounded = Math.round(proximityPct * 10) / 10;
    const name = buildBollingerPositionFilterName(interval, period, stdDev, position, proxRounded);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = bbPositionCache.matchesCachedPreset({
      interval, period, stdDev, position, proximityPct: proxRounded,
    });
    if (presetKey) {
      const cached = await bbPositionCache.getCachedResult(symbols, presetKey, { force });
      if (cached) {
        return res.json({ ...cached, name });
      }
    }

    const minCandles = period + 5;
    const limit = Math.max(CANDLES_LIMIT, minCandles + 10);
    const now = Date.now();

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles: raw } = await getCandlesForScreening(symbol, interval, limit);
        const candles = closedCandlesOnly(raw);
        if (!candles?.length || candles.length < minCandles) return null;

        const closes = candles.map(c => parseFloat(c.close));
        const bb = BollingerBands.calculate({ period, values: closes, stdDev });
        if (!bb.length) return null;

        const lastBb = bb[bb.length - 1];
        const close = closes[closes.length - 1];
        const width = lastBb.upper - lastBb.lower;
        if (!(width > 0)) return null;

        const percentB = Math.min(100, Math.max(0, ((close - lastBb.lower) / width) * 100));
        const matches = position === 'near_bottom'
          ? percentB <= proxRounded
          : percentB >= 100 - proxRounded;
        if (!matches) return null;

        return {
          symbol,
          percentB: Math.round(percentB * 100) / 100,
          close,
          upper: lastBb.upper,
          lower: lastBb.lower,
          middle: lastBb.middle,
        };
      } catch {
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => (position === 'near_bottom' ? a.percentB - b.percentB : b.percentB - a.percentB));

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
      position,
      proximityPct: proxRounded,
      scannedAt: now,
    });
  } catch (err) {
    console.error('[bollinger-band-position-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
