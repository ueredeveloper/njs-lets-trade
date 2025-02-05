const router = require("express").Router();
const ichimokuCloud = require('technicalindicators').IchimokuCloud;
const { getClandles } = require("../binance");
//const { fetchCandles } = require('../services')

// remove cíclical error
router.get("/", async (req, res) => {

  let { symbol, limit, interval } = req.query;

  // let candles = await fetchCandles(symbol, limit, interval);
  let candles = await getClandles(symbol, interval, limit);//.then(response => { return JSON.stringify(response) });

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
