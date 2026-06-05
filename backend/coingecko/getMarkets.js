const TTL_MS = 15 * 60 * 1000; // 15 minutos

let _cache    = null;
let _cachedAt = 0;
let _inflight = null;

async function fetchPage(page) {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status} (page ${page})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`CoinGecko resposta inesperada: ${JSON.stringify(data).slice(0, 80)}`);
  return data;
}

async function build() {
  const [p1, p2] = await Promise.all([fetchPage(1), fetchPage(2)]);
  const map = {};
  for (const coin of [...p1, ...p2]) {
    const key = coin.symbol.toLowerCase();
    // Em caso de símbolo duplicado, mantém maior market cap
    if (!map[key] || (coin.market_cap ?? 0) > (map[key].market_cap ?? 0)) {
      map[key] = {
        market_cap:   coin.market_cap,
        total_volume: coin.total_volume,
        fdv:          coin.fully_diluted_valuation,
        rank:         coin.market_cap_rank,
      };
    }
  }
  console.log(`[CoinGecko] ${Object.keys(map).length} moedas carregadas`);
  return map;
}

module.exports = async function getMarkets() {
  if (_cache && Date.now() - _cachedAt < TTL_MS) return _cache;
  if (_inflight) return _inflight;
  _inflight = build()
    .then(data  => { _cache = data; _cachedAt = Date.now(); _inflight = null; return data; })
    .catch(err  => { _inflight = null; if (_cache) return _cache; throw err; });
  return _inflight;
};
