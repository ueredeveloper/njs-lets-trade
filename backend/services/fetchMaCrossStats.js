const router = require('express').Router();
const analyseMaCrossStats = require('../utils/analyseMaCrossStats');

// GET /services/ma-cross-stats?symbol=BTCUSDT&entryInterval=15m&exitInterval=1h&period1=9&period2=21
router.get('/ma-cross-stats', async (req, res) => {
  const {
    symbol,
    entryInterval,
    exitInterval,
    period1,
    period2,
    tolerancePct,
    source,
  } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });
  }

  const options = {
    entryInterval: entryInterval ?? '15m',
    exitInterval: exitInterval ?? entryInterval ?? '15m',
    period1: period1 ? parseInt(period1, 10) : 9,
    period2: period2 ? parseInt(period2, 10) : 21,
    tolerancePct: tolerancePct ? parseFloat(tolerancePct) : 0,
    source: source ?? null,
  };

  try {
    const result = await analyseMaCrossStats(symbol.toUpperCase(), options);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
