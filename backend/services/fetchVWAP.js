const router = require("express").Router();
const { VWAP } = require("technicalindicators");

// volume weigth average
router.post("/vwap", async (req, res) => {

    // remove cíclical error
    let candles = req.body;

    let VWAPInput = {
        high: candles.map(c => parseFloat(c.high)),
        low: candles.map(c => parseFloat(c.low)),
        close: candles.map(c => parseFloat(c.close)),
        volume: candles.map(c => parseFloat(c.volume))
    }

    let results = VWAP.calculate(VWAPInput)

    res.send(results);
});

module.exports = router;