/**
 * Retorna o volume nas últimas 24 horas.

 */

const { response } = require("express");
const { get24hVolumeFilters } = require("../binance/get24HsVolume");

const router = require("express").Router();

/**

 */
router.get("/24hs-volume", async (req, res) => {

    // remove cíclical error
    let volumes = await get24hVolumeFilters();

    res.send(JSON.stringify(volumes))
});

module.exports = router;