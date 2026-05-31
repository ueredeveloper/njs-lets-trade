const getClient        = require('./getClient');
const { toGateSymbol } = require('../utils/toGateSymbol');

const GATE_BASE = 'https://api.gateio.ws/api/v4';

// Símbolos que existem apenas na Gate.io — adicionados ao retorno com preço ao vivo.
const GATE_ONLY_SYMBOLS = ['FIOUSDT'];

async function fetchGatePrice(binanceSymbol) {
  const pair = toGateSymbol(binanceSymbol);
  const res  = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`);
  if (!res.ok) return '';
  const data = await res.json();
  return data[0]?.last ?? '';
}

module.exports = getAllCurrencies = async function () {
  try {
    const client                = await getClient();
    const currenciesSymbolPrices = await client.prices();
    const currencies = Object.entries(currenciesSymbolPrices).map(([symbol, price]) => ({
      id: null, symbol, price, currency_collections: [[]]
    }));

    // Inclui moedas Gate.io-only que não constam na Binance
    for (const sym of GATE_ONLY_SYMBOLS) {
      if (!currencies.some((c) => c.symbol === sym)) {
        const price = await fetchGatePrice(sym).catch(() => '');
        currencies.push({ id: null, symbol: sym, price, currency_collections: [[]] });
      }
    }

    return currencies;
  } catch (error) {
    console.error('Error fetching prices:', error);
  }
};
