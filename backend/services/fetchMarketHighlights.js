'use strict';

const router = require('express').Router();
const { getMarketHighlights, LIMIT_DEFAULT } = require('../market/marketHighlights');

router.get('/market-highlights', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || LIMIT_DEFAULT, 1), 50);
    const filters = await getMarketHighlights(limit);
    res.json(filters);
  } catch (err) {
    console.error('[market-highlights]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
