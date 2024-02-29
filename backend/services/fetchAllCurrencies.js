const { response } = require("express");
const getAllCurrencies = require("../binance/getAllCurrencies");

const router = require("express").Router();

router.get("/currencies", async (req, res) => {

    await getAllCurrencies().then(response => res.send(JSON.stringify(response)));
});

module.exports = router;