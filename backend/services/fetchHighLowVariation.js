const router = require("express").Router();


/**
 * Encontra o maior valor entre os campos open, close, high e low
 * em todos os candles de um array.
 *
 * @param {Array<Object>} candles - Lista de objetos representando candles.
 * Cada candle deve conter as propriedades:
 *   - {string} open
 *   - {string} close
 *   - {string} high
 *   - {string} low
 *
 * @returns {number} O maior valor numérico encontrado entre todos os candles.
 *
 * @example
 * const candles = [
 *   { open: "2.01", close: "2.03", high: "2.05", low: "2.00" },
 *   { open: "2.04", close: "2.02", high: "2.06", low: "2.01" }
 * ];
 * const max = getMaxCandleValue(candles);
 * console.log(max); // 2.06
 */
router.post("/fetch-high-low-variation", async (req, res) => {

    // Capture the candles sent from the request body
    const candles = req.body;

    // Highest global value
    const { highestGlobalValue, highestCandle } = candles.reduce(
        (acc, c) => {
            const values = [parseFloat(c.open), parseFloat(c.close), parseFloat(c.high), parseFloat(c.low)];
            const highestInCandle = Math.max(...values);
            if (highestInCandle > acc.highestGlobalValue) {
                return { highestGlobalValue: highestInCandle, highestCandle: c };
            }
            return acc;
        },
        { highestGlobalValue: -Infinity, highestCandle: null }
    );

    // Lowest global value
    const { lowestGlobalValue, lowestCandle } = candles.reduce(
        (acc, c) => {
            const values = [parseFloat(c.open), parseFloat(c.close), parseFloat(c.high), parseFloat(c.low)];
            const lowestInCandle = Math.min(...values);
            if (lowestInCandle < acc.lowestGlobalValue) {
                return { lowestGlobalValue: lowestInCandle, lowestCandle: c };
            }
            return acc;
        },
        { lowestGlobalValue: Infinity, lowestCandle: null }
    );

    // Percentage variation between highest and lowest
    const highLowVariation = ((highestGlobalValue - lowestGlobalValue) / highestGlobalValue);

    res.send({ highLowVariation });
});


module.exports = router;