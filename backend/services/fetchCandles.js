const { getClandles } = require("../binance");

const router = require("express").Router();


// remove cíclical error
router.get("/candles", async (req, res) => {
    let { symbol, interval, limit } = req.query;

    try {
        let response = await getClandles(symbol, interval, limit);
        res.send(JSON.stringify(response));
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

module.exports = router;
