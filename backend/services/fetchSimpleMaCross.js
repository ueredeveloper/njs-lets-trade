const router = require('express').Router();
const analyseSimpleMaCross = require('../utils/analyseSimpleMaCross');

// GET /services/ma-cross-simple?symbol=BTCUSDT&entryInterval=15m&exitInterval=30m&source=gate
router.get('/ma-cross-simple', async (req, res) => {
    const { symbol, entryInterval = '15m', exitInterval = '30m', source } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });
    try {
        const result = await analyseSimpleMaCross(symbol.toUpperCase(), {
            entryInterval,
            exitInterval,
            source: source ?? null,
        });
        res.json(result);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
