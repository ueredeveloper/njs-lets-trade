
const fs = require("fs").promises;
const path = require("path");
const { all } = require("proxy-addr");


/**
 * Use: node ./backend/utils/analyseVolume.js
 */
const analyseVolume = async () => {
  

  // Captura as moedas com mais de 5 milhões de volume em 24 horas
  let topVolume = await fetchLargestVolumes(9_000_000)
  // console.log(topVolume)

  const volumeDir = path.join(__dirname, "..", "data", "volume");
  const filesToAnalyze = await getLatestNVolumeFiles(volumeDir, 5);

  let allVolumes = [];

  for (file of filesToAnalyze) {
    let volumes = await JSON.parse(await fs.readFile(file, "utf-8"));

    allVolumes = [...allVolumes, ...volumes]
  }

  //console.log(allVolumes.length)

  topVolume.forEach((symbol) => {
    let filteredCoins = allVolumes
      .filter((c) => c.symbol === symbol)
      .sort((a, b) => a.openTime - b.openTime);

    let coin = { symbol: "", quoteVolume: 0, percentages: [] };

    filteredCoins.forEach((fc) => {

      if (coin.quoteVolume > 0)
        coin.percentages.push(
          (((Number(fc.quoteVolume) - Number(coin.quoteVolume)) /
            Number(coin.quoteVolume)) *
            100).toFixed(2),
        );

      coin.symbol = fc.symbol;
      coin.quoteVolume = fc.quoteVolume;


      coin = { ...coin };
    });

    let hasEveryPositveValues = coin.percentages.every(p => p > 0)

    if (hasEveryPositveValues) {
     
      let info = `${coin.symbol} - Volume ($): ${formatNumber(coin.quoteVolume)}, Valores positivos: ${hasEveryPositveValues}`;
      let colorWithInfo = `\x1b[34m${info}\x1b[0m`; // azul
      console.log(colorWithInfo)
    }


  });



}

const fetchLargestVolumes = async (volumeMin = 9_000_000) => {
  const url = "https://api.binance.com/api/v3/ticker/24hr";

  // Requisição da lista de todos os tickers 24h
  const response = await fetch(url); // fetch nativo do Node 20
  const data = await response.json();

  // Filtra somente pares USDT e aplica o filtro de volume mínimo
  let listTopVolumes = data
    .filter(ticker =>
      ticker.symbol.endsWith("USDT")
      && [
        "TUSDUSDT",
        "USDPUSDT",
        "FDUSDUSDT",
        "EURIUSDT",
        "XUSDUSDT",
        "USDCUSDT",
        "EURUSDT",
        "USDEUSDT",
        "USD1USDT",
        "BFUSDUSDT",
        "NEXOUSDT",
        "FXSUSDT",
        "AEURUSDT",
        "PAXGUSDT",
        "FDUSDUSDT"
      ].every(s => s !== ticker.symbol))
    .filter(ticker => Number(ticker.quoteVolume) > volumeMin)
    .map(ticker => ticker.symbol);

  return listTopVolumes;

}

async function getLatestNVolumeFiles(dirPath, n) {
  const files = await fs.readdir(dirPath);

  // Filtra e ordena os arquivos de volume
  const volumeFiles = files
    .filter((file) => file.startsWith("24Hs-Volume-") && file.endsWith(".json"))
    .sort((a, b) => {
      // Extrai o timestamp do nome do arquivo para ordenar
      const timeA = parseInt(a.split("-")[2].replace(".json", ""));
      const timeB = parseInt(b.split("-")[2].replace(".json", ""));
      return timeB - timeA; // Ordena do mais recente para o mais antigo
    });


  if (volumeFiles.length < n) {
    throw new Error(
      `São necessários pelo menos ${n} arquivos de volume para fazer a análise.`
    );
  }

  // Retorna o caminho completo dos N arquivos mais recentes
  return volumeFiles.slice(0, n).map((file) => path.join(dirPath, file));
}

const formatNumber = (value) => {
  const numberFormated = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

  return numberFormated;
}

module.exports = { analyseVolume };
