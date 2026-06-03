const router = require('express').Router();
const { getAllGateCurrencies } = require('../gate/getAllGateCurrencies');

router.get('/gate-currencies', async (req, res) => {
  try {
    const currencies = await getAllGateCurrencies();
    res.json(currencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
