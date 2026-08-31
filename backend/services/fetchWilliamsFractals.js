const router = require("express").Router();
const { detectWilliamsFractals } = require('../utils/williamsFractals');

/**
 * Rota POST para calcular os Williams Fractals (Bill Williams): cada topo/fundo
 * local confirmado vira um marcador — um por fractal, sem agrupar em zonas.
 * Caso particular do /pivot-points-hl com leftBars = rightBars = bars.
 * @route POST /williams-fractals
 * @param {number} [bars.query] - candles de cada lado do fractal, precisam já ter fechado (padrão 2)
 * @param {Array} req.body - candles (open, high, low, close, openTime)
 */
router.post("/williams-fractals", async (req, res) => {

  let candles = req.body;
  let { bars } = req.query;

  let result = detectWilliamsFractals(candles, {
    bars: bars !== undefined ? parseInt(bars, 10) : undefined,
  });

  res.send(result);

});

module.exports = router;
