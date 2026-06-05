const BASE = 'https://api.binance.com/api/v3';

// Converte o array bruto da Binance para o objeto usado no projeto
function normalizeKline(k) {
  return {
    openTime:         k[0],
    open:             k[1],
    high:             k[2],
    low:              k[3],
    close:            k[4],
    volume:           k[5],
    closeTime:        k[6],
    quoteVolume:      k[7],
    trades:           k[8],
    baseAssetVolume:  k[9],
    quoteAssetVolume: k[10],
  };
}

module.exports = async function fetchKlines(symbol, interval, limit = 500) {
  const url = `${BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance klines ${res.status} (${symbol} ${interval}): ${text}`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error(`Binance klines resposta inesperada: ${JSON.stringify(raw)}`);
  }
  return raw.map(normalizeKline);
};
