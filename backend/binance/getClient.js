const Binance = require('binance-api-node').default
require('dotenv').config();

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

module.exports = getClient = async function (){

    if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {      
        console.error('[getClient] BINANCE_API_KEY ou BINANCE_SECRET_KEY não definidos no .env');
        return null;
    }

// remove cíclical error
    const client = Binance({
        apiKey: BINANCE_API_KEY,
        apiSecret: BINANCE_SECRET_KEY,
      })

      return client;

}