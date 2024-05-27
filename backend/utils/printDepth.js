const Binance = require('binance-api-node').default;
require('dotenv').config();

// Função para obter os dados de profundidade
async function printDepth(symbol) {
  const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
  const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

  const client = Binance({
    apiKey: BINANCE_API_KEY,
    apiSecret: BINANCE_SECRET_KEY,
  });

  try {
    const allOrders = await client.allOrders({
      symbol
    });
    // You'll need to process the allOrders data to extract relevant depth information (bids and asks)
    console.log(processOrdersForDepth(allOrders));
   
  } catch (error) {
    console.error('Erro ao obter dados de profundidade:', error);
  }
}

module.exports = printDepth;
