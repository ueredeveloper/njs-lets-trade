'use strict';

const router = require('express').Router();
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { checkMaPosition, checkMaCrossNearProximity } = require('../bot/ma-cross/strategyEngine');
const { buildMaCompareFilterName, parseCompareToken, parseMaCrossModeToken } = require('../utils/filterNames');
const maCompareCache = require('../cache/maCompareCache');
const { isValidMaCrossPeriod, MA_CROSS_PERIOD_MIN, MA_CROSS_PERIOD_MAX } = require('../bot/ma-cross/tradeConfigSchema');

const CANDLES_LIMIT = 200;
const CONCURRENCY = 25;
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

function buildRowMeta(symbol, r, compare) {
  let direction = r.direction;
  if (!direction && (compare === 'near_up' || compare === 'near_down')) {
    direction = compare === 'near_down' ? 'down' : 'up';
  }
  return {
    symbol,
    gapPct: r.gapPct != null ? Math.round(r.gapPct * 100) / 100 : null,
    absGapPct: r.absGapPct != null ? Math.round(r.absGapPct * 100) / 100 : (
      r.gapPct != null ? Math.round(Math.abs(r.gapPct) * 100) / 100 : null
    ),
    ma1: r.ma1,
    ma2: r.ma2,
    direction,
    kind: r.kind,
  };
}

router.get('/ma-compare-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '1h';
    const period1 = parseInt(req.query.period1 ?? '9', 10);
    const period2 = parseInt(req.query.period2 ?? '21', 10);
    const compareRaw = req.query.compare ?? 'above';
    const modeNear = parseMaCrossModeToken(compareRaw);
    const isNear = modeNear === 'near_up' || modeNear === 'near_down';
    const compare = isNear
      ? modeNear
      : (parseCompareToken(compareRaw) ?? (compareRaw === 'bellow' ? 'below' : 'above'));
    const tolerancePct = parseFloat(req.query.tolerancePct ?? '0.5');
    const proximityPct = parseFloat(req.query.proximityPct ?? '0.5');
    const lang = req.query.lang === 'pt' ? 'pt' : 'en';

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: 'intervalo não suportado' });
    }
    if (!isValidMaCrossPeriod(period1) || !isValidMaCrossPeriod(period2)) {
      return res.status(400).json({
        error: `período EMA inválido (use ${MA_CROSS_PERIOD_MIN}–${MA_CROSS_PERIOD_MAX})`,
      });
    }
    if (period1 === period2) {
      return res.status(400).json({ error: 'EMA rápida e lenta devem ter períodos diferentes' });
    }

    const tolRounded = Math.round(tolerancePct * 10) / 10;
    const proxRounded = Math.round(proximityPct * 10) / 10;
    const nameOpts = isNear ? { proximityPct: proxRounded } : { tolerancePct: tolRounded };
    const name = buildMaCompareFilterName(interval, period1, period2, compare, lang, nameOpts);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = maCompareCache.matchesCachedPreset({
      interval, period1, period2, compare,
      tolerancePct: tolRounded,
      proximityPct: proxRounded,
    });
    if (presetKey) {
      const cached = await maCompareCache.getCachedResult(symbols, presetKey, { force, lang });
      if (cached) {
        return res.json({ ...cached, name });
      }
    }

    const minCandles = Math.max(period1, period2) + 5;
    const limit = Math.max(CANDLES_LIMIT, minCandles + 10);
    const now = Date.now();

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles } = await getCandlesForScreening(symbol, interval, limit);
        if (!candles?.length || candles.length < minCandles) return null;

        const r = isNear
          ? checkMaCrossNearProximity({
            candles1: candles, period1, interval1: interval,
            candles2: candles, period2, interval2: interval,
            mode: compare,
            proximityPct: proxRounded,
            closedOnly: true,
          })
          : checkMaPosition({
            candles1: candles, period1, interval1: interval,
            candles2: candles, period2, interval2: interval,
            compare,
            tolerancePct: tolRounded,
            closedOnly: true,
          });
        if (!r.matched) return null;

        return buildRowMeta(symbol, r, compare);
      } catch {
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => {
      const ga = a.gapPct ?? (isNear ? 999 : 0);
      const gb = b.gapPct ?? (isNear ? 999 : 0);
      if (isNear) return ga - gb;
      return compare === 'below' ? ga - gb : gb - ga;
    });

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
      period1,
      period2,
      compare,
      tolerancePct: tolRounded,
      proximityPct: proxRounded,
      scannedAt: now,
    });
  } catch (err) {
    console.error('[ma-compare-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
