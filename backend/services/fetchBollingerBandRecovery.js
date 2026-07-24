const router = require('express').Router();
const analyseBollingerBandRecovery = require('../utils/analyseBollingerBandRecovery');
const mcFavoritesStatsCache = require('../cache/mcFavoritesStatsCache');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');

// GET /services/bollinger-band-recovery?symbol=BTCUSDT&interval=4h&period=20&stdDev=2&source=gate
router.get('/bollinger-band-recovery', async (req, res) => {
    const { symbol, interval = '4h', period, stdDev, source } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });

    const sym = symbol.toUpperCase();
    const options = {
        interval,
        period: period ? parseInt(period) : 20,
        stdDev: stdDev ? parseFloat(stdDev) : 2,
        source: source ?? null,
    };
    const cacheKey = `bb|${sym}|${options.interval}|${options.period}|${options.stdDev}|${options.source ?? 'binance'}`;

    try {
        const { value, cache } = await mcFavoritesStatsCache.getOrCompute(
            sym, cacheKey, intervalMs(options.interval),
            () => analyseBollingerBandRecovery(sym, options),
        );
        res.json({ ...value, cache });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
