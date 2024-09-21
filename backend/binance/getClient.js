const Binance = require('binance-api-node').default
require('dotenv').config();

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

module.exports = getClient = async function (){

// remove cíclical error
    const client = Binance({
        apiKey: BINANCE_API_KEY,
        apiSecret: BINANCE_SECRET_KEY,
      })

      return client;

}