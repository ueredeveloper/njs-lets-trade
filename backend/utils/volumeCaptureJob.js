const fs = require("fs").promises;
const path = require("path");
const { analyzeFivePeriodVolumeChange } = require("./analyzeFivePeriodVolume");

/**
 * Busca os dados de volume 24h da API da Binance, filtra os pares USDT
 * e salva em um arquivo JSON com timestamp.
 *  * Use: node backend/utils/volumeCaptureJob.js
 */

let captureLen = 0;

async function captureAndSaveVolume() {

  const url = "https://api.binance.com/api/v3/ticker/24hr";

  try {
    // 1. Requisição da lista de todos os tickers 24h
    console.log("Capturando dados de volume 24h da Binance...");
    const response = await fetch(url); // fetch nativo do Node 20
    if (!response.ok) {
      throw new Error(`Erro na API da Binance: ${response.statusText}`);
    }
    const data = await response.json();

    // 2. Preparação do arquivo e diretório
    const timestamp = Date.now();
    const filename = `24Hs-Volume-${timestamp}.json`;
    const volumeDir = path.join(__dirname, "..", "data", "volume");

    // Garante que o diretório de destino exista
    await fs.mkdir(volumeDir, { recursive: true });

    const filePath = path.join(volumeDir, filename);

    // 3. Filtra apenas moedas que fazem par com USDT
    const usdtTickers = data.filter((ticker) =>
      ticker.symbol.endsWith("USDT")
    );

    // 4. Salva os dados no arquivo
    await fs.writeFile(filePath, JSON.stringify(usdtTickers, null, 2));

    console.log(`Dados salvos com sucesso em: ${filename}`);
    captureLen +=1;

    if (captureLen>4) {
       console.log(captureLen, 'analyse five periods volume change')
      analyzeFivePeriodVolumeChange(10, 5)
      captureLen = 0;
    }



  } catch (error) {
    console.error("Falha ao capturar ou salvar os dados de volume:", error);
  }
}

/**
 * Inicia o job que captura o volume a cada 5 minutos.
 */

function startVolumeCaptureJob() {
  const FIVE_MINUTES_IN_MS = 0.5 * 60 * 1000;
  console.log("Iniciando job de captura de volume a cada 5 minutos.");

  captureAndSaveVolume(); // Executa imediatamente na primeira vez
  setInterval(captureAndSaveVolume, FIVE_MINUTES_IN_MS);
}

// Inicia o processo em segundo plano
startVolumeCaptureJob();

module.exports = { startVolumeCaptureJob };
