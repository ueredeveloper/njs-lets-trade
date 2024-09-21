const router = require("express").Router();
const SMA = require('technicalindicators').SMA;

// simple movie average
router.post("/sma", async (req, res) => {

  // remove cíclical error
  let candles = req.body;

  let { period } = req.query;

  let values = candles.map(c => parseFloat(c.close));

  let results = SMA.calculate({ period: period, values: values })

  res.send(results);
});

module.exports = router;
