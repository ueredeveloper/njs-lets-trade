const router = require('express').Router();
const analyseRsiOversoldRecovery = require('../utils/analyseRsiOversoldRecovery');
const mcFavoritesStatsCache = require('../cache/mcFavoritesStatsCache');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');

// GET /services/rsi-oversold-recovery?symbol=BTCUSDT&interval=1h&oversold=30&overbought=70
router.get('/rsi-oversold-recovery', async (req, res) => {
    const { symbol, interval, oversold, overbought, source } = req.query;

    if (!symbol || !interval) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: symbol, interval' });
    }

    const options = {
        oversold:   oversold   ? parseFloat(oversold)   : 30,
        overbought: overbought ? parseFloat(overbought) : 70,
        source:     source     ?? null,
    };

    const sym = symbol.toUpperCase();
    const cacheKey = `rsi|${sym}|${interval}|${options.oversold}|${options.overbought}|${options.source ?? 'binance'}`;

    try {
        const { value, cache } = await mcFavoritesStatsCache.getOrCompute(
            sym, cacheKey, intervalMs(interval),
            () => analyseRsiOversoldRecovery(sym, interval, options),
        );
        res.json({ ...value, cache });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
