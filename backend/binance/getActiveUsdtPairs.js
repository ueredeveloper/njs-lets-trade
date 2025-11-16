/**
 * Returns all active USDT pairs currently tradable on Binance.
 *
 * @returns {Promise<string[]>} Lista de pares USDT ativos.
 */
async function getActiveUsdtPairs() {
  const url = "https://api.binance.com/api/v3/exchangeInfo";

  const response = await fetch(url);
  const data = await response.json();

  const activeUsdtPairs = data.symbols
    .filter(s => s.symbol.endsWith("USDT"))
    .filter(s => s.status === "TRADING")
    .map(s => s.symbol);

    console.log('active usdt pairs +++++++++++++++++++ ', activeUsdtPairs.length)

  return {name: "1h|Binance|USDT", list: activeUsdtPairs};
}

module.exports = { getActiveUsdtPairs };

/*
(async () => {
  console.log(await getActiveUsdtPairs());
})();
*/