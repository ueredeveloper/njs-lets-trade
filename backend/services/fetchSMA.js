const router = require("express").Router();
const SMA = require('technicalindicators').SMA;

/**
 * Rota POST para calcular a Média Móvel Simples (SMA).
 * @route POST /api/sma
 * @group SMA - Operações relacionadas à Média Móvel Simples
 * @param {number} period.query.required - Período de cálculo da SMA (50 ou 200 períodos)
 * @param {Array} req.body - Array de objetos representando velas (candles) com valores de fechamento
 * @returns {Array} results - Array contendo os valores da SMA calculada
 */
router.post("/sma", async (req, res) => {

  // Remove possíveis erros cíclicos
  let candles = req.body;

  // Obtém o período da query string
  let { period } = req.query;

  // Extrai os valores de fechamento das velas
  let values = candles.map(c => parseFloat(c.close));

  // Calcula a SMA com base nos valores e no período especificado
  let results = SMA.calculate({ period: period, values: values });

  // Retorna os resultados da SMA
  res.send(results);
});

module.exports = router;
