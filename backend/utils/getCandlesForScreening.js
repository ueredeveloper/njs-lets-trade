'use strict';

const readCandles = require('./read-candles');
const { assessDiskCandles } = require('./candleFreshness');
const candleUpdateQueue = require('./candleUpdateQueue');

/**
 * Prefer candles from backend/data/candlestick/{symbol}-{interval}.json.
 * Atualizações via API entram numa fila com rate limit — nunca dispara centenas de requests de uma vez.
 *
 * @returns {Promise<{ candles: object[], source: 'disk'|'disk-stale'|'api' }>}
 */
async function getCandlesForScreening(symbol, interval, limit) {
  let disk = [];
  try {
    disk = await readCandles(symbol, interval);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const status = assessDiskCandles(disk, interval, limit);

  if (status === 'fresh') {
    return { candles: disk.slice(-limit), source: 'disk' };
  }

  if (status === 'stale' || status === 'very-stale') {
    const priority = status === 'very-stale' ? 3 : 1;
    candleUpdateQueue.enqueue(symbol, interval, limit, priority);
    try {
      const candles = await candleUpdateQueue.fetch(symbol, interval, limit, { priority: 8, timeoutMs: 20_000 });
      return { candles, source: 'api' };
    } catch {
      return { candles: disk.slice(-limit), source: 'disk-stale' };
    }
  }

  // missing ou insufficient — sem fallback em disco (diferente de "stale"), então precisa de
  // pelo menos a mesma urgência da fila que o caso "stale" (8), senão fica atrás de refreshes
  // de dados já existentes e estoura o timeout em fila congestionada — símbolo nunca aparece
  // (ver conversa sobre % de largura sumindo pra símbolos recém-favoritados nos favoritos BB).
  const candles = await candleUpdateQueue.fetch(symbol, interval, limit, { priority: 8 });
  return { candles, source: 'api' };
}

module.exports = getCandlesForScreening;
