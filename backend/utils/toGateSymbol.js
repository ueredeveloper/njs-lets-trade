/**
 * Converte símbolo no formato Binance para o formato Gate.io.
 * Ex: FIOUSDT → FIO_USDT, BTCUSDT → BTC_USDT
 */
function toGateSymbol(binanceSymbol) {
  const quotes = ['USDT', 'BTC', 'ETH', 'BNB', 'BUSD'];
  for (const q of quotes) {
    if (binanceSymbol.endsWith(q)) {
      return `${binanceSymbol.slice(0, -q.length)}_${q}`;
    }
  }
  return binanceSymbol;
}

module.exports = { toGateSymbol };
