const router = require("express").Router();
//const Candles = require('../binance/candles');
const SMA = require('technicalindicators').SMA;
const { fetchCandles } = require('.')


// simple movie average
router.post("/sma", async (req, res) => {

  let candles = req.body;

  let { period } = req.query;

  let values = candles.map(c => parseFloat(c.close));

  let results = SMA.calculate({ period: period, values: values })

  res.send(results);
});

module.exports = router;
