
/*
use: node ./backend/utils/analysePriceChangePercent.js
*/

async function getTopGainers({
  limit = 10,
  minVolumeUSDT = 1_000_000
} = {}) {
  const url = "https://api.binance.com/api/v3/ticker/24hr";

  const response = await fetch(url);
  const data = await response.json();

  return data
    // apenas pares USDT (mais comuns)
    .filter(ticker => ticker.symbol.endsWith("USDT"))
    
    // filtra volume mínimo
    .filter(ticker => Number(ticker.quoteVolume) >= minVolumeUSDT)

    // ordena pelo maior ganho percentual
    .sort(
      (a, b) =>
        Number(b.priceChangePercent) - Number(a.priceChangePercent)
    )

    // limita quantidade
    .slice(0, limit)
    .map(ticker => ({
      symbol: ticker.symbol,
      priceChangePercent: Number(ticker.priceChangePercent),
      lastPrice: Number(ticker.lastPrice),
      volumeUSDT: Number(ticker.quoteVolume)
    }));
}

const gainers = await getTopGainers({
  limit: 10,
  minVolumeUSDT: 5_000_000
});

console.log(gainers);