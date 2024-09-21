const router = require("express").Router();
const rsi = require('technicalindicators').RSI;

// bollinger technical
router.post("/rsi", async (req, res) => {

  // remove cíclical error
  let candles = req.body;

  var inputRSI = {
    values: candles.map(c => parseFloat(c.close)),
    period: 14  // Typical period for RSI calculation
  };

  let result = rsi.calculate(inputRSI)

  res.send(result);

});

module.exports = router;