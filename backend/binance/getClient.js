const Binance = require('binance-api-node').default
require('dotenv').config();

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

let cachedClient = null;

module.exports = getClient = async function () {
    if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
        console.error('[getClient] BINANCE_API_KEY ou BINANCE_SECRET_KEY não definidos no .env');
        return null;
    }

    if (cachedClient) return cachedClient;

    // Busca o horário real do servidor Binance e calcula o offset em relação ao relógio local
    const pub = Binance({});
    const serverTime = await pub.time();
    const offset = serverTime - Date.now();
    console.log(`[getClient] Binance time offset: ${offset}ms`);

    cachedClient = Binance({
        apiKey: BINANCE_API_KEY,
        apiSecret: BINANCE_SECRET_KEY,
        getTime: () => Date.now() + offset,
    });

    return cachedClient;
}
