
const fs = require("fs").promises;
const path = require("path");
const { all } = require("proxy-addr");


/**
 * Use: node ./backend/utils/analyseVolume.js
 */
const analyseVolume = async () => {

    // Captura as moedas com mais de 10 milhões de volume em 24 horas
     let top10M = await fetchTopVolumeCoins(5_000_000)
    console.log(top10M)

    const volumeDir = path.join(__dirname, "..", "data", "volume");
    const filesToAnalyze = await getLatestNVolumeFiles(volumeDir, 5);

    //console.log(filesToAnalyze)

    let allVolumeData = [];


    for (file of filesToAnalyze) {
         let volumeDatas =await  JSON.parse(await fs.readFile(file, "utf-8"));

        console.log(volumeDatas.length)

        allVolumeData  = [...allVolumeData, ...volumeDatas]  
    }

    //console.log(allVolumeData.length)
 

    top10M.forEach((symbol) => {
    let filteredCoins = allVolumeData
      .filter((c) => c.symbol === symbol)
      .sort((a, b) => a.openTime - b.openTime);

    let coin = { symbol: "", quoteVolume: 0, sumVolume: 0, percentages: [] };

    filteredCoins.forEach((fc) => {
      if (coin.quoteVolume > 0)
        coin.percentages.push(
         ( ((Number(fc.quoteVolume) - Number(coin.quoteVolume)) /
            Number(coin.quoteVolume)) *
            100 ).toFixed(2),
        );

      coin.symbol = fc.symbol;
      coin.quoteVolume = fc.quoteVolume;
      coin.sumVolume = Number(coin.sumVolume) + Number(fc.quoteVolume);

      coin = { ...coin };
    });

    console.log(coin);
  });



}

const fetchTopVolumeCoins = async (volumeMin = 10_000_000) => {
    const url = "https://api.binance.com/api/v3/ticker/24hr";

    // Requisição da lista de todos os tickers 24h
    const response = await fetch(url); // fetch nativo do Node 20
    const data = await response.json();


    // Filtra somente pares USDT e aplica o filtro de volume mínimo
    let listTop10M = data
        .filter(ticker => ticker.symbol.endsWith("USDT"))
        .filter(ticker => Number(ticker.quoteVolume) > volumeMin)
        .map(ticker => ticker.symbol);

    return listTop10M;

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

        //console.log('------------------------>>>>>>>>>>>>> ' , volumeFiles.length)


    if (volumeFiles.length < n) {
        throw new Error(
            `São necessários pelo menos ${n} arquivos de volume para fazer a análise.`
        );
    }

    // Retorna o caminho completo dos N arquivos mais recentes
    return volumeFiles.slice(0, n).map((file) => path.join(dirPath, file));
}

analyseVolume()



/*


  let symbols = ["BTCUSDT", "ETHUSDT"];

  symbols.forEach((symbol) => {
    let filteredCoins = coins
      .filter((c) => c.symbol === symbol)
      .sort((a, b) => a.openTime - b.openTime);

    let coin = { symbol: "", quoteVolume: 0, sumVolume: 0, percentages: [] };

    filteredCoins.forEach((fc) => {
      if (coin.quoteVolume > 0)
        coin.percentages.push(
         ( ((Number(fc.quoteVolume) - Number(coin.quoteVolume)) /
            Number(coin.quoteVolume)) *
            100 ).toFixed(2),
        );

      coin.symbol = fc.symbol;
      coin.quoteVolume = fc.quoteVolume;
      coin.sumVolume = Number(coin.sumVolume) + Number(fc.quoteVolume);

      coin = { ...coin };
    });

    console.log(coin);
  });
};

*/
