const express = require('express');
const router  = express.Router();
const getMarkets        = require('../coingecko/getMarkets');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');

// min/max de volume/mcap para cada preset de "giro de volume"
const TURNOVER_PRESETS = {
  baixo:  { min: 0,    max: 0.05 },  // <5%  → possivelmente inflado
  medio:  { min: 0.05, max: 0.30 },  // 5–30% → normal
  alto:   { min: 0.30, max: Infinity }, // >30% → especulativo
};

// min/max de fdv/mcap para cada preset de "diluição futura"
const DILUTION_PRESETS = {
  baixo:  { min: 1, max: 2   },   // até 2× — baixo risco
  medio:  { min: 2, max: 5   },   // 2–5×
  alto:   { min: 5, max: Infinity }, // >5× — alto risco
};

router.get('/market-cap-filter', async (req, res) => {
  try {
    const metric = req.query.metric ?? 'turnover'; // 'turnover' | 'dilution'
    const preset = req.query.preset ?? 'baixo';

    const presets = metric === 'dilution' ? DILUTION_PRESETS : TURNOVER_PRESETS;
    const range   = presets[preset];
    if (!range) return res.status(400).json({ error: `preset inválido: ${preset}` });

    const [markets, usdtPairs] = await Promise.all([getMarkets(), getActiveUsdtPairs()]);
    const symbols = usdtPairs.list ?? [];

    const matched = [];
    for (const sym of symbols) {
      const key  = sym.replace(/USDT$/i, '').toLowerCase();
      const coin = markets[key];
      if (!coin || !coin.market_cap) continue;

      let value;
      if (metric === 'turnover') {
        value = (coin.total_volume ?? 0) / coin.market_cap;
      } else {
        value = (coin.fdv ?? coin.market_cap) / coin.market_cap;
      }

      if (value >= range.min && value < range.max) matched.push(sym);
    }

    const metricSlug = metric === 'dilution' ? 'diluição' : 'giro';
    const name = `mcap|${metricSlug}|${preset}`;

    res.json({ name, list: matched });
  } catch (err) {
    console.error('[market-cap-filter]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
