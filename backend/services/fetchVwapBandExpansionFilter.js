'use strict';

const router = require('express').Router();
const { computeRollingVwapWithBands } = require('../utils/vwapSession');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { buildVwapBandExpansionFilterName } = require('../utils/filterNames');
const vwapBandExpansionCache = require('../cache/vwapBandExpansionCache');

const CONCURRENCY = 25;
// Afastamento assimétrico: banda inferior -1σ até banda superior +2σ.
const BAND_MULTIPLIERS = [1, 2];
const MIN_GAP_PCT = 0.05; // abaixo disso o "mínimo" é ruído — evita razão artificialmente alta
// Candles extras antes do lookback pra janela rolante da VWAP já estar "aquecida"
// (cheia) desde o primeiro ponto medido, em vez de começar subdimensionada.
const WARMUP_BUFFER_CANDLES = 20;

const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_VWAP_INTERVALS = new Set([
  '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);
const ALLOWED_LOOKBACKS = new Set([5, 10, 20, 30, 50, 100]);
const ALLOWED_MULTIPLIERS = new Set([2, 3, 4, 5, 6, 8, 10]);

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
 * Expansão do afastamento entre as bandas -1σ e +2σ da VWAP: acha o menor afastamento
 * (squeeze) dentro dos últimos `lookback` candles e compara com o afastamento atual —
 * ex.: afastamento era 10%, virou 30% ⇒ razão 3x.
 *
 * `interval` é a granularidade dos candles (detecta a expansão fina no tempo);
 * `vwapInterval` é o tamanho da janela rolante usada pra calcular a própria VWAP
 * (ex.: "VWAP de 4h" — não precisa bater com `interval`, só precisa ser >= ele).
 *
 * GET /services/vwap-band-expansion-filter?interval=15m&vwapInterval=4h&lookback=10&multiplier=3
 */
router.get('/vwap-band-expansion-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '15m';
    const vwapInterval = req.query.vwapInterval ?? '4h';
    const lookback = parseInt(req.query.lookback ?? '10', 10);
    const multiplier = parseFloat(req.query.multiplier ?? '3');

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!ALLOWED_VWAP_INTERVALS.has(vwapInterval)) {
      return res.status(400).json({ error: `intervalo de vwap não suportado: ${vwapInterval}` });
    }
    if (!ALLOWED_LOOKBACKS.has(lookback)) {
      return res.status(400).json({ error: 'lookback suportado: 5, 10, 20, 30, 50 ou 100' });
    }
    if (!ALLOWED_MULTIPLIERS.has(multiplier)) {
      return res.status(400).json({ error: 'multiplier suportado: 2, 3, 4, 5, 6, 8 ou 10' });
    }

    const windowMs = intervalMs(vwapInterval);
    const windowCandles = Math.ceil(windowMs / intervalMs(interval));
    const MIN_CANDLES = Math.min(lookback, 3);
    const limit = lookback + windowCandles + WARMUP_BUFFER_CANDLES;

    const name = buildVwapBandExpansionFilterName(interval, vwapInterval, lookback, multiplier);
    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = vwapBandExpansionCache.matchesCachedPreset({ interval, vwapInterval, lookback });
    if (presetKey) {
      const cached = await vwapBandExpansionCache.getCachedResult(symbols, presetKey, { force, multiplier });
      if (cached) {
        return res.json({ ...cached, name });
      }
    }

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles: raw } = await getCandlesForScreening(symbol, interval, limit);
        const candles = closedCandlesOnly(raw);
        if (!candles?.length || candles.length < windowCandles + MIN_CANDLES) return null;

        const points = computeRollingVwapWithBands(candles, { windowMs, bandMultipliers: BAND_MULTIPLIERS });
        if (!points.length) return null;

        const gaps = [];
        for (const p of points) {
          const upper = p.upper2;
          const lower = p.lower1;
          if (upper == null || lower == null || !(p.value > 0)) continue;
          gaps.push(((upper - lower) / p.value) * 100);
        }
        if (gaps.length < MIN_CANDLES) return null;

        const window = gaps.slice(-Math.min(lookback, gaps.length));
        let minGap = Infinity;
        let minIdx = 0;
        window.forEach((g, i) => {
          if (g < minGap) { minGap = g; minIdx = i; }
        });
        const lastGap = window[window.length - 1];
        if (!(minGap >= MIN_GAP_PCT)) return null;

        const ratio = lastGap / minGap;
        if (ratio < multiplier) return null;

        const last = candles[candles.length - 1];
        return {
          symbol,
          ratio: Math.round(ratio * 100) / 100,
          minGapPct: Math.round(minGap * 100) / 100,
          lastGapPct: Math.round(lastGap * 100) / 100,
          candlesSinceMin: window.length - 1 - minIdx,
          close: parseFloat(last.close),
        };
      } catch {
        return null;
      }
    }, CONCURRENCY);

    matched.sort((a, b) => b.ratio - a.ratio);

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
      vwapInterval,
      lookback,
      multiplier,
      bandMultipliers: BAND_MULTIPLIERS,
      scannedAt: Date.now(),
    });
  } catch (err) {
    console.error('[vwap-band-expansion-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
