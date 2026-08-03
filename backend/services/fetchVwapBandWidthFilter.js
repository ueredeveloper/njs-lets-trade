'use strict';

const router = require('express').Router();
const { computeRollingVwapWithBands, DAY_MS } = require('../utils/vwapSession');

const WEEK_MS = 7 * DAY_MS;
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { closedCandlesOnly } = require('../bot/ma-cross/strategyEngine');
const { buildVwapBandWidthFilterName } = require('../utils/filterNames');
const vwapBandWidthCache = require('../cache/vwapBandWidthCache');

const CONCURRENCY = 25;
const BAND_MULTIPLIER = 2;
const MIN_CANDLES = 10;
// Histórico extra além do lookback, pra VWAP ter ancoragem de sessão completa
// já nos primeiros candles da janela analisada (sem isso, o início da janela
// mediria uma banda ainda "esquentando" desde o começo dos dados).
const EXTRA_HISTORY_CANDLES = 200;

const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_LOOKBACKS = new Set([50, 100, 150, 200, 300]);

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

/**
 * Largura das bandas de VWAP (±2σ) como % do valor da VWAP, em média nos últimos
 * `lookback` candles fechados — ex.: RIF com bandas ~10% distantes nos últimos 100
 * candles vs. outras moedas com bandas bem mais próximas no mesmo período.
 *
 * GET /services/vwap-band-width-filter?interval=4h&session=weekly&lookback=100&order=far
 */
router.get('/vwap-band-width-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '4h';
    const session = req.query.session === 'daily' ? 'daily' : 'weekly';
    const lookback = parseInt(req.query.lookback ?? '100', 10);
    const order = req.query.order === 'near' ? 'near' : 'far';

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!ALLOWED_LOOKBACKS.has(lookback)) {
      return res.status(400).json({ error: 'lookback suportado: 50, 100, 150, 200 ou 300' });
    }

    const name = buildVwapBandWidthFilterName(interval, session, lookback);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = vwapBandWidthCache.matchesCachedPreset({ interval, session, lookback });
    if (presetKey) {
      const cached = await vwapBandWidthCache.getCachedResult(symbols, presetKey, { force, order });
      if (cached) {
        return res.json({ ...cached, name });
      }
    }

    const limit = lookback + EXTRA_HISTORY_CANDLES;

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles: raw } = await getCandlesForScreening(symbol, interval, limit);
        const candles = closedCandlesOnly(raw);
        if (!candles?.length || candles.length < MIN_CANDLES) return null;

        const points = computeRollingVwapWithBands(candles, { windowMs: session === 'weekly' ? WEEK_MS : DAY_MS, bandMultipliers: [BAND_MULTIPLIER] });
        if (!points.length) return null;

        const window = points.slice(-Math.min(lookback, points.length));
        const widths = [];
        for (const p of window) {
          const upper = p[`upper${BAND_MULTIPLIER}`];
          const lower = p[`lower${BAND_MULTIPLIER}`];
          if (upper == null || lower == null || !(p.value > 0)) continue;
          widths.push(((upper - lower) / p.value) * 100);
        }
        if (!widths.length) return null;

        const avgWidthPct = widths.reduce((s, v) => s + v, 0) / widths.length;
        const lastWidthPct = widths[widths.length - 1];
        const last = candles[candles.length - 1];

        return {
          symbol,
          avgWidthPct: Math.round(avgWidthPct * 100) / 100,
          lastWidthPct: Math.round(lastWidthPct * 100) / 100,
          minWidthPct: Math.round(Math.min(...widths) * 100) / 100,
          maxWidthPct: Math.round(Math.max(...widths) * 100) / 100,
          samples: widths.length,
          close: parseFloat(last.close),
        };
      } catch {
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => (order === 'far' ? b.avgWidthPct - a.avgWidthPct : a.avgWidthPct - b.avgWidthPct));

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
      lookback,
      bandMultiplier: BAND_MULTIPLIER,
      order,
      scannedAt: Date.now(),
    });
  } catch (err) {
    console.error('[vwap-band-width-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
