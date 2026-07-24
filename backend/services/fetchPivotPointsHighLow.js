const router = require("express").Router();
const { detectPivotPointsHighLow } = require('../utils/pivotPointsHighLow');

/**
 * Rota POST para calcular Pivot Points High/Low (estilo TradingView): marca
 * cada pivô de topo/fundo confirmado, um marcador por pivô (sem agrupar em
 * zonas — compare com /support-resistance).
 * @route POST /pivot-points-hl
 * @param {number} [leftBars.query] - candles antes do pivô (padrão 10)
 * @param {number} [rightBars.query] - candles depois do pivô, precisam já ter fechado (padrão 10)
 * @param {Array} req.body - candles (open, high, low, close, openTime)
 */
router.post("/pivot-points-hl", async (req, res) => {

  let candles = req.body;
  let { leftBars, rightBars } = req.query;

  let result = detectPivotPointsHighLow(candles, {
    leftBars: leftBars !== undefined ? parseInt(leftBars, 10) : undefined,
    rightBars: rightBars !== undefined ? parseInt(rightBars, 10) : undefined,
  });

  res.send(result);

});

module.exports = router;
