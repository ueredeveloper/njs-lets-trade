const { getActiveUsdtPairs } = require("./getActiveUsdtPairs");

/**
 * Retrieves all USDT trading pairs whose 24h quote volume
 * is higher than the specified minimum quote volume.
 *
 * @param {number} minQuoteVolume - Quantidade mínima de volume em USDT para filtrar os pares.
 * @returns {Promise<string[]>} - Retorna uma lista de símbolos que atendem ao volume mínimo.
 */
async function get24hVolumeFilters() {
  const url = "https://api.binance.com/api/v3/ticker/24hr";

  // Requisição da lista de todos os tickers 24h
  const response = await fetch(url); // fetch nativo do Node 20
  const data = await response.json();

  
  let listedCoins = await getActiveUsdtPairs()

  console.log('listed ----------------> ', listedCoins.length)



  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list10 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 10_000_000 && Number(ticker.quoteVolume) < 30_000_000)
    .map(ticker => ticker.symbol);

  let result10 = { name: "1h|Binance|10M", list: list10 }

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list30 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 30_000_000 && Number(ticker.quoteVolume) < 50_000_000)
    .map(ticker => ticker.symbol);

  let result30 = { name: "1h|Binance|30M", list: list30 }


  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list50 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 50_000_000)
    .map(ticker => ticker.symbol);

  let result50 = { name: "1h|Binance|50M", list: list50 }

  return [listedCoins, result10, result30, result50];
}

module.exports = { get24hVolumeFilters };

/*
// Example usage:
(async () => {
  const result = await get24hVolumeFilters();
  console.log(result);
})();*/
