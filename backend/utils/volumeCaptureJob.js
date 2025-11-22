const fs = require("fs").promises;
const path = require("path");
const { anaylsePeriodVolumeChange } = require("./analysePeriodVolumeChange");
const { analyseVolume } = require("./analyseVolume");

let captureLen = 0;
let jobInterval = 1;
let interval = null;


/**
 * How to use: node ./backend/utils/volumeCaptureJob.js
 */
function startVolumeCaptureJob() {
  const MINUTES_IN_MS = 1 * 60 * 1000;

  console.log(`Iniciando job de captura de volume a cada ${MINUTES_IN_MS / 1000 / 60} minuto(s).`);

  // Executa a primeira imediatamente
  captureAndSaveVolume();

  // Repetir a cada intervalo
  interval = setInterval(captureAndSaveVolume, MINUTES_IN_MS);
}

async function captureAndSaveVolume() {
  const url = "https://api.binance.com/api/v3/ticker/24hr";

  try {

    console.log("Capturando dados de volume 24h da Binance");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Erro na API da Binance: ${response.statusText}`);
    }

    const data = await response.json();

    const timestamp = Date.now();
    const filename = `24Hs-Volume-${timestamp}.json`;
    const volumeDir = path.join(__dirname, "..", "data", "volume");
    const filePath = path.join(volumeDir, filename);

    await fs.mkdir(volumeDir, { recursive: true });

    const usdtTickers = data.filter(
      (ticker) => ticker.symbol.endsWith("USDT") && ticker.quoteVolume > 9_000_000
    );

    await fs.writeFile(filePath, JSON.stringify(usdtTickers, null, 2));

    //console.log(`Dados salvos com sucesso em: ${filename}`);

    captureLen++;

    // Quando fizer 5 capturas…
    if (captureLen >= 5) {
      anaylsePeriodVolumeChange(10, 5);

      analyseVolume();

      captureLen = 0;
      jobInterval++;

      //console.log("Job interval:", jobInterval);

      // ➤ Para o job quando jobInterval chegar a 4. Então fará 3 verificações e parará.
      if (jobInterval === 4) {
        //console.log("Job finalizado. Parando interval... valor: ", jobInterval);
        clearInterval(interval);
      }
    }
  } catch (error) {
    console.error("Falha ao capturar ou salvar os dados de volume:", error);
  }
}


(async () => {
  startVolumeCaptureJob();
})();

module.exports = { startVolumeCaptureJob };
