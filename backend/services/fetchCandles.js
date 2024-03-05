const router = require("express").Router();
const ichimokuCloud = require('technicalindicators').IchimokuCloud;
const { getClandles } = require('../binance')

router.get("/candles", async (req, res) => {

    let {symbol, limit, interval} = req.query;

    await getClandles(symbol, limit, interval).then(response=> {res.send(JSON.stringify(response))})

});

module.exports = router;