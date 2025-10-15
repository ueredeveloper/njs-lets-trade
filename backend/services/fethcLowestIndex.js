const router = require("express").Router();


// volume weigth average
router.post("/lowest-index", async (req, res) => {

    // remove cíclical error
    let candles = req.body;

    // lowest candle
    let lowestCandle = candles.reduce((min, c) =>
        parseFloat(c.low) < parseFloat(min.low) ? c : min
    );

    let lowestCandleIndex = candles.indexOf(lowestCandle);

    res.send(lowestCandleIndex);
});

module.exports = router;