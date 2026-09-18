/**
 * Retorna os pares USDT da Binance que NÃO estão em status TRADING (BREAK, HALT, etc.) — o
 * inverso de getActiveUsdtPairs.js. Usado pela categoria "Pausadas (BREAK)" de Configurações →
 * Exibição de ativos, pra esconder por padrão moedas que a Binance suspendeu (ex.: PONDUSDT,
 * status BREAK) sem precisar tirá-las manualmente de favoritos/filtros.
 * Resultado cacheado por 1 hora.
 *
 * @returns {Promise<string[]>} Símbolos USDT fora de TRADING (ex.: ['PONDUSDT', ...]).
 */
let _cachedPairs = null;
let _cachedAt = 0;
const PAIRS_TTL_MS = 60 * 60 * 1000; // 1 hora

async function getBreakUsdtPairs() {
  if (_cachedPairs && Date.now() - _cachedAt < PAIRS_TTL_MS) {
    return _cachedPairs;
  }

  try {
    const url = 'https://api.binance.com/api/v3/exchangeInfo';
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data.symbols)) {
      const msg = data.msg ?? JSON.stringify(data);
      if (_cachedPairs) {
        console.warn('[getBreakUsdtPairs] API indisponível — usando cache:', msg);
        return _cachedPairs;
      }
      throw new Error(`exchangeInfo inesperado: ${msg}`);
    }

    const breakUsdtPairs = data.symbols
      .filter(s => s.symbol.endsWith('USDT'))
      .filter(s => s.status !== 'TRADING')
      .map(s => s.symbol);

    _cachedPairs = breakUsdtPairs;
    _cachedAt = Date.now();
    return _cachedPairs;
  } catch (err) {
    if (_cachedPairs) {
      console.warn('[getBreakUsdtPairs] falha — usando cache:', err.message);
      return _cachedPairs;
    }
    throw err;
  }
}

module.exports = { getBreakUsdtPairs };
