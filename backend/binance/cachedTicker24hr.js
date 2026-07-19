// Cache compartilhado do endpoint público /ticker/24hr
// Usado por getAllCurrencies e get24HsVolume para evitar chamadas duplicadas

const TTL_MS = 5 * 60 * 1000; // 5 minutos — endpoint traz o mercado inteiro (~275KB/chamada), evitar refetch a cada poll de 30s do frontend

let _cache     = null;
let _cachedAt  = 0;
let _inflight  = null;
let _banUntil  = 0;

function parseBanUntil(data) {
  const m = String(data?.msg ?? '').match(/banned until (\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

async function fetchTickers() {
  if (_banUntil > Date.now()) {
    const waitSec = Math.ceil((_banUntil - Date.now()) / 1000);
    throw new Error(`Binance IP banido — aguarde ~${waitSec}s (até ${new Date(_banUntil).toLocaleTimeString()})`);
  }

  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const data = await res.json();
  if (!Array.isArray(data)) {
    const ban = parseBanUntil(data);
    if (ban > Date.now()) {
      _banUntil = ban;
      const waitSec = Math.ceil((ban - Date.now()) / 1000);
      console.warn(`[ticker24hr] IP banido pela Binance — aguarde ~${waitSec}s`);
    }
    throw new Error(`Binance ticker/24hr inesperado: ${JSON.stringify(data)}`);
  }
  _banUntil = 0;
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
