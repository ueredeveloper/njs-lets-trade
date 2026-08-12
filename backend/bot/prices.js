'use strict';

/**
 * @module prices
 * Funções públicas para buscar preços e candles nas exchanges Binance e Gate.io.
 * Usado pelo bot (rsiTradeBot.js) e pelos testes (backend/tests/bot-prices.test.js).
 */

const getCandles = require('../binance/getCandles');
const { fetchGateKlines } = require('../gate/fetchGateKlines');
const readCandles  = require('../utils/read-candles');
const writeCandles = require('../utils/write-candles');
const convertIntervalToMiliseconds = require('../utils/convert-interval-to-miliseconds');
const { retentionLimitFor } = require('../utils/candleRetentionLimits');
const { withFileLock } = require('../utils/fileLock');

const GATE_BASE    = 'https://api.gateio.ws/api/v4';
const BINANCE_BASE = 'https://api.binance.com';

// `${pair}|${interval}` -> quantidade máxima de candles que a Gate.io realmente devolveu
// numa carga completa (pode ser menor que o `limit` pedido — ver comentário em
// fetchGateCandles). Estado só em memória (por processo) — um restart do bot descobre de
// novo, custo de uma recarga completa a mais, sem problema.
const gateHistoryCeiling = new Map();


/**
 * Busca candles históricos na Binance — via getCandles (cache em disco +
 * paginação automática quando `limit` > 1000, ver backend/binance/getCandles.js e
 * fetchKlines.js). Antes fazia fetch cru direto na API com o `limit` pedido, mas a
 * Binance silenciosamente satura em 1000 candles por chamada (não dá erro, só
 * devolve menos) — pra estratégias que pedem histórico maior nesse único intervalo
 * (ex.: vwap-bands com sessão semanal calculada em candles de 1m, precisa de
 * ~10500 pra cobrir 7 dias — ver getRequiredSpecs em strategyEngine.js e
 * candleRetentionLimits.js), isso fazia a VWAP "semanal" ser calculada de fato só
 * sobre as últimas ~16h de dado, sem nenhum aviso (caso PYRUSDT/ACEUSDT — ver
 * conversa com o usuário). getCandles já resolve isso: pagina via fetchKlines
 * quando precisa carregar do zero e mantém o histórico em disco, atualizando só o
 * delta a cada chamada seguinte.
 * @param {string} symbol      - Par no formato Binance, ex: "EDUUSDT"
 * @param {number} [limit=200] - Quantidade de candles
 * @param {string} [interval='1m'] - Intervalo: '1m','5m','15m','30m','1h','4h','1d'
 * @returns {Promise<Array<{openTime:number, open:number, high:number, low:number, close:number, volume:number}>>}
 */
async function fetchBinanceCandles(symbol, limit = 200, interval = '1m') {
  const raw = await getCandles(symbol, interval, limit);
  return raw.map(c => ({
    openTime: Number(c.openTime),
    open:  parseFloat(c.open),
    high:  parseFloat(c.high),
    low:   parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  }));
}

/**
 * Busca candles históricos na Gate.io — mesmo tratamento dado ao lado Binance
 * (fetchBinanceCandles acima): cache em disco + paginação automática via
 * fetchGateKlines quando `limit` > 1000. Sem isso, VWAP de sessão semanal em
 * candles de 1m na Gate.io tinha o mesmo bug de truncar em ~1000 candles sem
 * aviso nenhum (mesmo caso PYRUSDT/ACEUSDT do lado Binance).
 *
 * Cache em disco chaveado pelo próprio `pair` (formato Gate.io, com underscore —
 * ex.: "PYR_USDT-1m.json") em vez do símbolo Binance: evita colidir tanto com o
 * cache Binance (backend/binance/getCandles.js, símbolo sem underscore) quanto
 * com o cache do screener (backend/gate/getGateCandles.js, chave
 * "{símbolo}_GATE") — os três nunca se sobrepõem, cada um mantém seu histórico
 * de forma independente.
 * @param {string} pair        - Par no formato Gate.io, ex: "SKYAI_USDT"
 * @param {number} [limit=200] - Quantidade de candles
 * @param {string} [interval='30m'] - Intervalo: '1m','5m','15m','30m','1h','4h','1d'
 * @returns {Promise<Array<{openTime:number, open:number, high:number, low:number, close:number, volume:number}>>}
 */
async function fetchGateCandles(pair, limit = 200, interval = '30m') {
  const intervalMs = await convertIntervalToMiliseconds(interval);

  return withFileLock(`${pair}-${interval}`, async () => {
    let dbCandles;
    try {
      dbCandles = await readCandles(pair, interval);
    } catch (err) {
      if (err.code === 'ENOENT') {
        dbCandles = [];
      } else {
        throw err;
      }
    }

    const retentionLimit = retentionLimitFor(interval);
    if (dbCandles.length > retentionLimit) {
      dbCandles = dbCandles.slice(-(retentionLimit - 1));
    }

    // A Gate.io tem um teto próprio de profundidade de histórico por request encadeado (bem
    // menor que a retenção que queremos, ex.: ~9000 candles pra trás em 1m, contra os 10500
    // que uma sessão semanal pediria) — fetchGateKlines já trata isso (para de paginar sem
    // erro ao bater no teto, ver comentário lá). Sem o cache abaixo, `limit > dbCandles.length`
    // ficaria sempre verdadeiro pra esse par (nunca alcança `limit`, mesmo símbolo, mesmo
    // intervalo), e cada tick recarregaria o histórico inteiro do zero (~9 páginas) em vez de
    // só buscar o delta. Lembra, por processo, o teto real já descoberto pra não repetir.
    const ceilingKey = `${pair}|${interval}`;
    const effectiveLimit = Math.min(limit, gateHistoryCeiling.get(ceilingKey) ?? limit);

    if (effectiveLimit > dbCandles.length) {
      // Banco local tem menos candles do que o pedido: carga completa (pagina se limit > 1000).
      const candles = await fetchGateKlines(pair, interval, intervalMs, effectiveLimit);
      if (candles.length < effectiveLimit) gateHistoryCeiling.set(ceilingKey, candles.length);
      await writeCandles(pair, interval, candles);
      return candles.slice(-limit);
    }

    const dbLastItemOpenTime = dbCandles.length > 0 ? dbCandles[dbCandles.length - 1].openTime : Date.now();
    const limitForUpdateDb   = Math.floor((Date.now() - dbLastItemOpenTime) / intervalMs);

    if (limitForUpdateDb > 0) {
      const newCandles = await fetchGateKlines(pair, interval, intervalMs, Math.min(limitForUpdateDb, retentionLimit));
      newCandles.forEach(c => dbCandles.push(c));
    } else {
      const [latest] = await fetchGateKlines(pair, interval, intervalMs, 1);
      if (latest) { dbCandles.pop(); dbCandles.push(latest); }
    }

    // Deduplica por openTime (mesmo padrão do getCandles.js)
    const uniqueMap = {};
    dbCandles.forEach(c => { uniqueMap[c.openTime] = c; });
    const uniqueArray = Object.values(uniqueMap).sort((a, b) => a.openTime - b.openTime);

    await writeCandles(pair, interval, uniqueArray);
    return uniqueArray.slice(-limit);
  });
}

/**
 * Retorna o preço atual (último negócio executado) de um par na Binance.
 * Usa o endpoint de ticker — não depende de intervalo de candle.
 * @param {string} symbol - Par no formato Binance, ex: "EDUUSDT"
 * @returns {Promise<number>} Preço em USDT
 */
async function fetchBinanceCurrentPrice(symbol) {
  const url = `${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ticker Binance ${symbol}: HTTP ${res.status}`);
  const data = await res.json();
  const price = parseFloat(data.price);
  if (!price) throw new Error(`Ticker Binance ${symbol}: preço inválido`);
  return price;
}

/**
 * Retorna o preço atual (último negócio executado) de um par na Gate.io.
 * Usa o endpoint de ticker — não depende de intervalo de candle.
 * @param {string} pair - Par no formato Gate.io, ex: "SKYAI_USDT"
 * @returns {Promise<number>} Preço em USDT
 */
async function fetchGateCurrentPrice(pair) {
  const url = `${GATE_BASE}/spot/tickers?currency_pair=${pair}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ticker Gate ${pair}: HTTP ${res.status}`);
  const data = await res.json();
  const price = parseFloat(data[0]?.last);
  if (!price) throw new Error(`Ticker Gate ${pair}: preço inválido`);
  return price;
}

module.exports = {
  fetchBinanceCandles,
  fetchGateCandles,
  fetchBinanceCurrentPrice,
  fetchGateCurrentPrice,
};
