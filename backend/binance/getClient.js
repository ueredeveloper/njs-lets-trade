const Binance = require('binance-api-node').default
require('dotenv').config();

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

let cachedClient = null;
let clockOffsetMs = 0;

// Resincroniza o offset do relógio local em relação ao servidor da Binance. Chamado no
// primeiro getClient() e depois a cada hora (setInterval abaixo) — se só rodasse uma vez no
// boot, um processo Express de longa duração acabaria assinando requests com um offset velho
// assim que o relógio do Windows desviasse, e a Binance rejeitaria com "Timestamp ... was
// Nms ahead of the server's time" (era o que estava quebrando o /binance-order).
async function syncClockOffset() {
    try {
        const pub = Binance({});
        const serverTime = await pub.time();
        clockOffsetMs = serverTime - Date.now();
        console.log(`[getClient] Binance time offset: ${clockOffsetMs}ms`);
    } catch (err) {
        console.error(`[getClient] syncClockOffset falhou (offset continua em ${clockOffsetMs}ms): ${err.message}`);
    }
}

module.exports = getClient = async function () {
    if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
        console.error('[getClient] BINANCE_API_KEY ou BINANCE_SECRET_KEY não definidos no .env');
        return null;
    }

    if (cachedClient) return cachedClient;

    await syncClockOffset();

    cachedClient = Binance({
        apiKey: BINANCE_API_KEY,
        apiSecret: BINANCE_SECRET_KEY,
        getTime: () => Date.now() + clockOffsetMs,
    });

    setInterval(syncClockOffset, 60 * 60_000);

    return cachedClient;
}
