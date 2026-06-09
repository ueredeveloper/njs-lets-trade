const { toGateSymbol } = require('../utils/toGateSymbol');
const supabase         = require('../supabase/client');

const GATE_BASE  = 'https://api.gateio.ws/api/v4';
const USER_ID    = process.env.SUPABASE_DEFAULT_USER_ID;

async function fetchGateTicker(binanceSymbol) {
  const pair = toGateSymbol(binanceSymbol);
  const res  = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`);
  if (!res.ok) return { price: '', volume: 0 };
  const data = await res.json();
  return {
    price:  data[0]?.last ?? '',
    volume: parseFloat(data[0]?.quote_volume ?? 0),
  };
}

let _cachedCurrencies = null;
let _cachedAt = 0;
const CURRENCIES_TTL_MS = 30 * 1000; // 30 segundos

// Promise em andamento para evitar chamadas duplicadas simultâneas
let _inflight = null;

const getTickers = require('./cachedTicker24hr');

async function fetchCurrencies() {
  const tickers = await getTickers();

  const currencies = tickers.map((t) => ({
    symbol: t.symbol,
    price:  t.lastPrice,
    volume: parseFloat(t.quoteVolume),
  }));

  // Inclui moedas Gate.io adicionadas pelo usuário via busca
  let gateAdded = [];
  if (USER_ID) {
    const { data } = await supabase
      .from('favorites_gate')
      .select('symbol')
      .eq('user_id', USER_ID)
      .eq('gate_added', true);
    gateAdded = (data ?? []).map(r => r.symbol);
  }

  for (const sym of gateAdded) {
    if (!currencies.some((c) => c.symbol === sym)) {
      const { price, volume } = await fetchGateTicker(sym).catch(() => ({ price: '', volume: 0 }));
      currencies.push({ symbol: sym, price, volume });
    }
  }

  return currencies;
}

module.exports = getAllCurrencies = async function () {
  if (_cachedCurrencies && Date.now() - _cachedAt < CURRENCIES_TTL_MS) {
    return _cachedCurrencies;
  }

  // Deduplica chamadas simultâneas: todas aguardam a mesma promise
  if (_inflight) return _inflight;

  _inflight = fetchCurrencies()
    .then((result) => {
      _cachedCurrencies = result;
      _cachedAt = Date.now();
      _inflight = null;
      return result;
    })
    .catch((error) => {
      console.error('Error fetching prices:', error.message);
      _inflight = null;
      // Retorna o cache anterior se disponível, senão relança
      if (_cachedCurrencies) return _cachedCurrencies;
      throw error;
    });

  return _inflight;
};
