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

  const listedOnBinance = await getActiveUsdtPairs();
  const list5M = [];
  const list1030 = [];
  const list30 = [];
  const list50 = [];

  data.forEach(ticker => {
    if (!ticker.symbol.endsWith("USDT")) return;

    const volume = Number(ticker.quoteVolume);

    if (volume > 5_000_000) {
      list5M.push(ticker.symbol);
      
      if (volume > 50_000_000) {
        list50.push(ticker.symbol);
      } else if (volume > 30_000_000) {
        list30.push(ticker.symbol);
      } else if (volume > 10_000_000) {
        list1030.push(ticker.symbol);
      }
    }
  });

  return [
    listedOnBinance,
    { name: "1h|Binance|5M⇾", list: list5M },
    { name: "1h|Binance|10M⇿30M", list: list1030 },
    { name: "1h|Binance|30M⇿50M", list: list30 },
    { name: "1h|Binance|50M⇾", list: list50 }
  ];
}

module.exports = { get24hVolumeFilters };

/*
// Example usage:
(async () => {
  const result = await get24hVolumeFilters();
  console.log(result);
})();*/
