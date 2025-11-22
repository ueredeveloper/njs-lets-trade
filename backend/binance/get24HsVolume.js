const fs = require('node:fs/promises');
const path = require("path");
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

  try {
   
    const timestamp = Date.now();
    const filename = `24Hs-Volume-${timestamp}`;
    const dataDir = path.join(`./backend/data/volume/${filename}.json`);

    // Moedas que fazem par com usdt.
    let usdtTickers = data
    .filter(ticker => ticker.symbol.endsWith("USDT"));
     
    await fs.writeFile(dataDir, JSON.stringify(usdtTickers, null, 2));
    console.log(`Dados de volume 24h salvos em ${filename}`);
  } catch (error) {
    console.error("Erro ao salvar os dados de volume 24h:", error);
  }

  let listedOnBinance = await getActiveUsdtPairs()

   // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list9 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 9_000_000 )
    .map(ticker => ticker.symbol);

  let result9 = { name: "1h|Binance|9M⇾", list: list9 }

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list1030 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 10_000_000 && Number(ticker.quoteVolume) < 30_000_000)
    .map(ticker => ticker.symbol);

  let result1030 = { name: "1h|Binance|10M⇿30M", list: list1030 }

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list30 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 30_000_000 && Number(ticker.quoteVolume) < 50_000_000)
    .map(ticker => ticker.symbol);

  let result30 = { name: "1h|Binance|30M⇿50M", list: list30 }

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let list50 = data
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    .filter(ticker => Number(ticker.quoteVolume) > 50_000_000)
    .map(ticker => ticker.symbol);

  let result50 = { name: "1h|Binance|50M⇾", list: list50 }

  return [listedOnBinance, result9, result1030, result30, result50];
}

module.exports = { get24hVolumeFilters };

/*
// Example usage:
(async () => {
  const result = await get24hVolumeFilters();
  console.log(result);
})();*/
