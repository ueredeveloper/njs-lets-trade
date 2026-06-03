const { toGateSymbol }  = require('../utils/toGateSymbol');
const fs                = require('fs');
const path              = require('path');

const GATE_BASE       = 'https://api.gateio.ws/api/v4';
const GATE_ADDED_FILE = path.join(__dirname, '../data/gate-added.json');

async function fetchGateTicker(binanceSymbol) {
  const pair = toGateSymbol(binanceSymbol);
  const res  = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`);
  if (!res.ok) return { price: '', volume: 0 };
  const data = await res.json();
  return {
    price:  data[0]?.last ?? '',
    volume: parseFloat(data[0]?.quote_volume ?? 0),
  };
}

module.exports = getAllCurrencies = async function () {
  try {
    const res     = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const tickers = await res.json();

    const currencies = tickers.map((t) => ({
      id: null,
      symbol: t.symbol,
      price:  t.lastPrice,
      volume: parseFloat(t.quoteVolume),
      currency_collections: [[]],
    }));

    // Inclui moedas Gate.io adicionadas pelo usuário via busca
    let gateAdded = [];
    try { gateAdded = JSON.parse(fs.readFileSync(GATE_ADDED_FILE, 'utf8')); } catch {}

    for (const sym of gateAdded) {
      if (!currencies.some((c) => c.symbol === sym)) {
        const { price, volume } = await fetchGateTicker(sym).catch(() => ({ price: '', volume: 0 }));
        currencies.push({ id: null, symbol: sym, price, volume, currency_collections: [[]] });
      }
    }

    return currencies;
  } catch (error) {
    console.error('Error fetching prices:', error);
  }
};
