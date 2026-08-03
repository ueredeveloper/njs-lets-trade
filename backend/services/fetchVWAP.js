const router = require("express").Router();
const { computeVwapWithBands, computeRollingVwapWithBands, DAY_MS } = require("../utils/vwapSession");

const WEEK_MS = 7 * DAY_MS;

/**
 * VWAP de sessão (diária/semanal, reset em 00:00 UTC) ou rolante (janela móvel sem reset),
 * com bandas de desvio padrão (±1σ, ±2σ).
 * @route POST /services/vwap
 * @param {string} [session=daily] - 'daily' (24h) ou 'weekly' (7d) — duração da janela/sessão.
 * @param {string} [anchor=rolling] - 'rolling' (janela móvel, padrão do projeto) ou 'session'
 *   (reset de calendário — só pra comparação visual no gráfico, ver Configurações → VWAP padrão).
 * @param {Array} req.body - candles ordenados por openTime crescente.
 * @returns {Array<{openTime, value, stdDev, upper1, lower1, upper2, lower2}>}
 */
router.post("/vwap", async (req, res) => {
    const candles = req.body;
    const session = req.query.session === 'weekly' ? 'weekly' : 'daily';
    const anchor = req.query.anchor === 'session' ? 'session' : 'rolling';

    const results = anchor === 'rolling'
        ? computeRollingVwapWithBands(candles, { windowMs: session === 'weekly' ? WEEK_MS : DAY_MS, bandMultipliers: [1, 2] })
        : computeVwapWithBands(candles, { session, bandMultipliers: [1, 2] });

    res.send(results);
});

module.exports = router;
