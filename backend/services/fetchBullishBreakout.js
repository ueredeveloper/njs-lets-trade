'use strict';

const router = require('express').Router();
const { getBullishBreakouts } = require('../market/bullishBreakoutScanner');

// GET /services/bullish-breakout?interval=4h&minBodyPct=5&minVolumeRatio=3&minClosePos=0.4
//   &lookback=20&withinCandles=1&requireBreakout=true&closedOnly=false&minVolume24h=1000000
// Todos opcionais (padrões em bullishBreakoutScanner.js#DEFAULTS). Devolve { name, list, meta }.
router.get('/bullish-breakout', async (req, res) => {
  try {
    res.json(await getBullishBreakouts(req.query));
  } catch (err) {
    const badRequest = /inválido|deve estar/.test(err.message);
    if (!badRequest) console.error('[bullish-breakout]', err.message);
    res.status(badRequest ? 400 : 502).json({ error: err.message });
  }
});

module.exports = router;
