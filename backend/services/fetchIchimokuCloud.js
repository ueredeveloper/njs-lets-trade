const router = require("express").Router();
const ichimokuCloud = require('technicalindicators').IchimokuCloud;

// Ichimoku Cloud
router.post("/ichimoku-cloud", async (req, res) => {

  // remove cíclical error
  let candles = req.body;

  let input = {
    high: candles.map(c => parseFloat(c.high)),
    low: candles.map(c => parseFloat(c.low)),
    conversionPeriod: 9,
    basePeriod: 26,
    spanPeriod: 52,
    displacement: 26
  }


  let result = ichimokuCloud.calculate(input)

  res.send(result);

});

module.exports = router;
