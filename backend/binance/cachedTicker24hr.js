// Cache compartilhado do endpoint público /ticker/24hr
// Usado por getAllCurrencies e get24HsVolume para evitar chamadas duplicadas

const TTL_MS = 30 * 1000; // 30 segundos

let _cache     = null;
let _cachedAt  = 0;
let _inflight  = null;

async function fetchTickers() {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Binance ticker/24hr inesperado: ${JSON.stringify(data)}`);
  }
  return data;
}

module.exports = async function getTickers() {
  if (_cache && Date.now() - _cachedAt < TTL_MS) return _cache;
  if (_inflight) return _inflight;

  _inflight = fetchTickers()
    .then(data => {
      _cache    = data;
      _cachedAt = Date.now();
      _inflight = null;
      return data;
    })
    .catch(err => {
      _inflight = null;
      if (_cache) return _cache; // fallback para cache anterior
      throw err;
    });

  return _inflight;
};
