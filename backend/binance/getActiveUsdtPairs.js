/**
 * Returns all active USDT pairs currently tradable on Binance.
 * Result is cached for 1 hour to avoid repeated API calls.
 *
 * @returns {Promise<{name: string, list: string[]}>} Lista de pares USDT ativos.
 */
let _cachedPairs = null;
let _cachedAt = 0;
const PAIRS_TTL_MS = 60 * 60 * 1000; // 1 hora

async function getActiveUsdtPairs() {
  if (_cachedPairs && Date.now() - _cachedAt < PAIRS_TTL_MS) {
    return _cachedPairs;
  }

  const url = "https://api.binance.com/api/v3/exchangeInfo";
  const response = await fetch(url);
  const data = await response.json();

  const activeUsdtPairs = data.symbols
    .filter(s => s.symbol.endsWith("USDT"))
    .filter(s => s.status === "TRADING")
    .map(s => s.symbol);

  _cachedPairs = { name: "Mercado|USDT", list: activeUsdtPairs };
  _cachedAt = Date.now();
  return _cachedPairs;
}

module.exports = { getActiveUsdtPairs };

/*
(async () => {
  console.log(await getActiveUsdtPairs());
})();
*/