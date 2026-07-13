const router = require('express').Router();
const { BollingerBands } = require('technicalindicators');

/**
 * Rota POST para calcular as Bandas de Bollinger (upper/middle/lower).
 * @route POST /services/bollinger-bands
 * @param {number} period.query.required - Período da média móvel central (10, 20, 30…)
 * @param {number} stdDev.query.required - Desvio padrão das bandas (1, 2, 3…)
 * @param {Array} req.body - Array de candles com valores de fechamento
 * @returns {Array} results - Array de { upper, middle, lower } alinhado ao fim das velas
 */
router.post('/bollinger-bands', async (req, res) => {
  const candles = req.body;
  const { period, stdDev } = req.query;

  const values = candles.map(c => parseFloat(c.close));
  const results = BollingerBands.calculate({
    period: parseInt(period, 10),
    stdDev: parseFloat(stdDev),
    values,
  });

  res.send(results.map(r => ({ upper: r.upper, middle: r.middle, lower: r.lower })));
});

module.exports = router;
