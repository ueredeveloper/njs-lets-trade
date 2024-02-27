const router = require("express").Router();
//const Candles = require('../binance/candles');
const ichimokuCloud = require('technicalindicators').IchimokuCloud;
const { fetchCandles } = require('../services')


// bollinger technical
router.post("/ichimoku-cloud", async (req, res) => {

  let candles = req.body;

  console.log(candles)

  let input = {
        high  : candles.map(c=> parseFloat(c.high)),
        low   : candles.map(c=> parseFloat(c.low)),
        conversionPeriod: 9,
        basePeriod: 26,
        spanPeriod: 52,
        displacement: 26
      }


     let result = ichimokuCloud.calculate(input)

     console.log(result)

     res.send(result);

});

module.exports = router;
