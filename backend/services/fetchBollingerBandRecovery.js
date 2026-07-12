const router = require('express').Router();
const analyseBollingerBandRecovery = require('../utils/analyseBollingerBandRecovery');

// GET /services/bollinger-band-recovery?symbol=BTCUSDT&interval=4h&period=20&stdDev=2&source=gate
router.get('/bollinger-band-recovery', async (req, res) => {
    const { symbol, interval = '4h', period, stdDev, source } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });
    try {
        const result = await analyseBollingerBandRecovery(symbol.toUpperCase(), {
            interval,
            period: period ? parseInt(period) : 20,
            stdDev: stdDev ? parseFloat(stdDev) : 2,
            source: source ?? null,
        });
        res.json(result);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
