const router = require("express").Router();


/**
 * Busca o index do candle de menor valor (low) dentre 20 candlesticks enviados.
 */
router.post("/fetch-lowest-index", async (req, res) => {

    // Captura os candles enviados
    let candles = req.body;

    // Busca o candle com menor valor
    let lowestCandle = candles.reduce((min, c) =>
        parseFloat(c.low) < parseFloat(min.low) ? c : min
    );

    // Busca o index do candle com menor valor. Assim poderá filtrar se o candle de menor valor
    // já aconteceu ou está acontecendo no momento da busca
    let lowestIndex = candles.indexOf(lowestCandle);

    res.send({ lowestIndex: lowestIndex });
});

module.exports = router;