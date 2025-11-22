const fs = require("fs").promises;
const path = require("path");

/**
 * Encontra os dois arquivos de volume mais recentes no diretório especificado.
 * Use: node backend/utils/analyzeVolume.js
 * @param {string} dirPath - O caminho para o diretório de volumes.
 * @returns {Promise<string[]>} - Uma promessa que resolve para um array com os caminhos dos dois arquivos mais recentes.
 */
async function getLatestVolumeFiles(dirPath) {

  const files = await fs.readdir(dirPath);

  // Lê todos os arquivos, e organiza do mais recente para o mais antigo
  const volumeFiles = files
    .filter((file) => file.startsWith("24Hs-Volume-") && file.endsWith(".json"))
    .sort((a, b) => {
      // Extrai o timestamp do nome do arquivo para ordenar
      const timeA = parseInt(a.split("-")[2].replace(".json", ""));
      const timeB = parseInt(b.split("-")[2].replace(".json", ""));
      return timeB - timeA; // Ordena do mais recente para o mais antigo
    });

    

  if (volumeFiles.length < 2) {
    throw new Error(
      "São necessários pelo menos dois arquivos de volume para fazer a comparação."
    );
  }

  // Retorna o caminho completo dos dois arquivos mais recentes
  return [
    path.join(dirPath, volumeFiles[0]),
    path.join(dirPath, volumeFiles[1]),
  ];
}

/**
 * Analisa a variação de volume de todas as moedas entre os dois últimos registros,
 * e exibe um ranking das maiores altas.
 * @param {number} topN - O número de moedas a serem exibidas no ranking de maiores altas.
 */
async function analyzeAllVolumeChanges(topN = 20) {
  try {
    const volumeDir = path.join(__dirname, "..", "data", "volume");
    const [latestFile, previousFile] = await getLatestVolumeFiles(volumeDir);

    console.log(`--- Análise de Variação de Volume ---`);
    console.log(`Comparando arquivos:`);
    console.log(`  - Atual:    ${path.basename(latestFile)}`);
    console.log(`  - Anterior: ${path.basename(previousFile)}\n`);

    // Lê os dados dos dois arquivos
    const latestData = JSON.parse(await fs.readFile(latestFile, "utf-8"));
    const previousData = JSON.parse(await fs.readFile(previousFile, "utf-8"));

    // Para performance, transforma o array anterior em um Map para busca rápida
    const previousDataMap = new Map(
      previousData.map((ticker) => [ticker.symbol, ticker])
    );

    const changes = [];

    for (const latestTicker of latestData) {
      const previousTicker = previousDataMap.get(latestTicker.symbol);

      // Só calcula se a moeda existir em ambos os arquivos e o volume anterior não for zero
      if (previousTicker && parseFloat(previousTicker.quoteVolume) > 0) {
        //console.log(previousTicker.symbol,previousTicker.quoteVolume)
        const latestVolume = parseFloat(latestTicker.quoteVolume);
        const previousVolume = parseFloat(previousTicker.quoteVolume);
        const percentageChange =
          ((latestVolume - previousVolume) / previousVolume) * 100;

        changes.push({
          symbol: latestTicker.symbol,
          percentageChange: percentageChange,
        });
      }
    }

    // Ordena por maior variação percentual e pega o top N
    const topGainers = changes
      .sort((a, b) => b.percentageChange - a.percentageChange)
      .slice(0, topN);

    console.log(`Top ${topN} Maiores Altas de Volume (%):`);
    topGainers.forEach((coin, index) => {
      console.log(
        `${(index + 1).toString().padStart(2, " ")}. ${coin.symbol.padEnd(
          12,
          " "
        )}: +${coin.percentageChange.toFixed(2)}%`
      );
    });
  } catch (error) {
    console.error("Ocorreu um erro ao analisar o volume:", error.message);
  }
}

// Exemplo de como usar a função.
// Você pode chamar isso de outro arquivo ou executar diretamente.
(async () => {
  await analyzeAllVolumeChanges(20); // Mostra o top 20
})();

module.exports = { analyzeAllVolumeChanges };
