const router = require("express").Router();
//const Candles = require('../binance/candles');
const ichimokuCloud = require('technicalindicators').IchimokuCloud;
const { getClandles } = require('../binance')

// bollinger technical
router.get("/candles", async (req, res) => {

    let {symbol, limit, period} = req.query;

   
    await getClandles(symbol, limit, period).then(response=> {res.send(JSON.stringify(response))})

    //res.send(JSON.stringify(candles))
  
    /*
    let input = {
        high  : candles.map(c=> parseFloat(c.high)),
        low   : candles.map(c=> parseFloat(c.low)),
        conversionPeriod: 9,
        basePeriod: 26,
        spanPeriod: 52,
        displacement: 26
      }


     let result = ichimokuCloud.calculate(input)

     res.send(result);*/

});

module.exports = router;