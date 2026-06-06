const BASE     = 'https://api.binance.com/api/v3';
const PAGE_MAX = 1000; // limite máximo da Binance por chamada

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

async function fetchPage(symbol, interval, limit, endTime) {
  let url = `${BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  if (endTime) url += `&endTime=${endTime}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance klines ${res.status} (${symbol} ${interval}): ${text}`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`Binance klines resposta inesperada`);
  return raw.map(normalizeKline);
}

// Busca até `limit` candles paginando automaticamente quando limit > 1000
module.exports = async function fetchKlines(symbol, interval, limit = 500) {
  if (limit <= PAGE_MAX) return fetchPage(symbol, interval, limit, null);

  // Paginação: busca de trás para frente em janelas de PAGE_MAX
  const pages = [];
  let remaining = limit;
  let endTime   = null;

  while (remaining > 0) {
    const pageSize = Math.min(remaining, PAGE_MAX);
    const page     = await fetchPage(symbol, interval, pageSize, endTime);
    if (!page.length) break;
    pages.unshift(page);                               // insere no início (ordem cronológica)
    endTime   = page[0].openTime - 1;                 // próxima página: anterior ao primeiro candle atual
    remaining -= page.length;
    if (page.length < pageSize) break;                 // chegou ao início do histórico
  }

  // Mescla, deduplica por openTime e ordena
  const merged = pages.flat();
  const unique = Object.values(
    Object.fromEntries(merged.map(c => [c.openTime, c]))
  ).sort((a, b) => a.openTime - b.openTime);

  return unique.slice(-limit);
};
