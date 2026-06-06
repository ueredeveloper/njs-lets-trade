const express = require('express');
const router  = express.Router();
const { getActiveUsdtPairs }  = require('../binance/getActiveUsdtPairs');
const { getAllGateCurrencies } = require('../gate/getAllGateCurrencies');

// Stablecoins agrupadas por referência monetária
const STABLE_MAP = {
  USD:    ['USDC','DAI','TUSD','FDUSD','PYUSD','USDS','USDB','USDP','FRAX','LUSD',
           'USDD','BUSD','SUSD','GUSD','OUSD','USD1','WUSDT','BFUSD','USDE',
           'CRVUSD','DOLA','STUSD','CUSD','USDX'],
  EUR:    ['EURT','EURS','EURC','AEUR','EURI','AGEUR','XEUR'],
  Ouro:   ['XAUT','PAXG','CACHE','GOLD'],
  Outras: ['GYEN','JPYC','BIDR','XSGD','IDRT','BVND','BRLA','BRLC','TRYB','CNHT','GBPT'],
};

router.get('/stablecoins', async (req, res) => {
  try {
    const [binancePairs, gateCurrencies] = await Promise.all([
      getActiveUsdtPairs(),
      getAllGateCurrencies().catch(() => []),
    ]);

    const allSymbols = new Set([
      ...(binancePairs.list ?? []),
      ...(gateCurrencies ?? []).map(c => c.symbol),
    ]);

    const filters = [];
    for (const [category, stables] of Object.entries(STABLE_MAP)) {
      const stableSet = new Set(stables);
      const list = [];
      for (const sym of allSymbols) {
        const base = sym.replace(/USDT$/i, '').toUpperCase();
        if (stableSet.has(base)) list.push(sym);
      }
      if (list.length > 0) filters.push({ name: `Stables|${category}`, list: list.sort() });
    }

    res.json(filters);
  } catch (err) {
    console.error('[stablecoins]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
