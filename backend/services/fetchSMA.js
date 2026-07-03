const router = require("express").Router();
const { calculateMa } = require('../utils/movingAverage');

/**
 * Rota POST para calcular a Média Móvel Exponencial (EMA).
 * @route POST /api/sma
 * @group EMA - Operações relacionadas à Média Móvel Exponencial
 * @param {number} period.query.required - Período de cálculo da EMA (9, 21, 50, 200…)
 * @param {Array} req.body - Array de objetos representando velas (candles) com valores de fechamento
 * @returns {Array} results - Array contendo os valores da EMA calculada
 */
router.post("/sma", async (req, res) => {

  // Remove possíveis erros cíclicos
  let candles = req.body;

  // Obtém o período da query string
  let { period } = req.query;

  // Extrai os valores de fechamento das velas
  let values = candles.map(c => parseFloat(c.close));

  // Calcula a EMA com base nos valores e no período especificado
  let results = calculateMa(values, parseInt(period, 10));

  // Retorna os resultados da EMA
  res.send(results);
});

module.exports = router;
