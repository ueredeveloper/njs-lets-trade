'use strict';

const router = require('express').Router();
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { evaluateMaCrossSignal, intervalMs, getMaCrossMetrics } = require('../bot/ma-cross/strategyEngine');
const { isValidMaCrossPeriod, MA_CROSS_PERIOD_MIN, MA_CROSS_PERIOD_MAX } = require('../bot/ma-cross/tradeConfigSchema');
const { buildMaCrossFilterName, parseMaCrossModeToken } = require('../utils/filterNames');
const maCrossCache = require('../cache/maCrossCache');

const CANDLES_LIMIT = 200;
const CONCURRENCY   = 25;
const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_MODES = new Set(['cross_up', 'cross_down', 'near_up', 'near_down']);
const ALLOWED_AGE_MIN = new Set(['last', '1', '5', '15', '30', '60', '240', '1440']);

function finestInterval(a, b) {
  return intervalMs(a) <= intervalMs(b) ? a : b;
}

function parseMaxAgeMin(raw) {
  if (raw == null || raw === '' || raw === 'last') return 'last';
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(n);
}

function shouldUseLive(mode, maxAgeMin) {
  if (mode === 'near_up' || mode === 'near_down') return true;
  if (maxAgeMin === 'last') return true;
  const n = parseInt(maxAgeMin, 10);
  return Number.isFinite(n) && n <= 15;
}

function buildDetail(symbol, r, mode) {
  const dir = mode.includes('down') ? 'down' : 'up';
  const detail = {
    kind: r.kind ?? (mode.startsWith('near') ? 'approaching' : 'crossed'),
    direction: dir,
  };
  if (r.ageMin != null) detail.ageMin = Math.round(r.ageMin * 10) / 10;
  if (r.gapPct != null) detail.gapPct = Math.round(r.gapPct * 100) / 100;
  if (r.crossTime != null) detail.crossTime = r.crossTime;
  return { symbol, ...detail };
}

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

router.get('/ma-crossover-filter', async (req, res) => {
  try {
    const interval1 = req.query.interval1 ?? req.query.interval ?? '15m';
    const interval2 = req.query.interval2 ?? interval1;
    const period1   = parseInt(req.query.period1 ?? '9', 10);
    const period2   = parseInt(req.query.period2 ?? '21', 10);
    const modeRaw   = req.query.mode ?? 'cross_up';
    const mode      = parseMaCrossModeToken(modeRaw) ?? (ALLOWED_MODES.has(modeRaw) ? modeRaw : null);
    const tolerancePct = parseFloat(req.query.tolerancePct ?? '0');
    const proximityPct = parseFloat(req.query.proximityPct ?? '1');
    const maxAgeMin = parseMaxAgeMin(req.query.maxAgeMin ?? 'last');
    const live = req.query.live === '1' || req.query.live === 'true';

    if (!ALLOWED_INTERVALS.has(interval1) || !ALLOWED_INTERVALS.has(interval2)) {
      return res.status(400).json({ error: 'intervalo não suportado' });
    }
    if (!isValidMaCrossPeriod(period1) || !isValidMaCrossPeriod(period2)) {
      return res.status(400).json({
        error: `período EMA inválido (use ${MA_CROSS_PERIOD_MIN}–${MA_CROSS_PERIOD_MAX})`,
      });
    }
    if (!mode || !ALLOWED_MODES.has(mode)) {
      return res.status(400).json({ error: 'mode inválido (cross_up, cross_down, near_up, near_down)' });
    }
    if (mode.startsWith('cross') && (!maxAgeMin || !ALLOWED_AGE_MIN.has(maxAgeMin))) {
      return res.status(400).json({ error: 'maxAgeMin inválido (last, 1, 5, 15, 30, 60, 240, 1440)' });
    }
    if (period1 === period2 && interval1 === interval2) {
      return res.status(400).json({ error: 'MA1 e MA2 devem ter período ou intervalo diferentes' });
    }

    const sigInterval = finestInterval(interval1, interval2);
    const tolRounded  = Math.round(tolerancePct * 10) / 10;
    const proxRounded = Math.round(proximityPct * 10) / 10;
    const closedOnly  = mode.startsWith('near')
      ? !live
      : true;

    const nameOpts = { maxAgeMin, tolerancePct: tolRounded };
    if (mode.startsWith('near')) nameOpts.proximityPct = proxRounded;
    const name = buildMaCrossFilterName(sigInterval, period1, interval1, period2, interval2, mode, nameOpts);

    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = maCrossCache.matchesCachedPreset({
      period1, interval1, period2, interval2,
      mode, maxAgeMin, tolerancePct: tolRounded, live,
    });
    if (presetKey) {
      const cached = await maCrossCache.getCachedResult(symbols, presetKey, { force });
      return res.json(cached);
    }

    const minCandles = Math.max(period1, period2) + 5;
    const limit = Math.max(CANDLES_LIMIT, minCandles + 10);
    const now = Date.now();

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        let candles1;
        let candles2;

        if (interval1 === interval2) {
          ({ candles: candles1 } = await getCandlesForScreening(symbol, interval1, limit));
          candles2 = candles1;
        } else {
          const [r1, r2] = await Promise.all([
            getCandlesForScreening(symbol, interval1, limit),
            getCandlesForScreening(symbol, interval2, limit),
          ]);
          candles1 = r1.candles;
          candles2 = r2.candles;
        }

        if (!candles1?.length || candles1.length < minCandles) return null;
        if (interval1 !== interval2 && (!candles2?.length || candles2.length < minCandles)) return null;

        const r = evaluateMaCrossSignal({
          candles1, period1, interval1,
          candles2, period2, interval2,
          mode,
          tolerancePct: tolRounded,
          proximityPct: proxRounded,
          maxAgeMin,
          closedOnly,
          now,
        });
        return r.matched ? buildDetail(symbol, r, mode) : null;
      } catch {
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'crossed' ? -1 : 1;
      if (a.ageMin != null && b.ageMin != null) return a.ageMin - b.ageMin;
      if (a.gapPct != null && b.gapPct != null) return a.gapPct - b.gapPct;
      return 0;
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
      mode,
      maxAgeMin,
      live: !closedOnly,
      period1,
      interval1,
      period2,
      interval2,
      tolerancePct: tolRounded,
      proximityPct: proxRounded,
      scannedAt: now,
    });
  } catch (err) {
    console.error('[ma-crossover-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Status MA Cross para lista de favoritos (gap + último cruzamento por símbolo). */
router.post('/ma-cross-status', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.json({ details: {}, scannedAt: Date.now() });
    }

    const tolerancePct = parseFloat(req.body?.tolerancePct ?? '0.5');
    const crossLookbackMin = parseInt(req.body?.crossLookbackMin ?? '1440', 10);
    const now = Date.now();
    const details = {};

    const results = await runWithConcurrency(items.slice(0, 80), async (item) => {
      const symbol = String(item.symbol ?? '').toUpperCase();
      if (!symbol) return null;

      const period1 = parseInt(item.period1 ?? '9', 10);
      const period2 = parseInt(item.period2 ?? '21', 10);
      const interval1 = item.interval1 ?? item.interval ?? '5m';
      const interval2 = item.interval2 ?? interval1;

      if (!isValidMaCrossPeriod(period1) || !isValidMaCrossPeriod(period2)) return null;
      if (!ALLOWED_INTERVALS.has(interval1) || !ALLOWED_INTERVALS.has(interval2)) return null;

      const minCandles = Math.max(period1, period2) + 5;
      const limit = Math.max(CANDLES_LIMIT, minCandles + 10);

      try {
        let candles1;
        let candles2;
        if (interval1 === interval2) {
          ({ candles: candles1 } = await getCandlesForScreening(symbol, interval1, limit));
          candles2 = candles1;
        } else {
          const [r1, r2] = await Promise.all([
            getCandlesForScreening(symbol, interval1, limit),
            getCandlesForScreening(symbol, interval2, limit),
          ]);
          candles1 = r1.candles;
          candles2 = r2.candles;
        }

        const m = getMaCrossMetrics({
          candles1, period1, interval1,
          candles2, period2, interval2,
          tolerancePct,
          crossLookbackMin,
          now,
        });
        if (!m.ok) return { symbol, error: m.reason };
        return { symbol, ...m };
      } catch {
        return { symbol, error: 'FETCH_FAIL' };
      }
    }, CONCURRENCY);

    for (const row of results) {
      if (!row?.symbol) continue;
      const { symbol, ...meta } = row;
      details[symbol] = meta;
    }

    res.json({ details, scannedAt: now });
  } catch (err) {
    console.error('[ma-cross-status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
