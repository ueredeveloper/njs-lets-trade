const fs = require("fs").promises;
const path = require("path");

/**
 * Encontra os N arquivos de volume mais recentes no diretório especificado.
 * 
 * Use: node backend/utils/analyzeFivePeriodVolume.js
 * 
 * @param {string} dirPath - O caminho para o diretório de volumes.
 * @param {number} n - O número de arquivos a serem retornados.
 * @returns {Promise<string[]>} - Uma promessa que resolve para um array com os caminhos dos N arquivos mais recentes, do mais novo ao mais antigo.
 */
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

/**
 * Analisa a variação de volume de todas as moedas entre os cinco últimos registros
 * e exibe um ranking das maiores altas.
 * @param {number} topN - O número de moedas a serem exibidas no ranking.
 */
async function analyzeFivePeriodVolumeChange(topN = 20) {
  try {
    const volumeDir = path.join(__dirname, "..", "data", "volume");
    const filesToAnalyze = await getLatestNVolumeFiles(volumeDir, 5);

    // O primeiro arquivo é o mais recente, o último é o mais antigo.
    const latestFile = filesToAnalyze[0];
    const oldestFile = filesToAnalyze[filesToAnalyze.length - 1];

    console.log(`--- Análise de Variação de Volume (5 Períodos) ---`);
    console.log(`Comparando arquivos:`);
    console.log(`  - Mais Recente: ${path.basename(latestFile)}`);
    console.log(`  - Mais Antigo:  ${path.basename(oldestFile)}\n`);

    // Lê os dados dos dois arquivos (mais novo e mais antigo)
    const latestData = JSON.parse(await fs.readFile(latestFile, "utf-8"));
    const oldestData = JSON.parse(await fs.readFile(oldestFile, "utf-8"));

    // Para performance, transforma o array antigo em um Map para busca rápida
    const oldestDataMap = new Map(
      oldestData.map((ticker) => [ticker.symbol, ticker])
    );

    const changes = [];

    for (const latestTicker of latestData) {
      const oldestTicker = oldestDataMap.get(latestTicker.symbol);

      if (oldestTicker && parseFloat(oldestTicker.quoteVolume) > 0) {
        const latestVolume = parseFloat(latestTicker.quoteVolume);
        const oldestVolume = parseFloat(oldestTicker.quoteVolume);
        const percentageChange = ((latestVolume - oldestVolume) / oldestVolume) * 100;

        changes.push({ symbol: latestTicker.symbol, percentageChange });
      }
    }

    const topGainers = changes
      .sort((a, b) => b.percentageChange - a.percentageChange)
      .slice(0, topN);

    console.log(`Top ${topN} Maiores Altas de Volume (nos últimos 5 períodos):`);
    topGainers.forEach((coin, index) => {
      console.log(
        `${(index + 1).toString().padStart(2, " ")}. ${coin.symbol.padEnd(12, " ")}: +${coin.percentageChange.toFixed(2)}%`
      );
    });
  } catch (error) {
    console.error("Ocorreu um erro ao analisar o volume:", error.message);
  }
}

// Para executar este script diretamente: node backend/utils/analyzeFivePeriodVolume.js
(async () => {
  await analyzeFivePeriodVolumeChange(20);
})();

module.exports = { analyzeFivePeriodVolumeChange };