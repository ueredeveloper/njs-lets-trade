const fs   = require('fs');
const path = require('path');

const CACHE_FILE  = path.join(__dirname, '../data/gate-currencies.json');
const CACHE_TTL   = 5 * 60 * 1000; // 5 minutos

async function getAllGateCurrencies() {
  if (fs.existsSync(CACHE_FILE)) {
    const age = Date.now() - fs.statSync(CACHE_FILE).mtimeMs;
    if (age < CACHE_TTL) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  }

  const res = await fetch('https://api.gateio.ws/api/v4/spot/tickers');
  if (!res.ok) throw new Error(`Gate.io tickers: HTTP ${res.status}`);
  const tickers = await res.json();

  const currencies = tickers
    .filter(t => t.currency_pair && t.currency_pair.endsWith('_USDT'))
    .map(t => ({
      symbol: t.currency_pair.replace('_', ''),  // BTC_USDT → BTCUSDT
      price:  parseFloat(t.last)         || 0,
      volume: parseFloat(t.quote_volume) || 0,
    }))
    .sort((a, b) => b.volume - a.volume);

  fs.writeFileSync(CACHE_FILE, JSON.stringify(currencies, null, 2));
  return currencies;
}

module.exports = { getAllGateCurrencies };
