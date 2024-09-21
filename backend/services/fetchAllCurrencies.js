/**
 * Retorna todas as moedas disponíveis.
 * @async
 * @function getAllCurrencies
 * @returns {Promise<Array>} Um array contendo informações sobre as moedas disponíveis.
 */

const { response } = require("express");
const getAllCurrencies = require("../binance/getAllCurrencies");

const router = require("express").Router();

/**
 * Rota para obter todas as moedas.
 * @name GET/currencies
 * @function
 * @memberof module:routers
 * @param {Object} req - Objeto de solicitação do Express.
 * @param {Object} res - Objeto de resposta do Express.
 * @returns {undefined}
 */
router.get("/currencies", async (req, res) => {

    // remove cíclical error
    await getAllCurrencies().then(response => res.send(JSON.stringify(response)));
});

module.exports = router;

/*
retorno: 

[
    {"id":null,"symbol":"ETHBTC","price":"0.05522000","currency_collections":[[]]},
    {"id":null,"symbol":"LTCBTC","price":"0.00131400","currency_collections":[[]]},
    ...
]

*/