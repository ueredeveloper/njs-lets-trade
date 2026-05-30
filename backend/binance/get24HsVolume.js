const { getActiveUsdtPairs } = require("./getActiveUsdtPairs");

/**
 * Retrieves all USDT trading pairs whose 24h quote volume
 * is higher than the specified minimum quote volume.

 *
 * @param {number} minQuoteVolume - Quantidade mínima de volume em USDT para filtrar os pares.
 * @returns {Promise<string[]>} - Retorna uma lista de símbolos que atendem ao volume mínimo.
 * 
 */
async function get24hVolumeFilters() {
  const url = "https://api.binance.com/api/v3/ticker/24hr";

  // Requisição da lista de todos os tickers 24h
  const response = await fetch(url); // fetch nativo do Node 20
  const data = await response.json();

  let listedOnBinance = await getActiveUsdtPairs()

   // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list5 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 5_000_000 )
    .map(ticker => ticker.symbol);

    
  let result5 = { name: "1h|Binance|5M⇾", list: list5 }

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list530 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 5_000_000 && Number(ticker.quoteVolume) < 30_000_000)
    .map(ticker => ticker.symbol);

  let result530 = { name: "1h|Binance|5M⇿30M", list: list530 }

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list3050 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 30_000_000 && Number(ticker.quoteVolume) < 50_000_000)
    .map(ticker => ticker.symbol);

  let result3050 = { name: "1h|Binance|30M⇿50M", list: list3050 }

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list50 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 50_000_000)
    .map(ticker => ticker.symbol);

  let result50 = { name: "1h|Binance|50M⇾", list: list50 }

  return [listedOnBinance, result5, result530, result3050, result50];
}

module.exports = { get24hVolumeFilters };

/*
// Example usage:
(async () => {
  const result = await get24hVolumeFilters();
  console.log(result);
})();*/
