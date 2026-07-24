const router = require("express").Router();
const { detectSupportResistance } = require('../utils/supportResistance');

/**
 * Rota POST para calcular zonas de Suporte/Resistência (pivôs de fractal
 * agrupados, estilo LuxAlgo).
 * @route POST /support-resistance
 * @param {number} [leftBars.query] - candles antes do pivô (padrão 5)
 * @param {number} [rightBars.query] - candles depois do pivô, precisam já ter fechado (padrão 5)
 * @param {number} [mergePct.query] - distância % máxima pra agrupar pivôs na mesma zona (padrão 0.5)
 * @param {number} [maxLevels.query] - máximo de zonas retornadas (padrão 6)
 * @param {Array} req.body - candles (open, high, low, close, openTime)
 */
router.post("/support-resistance", async (req, res) => {

  let candles = req.body;
  let { leftBars, rightBars, mergePct, maxLevels } = req.query;

  let result = detectSupportResistance(candles, {
    leftBars: leftBars !== undefined ? parseInt(leftBars, 10) : undefined,
    rightBars: rightBars !== undefined ? parseInt(rightBars, 10) : undefined,
    mergePct: mergePct !== undefined ? parseFloat(mergePct) : undefined,
    maxLevels: maxLevels !== undefined ? parseInt(maxLevels, 10) : undefined,
  });

  res.send(result);

});

module.exports = router;
