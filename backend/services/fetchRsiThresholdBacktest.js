const router = require('express').Router();
const analyseRsiThresholdBacktest = require('../utils/analyseRsiThresholdBacktest');
const mcFavoritesStatsCache = require('../cache/mcFavoritesStatsCache');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');

// GET /services/rsi-threshold-backtest?symbol=BTCUSDT&interval=15m&rsiThreshold=70
//     &pullbackPct=-2&targetPct=5&stopLossPct=5&positionSizeUsd=40
//     &bandWidthEnabled=1&bandWidthInterval=5m&bandWidthMinPct=2
router.get('/rsi-threshold-backtest', async (req, res) => {
    const {
        symbol, interval, source, candleCount, lookbackHours,
        rsiThreshold, pullbackPct, targetPct, stopLossPct, positionSizeUsd,
        bandWidthEnabled, bandWidthInterval, bandWidthPeriod, bandWidthStdDev,
        bandWidthLookback, bandWidthMinPct,
    } = req.query;

    if (!symbol || !interval) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: symbol, interval' });
    }

    const options = {
        rsiThreshold:    rsiThreshold    != null ? parseFloat(rsiThreshold)    : 70,
        pullbackPct:     pullbackPct     != null ? parseFloat(pullbackPct)     : 0,
        targetPct:       targetPct       != null ? parseFloat(targetPct)      : 5,
        stopLossPct:     stopLossPct     != null ? parseFloat(stopLossPct)    : 5,
        positionSizeUsd: positionSizeUsd != null ? parseFloat(positionSizeUsd) : 40,
        source:          source ?? null,
        candleCount:     candleCount ? parseInt(candleCount, 10) : undefined,
        lookbackHours:   lookbackHours != null ? parseFloat(lookbackHours) : 0,
        bandWidth: bandWidthEnabled === '1' ? {
            enabled:  true,
            interval: bandWidthInterval ?? '5m',
            period:   bandWidthPeriod   ? parseInt(bandWidthPeriod, 10)   : 20,
            stdDev:   bandWidthStdDev   ? parseFloat(bandWidthStdDev)     : 2,
            lookback: bandWidthLookback ? parseInt(bandWidthLookback, 10) : 300,
            minPct:   bandWidthMinPct   ? parseFloat(bandWidthMinPct)     : 2,
        } : null,
    };

    const sym = symbol.toUpperCase();
    const cacheKey = `rsi-threshold|${sym}|${interval}|${JSON.stringify(options)}`;

    try {
        const { value, cache } = await mcFavoritesStatsCache.getOrCompute(
            sym, cacheKey, intervalMs(interval),
            () => analyseRsiThresholdBacktest(sym, interval, options),
        );
        res.json({ ...value, cache });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
