const router = require('express').Router();
const { getBreakUsdtPairs } = require('../binance/getBreakUsdtPairs');

// GET /services/break-usdt-pairs
// Pares USDT da Binance fora do status TRADING (BREAK/HALT/…) — ver getBreakUsdtPairs.js.
// Consumido só pela categoria "Pausadas (BREAK)" de Configurações → Exibição de ativos.
router.get('/break-usdt-pairs', async (req, res) => {
  try {
    const list = await getBreakUsdtPairs();
    res.json({ list });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

module.exports = router;
