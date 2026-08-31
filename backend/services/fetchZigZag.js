const router = require("express").Router();
const { detectZigZag } = require('../utils/zigzag');

/**
 * Rota POST para calcular a linha ZigZag: liga os pontos de reversão relevantes
 * do preço (topo → fundo → topo…), ignorando movimentos menores que deviationPct%.
 * @route POST /zigzag
 * @param {number} [depth.query] - candles de cada lado do pivô candidato (padrão 5)
 * @param {number} [deviationPct.query] - movimento % mínimo pra confirmar uma reversão (padrão 3)
 * @param {Array} req.body - candles (open, high, low, close, openTime)
 */
router.post("/zigzag", async (req, res) => {

  let candles = req.body;
  let { depth, deviationPct } = req.query;

  let result = detectZigZag(candles, {
    depth: depth !== undefined ? parseInt(depth, 10) : undefined,
    deviationPct: deviationPct !== undefined ? parseFloat(deviationPct) : undefined,
  });

  res.send(result);

});

module.exports = router;
