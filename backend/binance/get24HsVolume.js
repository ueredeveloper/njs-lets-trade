const { getActiveUsdtPairs }  = require("./getActiveUsdtPairs");
const { getAllGateCurrencies } = require("../gate/getAllGateCurrencies");
const getTickers               = require("./cachedTicker24hr");

async function get24hVolumeFilters() {
  const [binanceData, gateCurrencies, listedOnBinance] = await Promise.all([
    getTickers(),
    getAllGateCurrencies().catch(() => []),
    getActiveUsdtPairs(),
  ]);

  const binance = binanceData
    .filter(t => t.symbol.endsWith("USDT"))
    .map(t => ({ symbol: t.symbol, volume: Number(t.quoteVolume) }));

  const gate = gateCurrencies.map(t => ({ symbol: t.symbol, volume: t.volume }));

  // Inclui símbolo se ALGUMA das corretoras atingir o volume mínimo (e máximo opcional)
  function makeFilter(name, minVol, maxVol = Infinity) {
    const symbols = new Set();
    for (const t of binance) {
      if (t.volume >= minVol && t.volume < maxVol) symbols.add(t.symbol);
    }
    for (const t of gate) {
      if (t.volume >= minVol && t.volume < maxVol) symbols.add(t.symbol);
    }
    return { name, list: Array.from(symbols) };
  }

  return [
    listedOnBinance,
    makeFilter("Mercado|3M⇾",     3_000_000),
    makeFilter("Mercado|5M⇾",     5_000_000),
    makeFilter("Mercado|5M⇿30M",  5_000_000, 30_000_000),
    makeFilter("Mercado|30M⇿50M", 30_000_000, 50_000_000),
    makeFilter("Mercado|50M⇾",    50_000_000),
  ];
}

module.exports = { get24hVolumeFilters };
