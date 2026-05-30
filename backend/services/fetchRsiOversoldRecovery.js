const router = require('express').Router();
const analyseRsiOversoldRecovery = require('../utils/analyseRsiOversoldRecovery');

// GET /services/rsi-oversold-recovery?symbol=BTCUSDT&interval=1h&oversold=30&overbought=70
router.get('/rsi-oversold-recovery', async (req, res) => {
    const { symbol, interval, oversold, overbought } = req.query;

    if (!symbol || !interval) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: symbol, interval' });
    }

    const options = {
        oversold:   oversold   ? parseFloat(oversold)   : 30,
        overbought: overbought ? parseFloat(overbought) : 70,
    };

    try {
        const result = await analyseRsiOversoldRecovery(symbol.toUpperCase(), interval, options);
        res.json(result);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
