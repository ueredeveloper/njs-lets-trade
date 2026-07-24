const router = require("express").Router();
const { computeVwapWithBands } = require("../utils/vwapSession");

/**
 * VWAP de sessão (diária/semanal, reset em 00:00 UTC), com bandas de desvio padrão (±1σ, ±2σ).
 * @route POST /services/vwap
 * @param {string} [session=daily] - 'daily' (reset 00:00 UTC) ou 'weekly' (reset segunda 00:00 UTC).
 * @param {Array} req.body - candles ordenados por openTime crescente.
 * @returns {Array<{openTime, value, stdDev, upper1, lower1, upper2, lower2}>}
 */
router.post("/vwap", async (req, res) => {
    const candles = req.body;
    const session = req.query.session === 'weekly' ? 'weekly' : 'daily';

    const results = computeVwapWithBands(candles, { session, bandMultipliers: [1, 2] });

    res.send(results);
});

module.exports = router;
