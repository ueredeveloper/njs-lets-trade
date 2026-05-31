const writeCandles               = require('../utils/write-candles');
const readCandles                = require('../utils/read-candles');
const convertIntervalToMiliseconds = require('../utils/convert-interval-to-miliseconds');
const { toGateSymbol }           = require('../utils/toGateSymbol');

const GATE_BASE = 'https://api.gateio.ws/api/v4';

// Intervalos buscados no modo "all"
const ALL_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

/**
 * Gate.io candle array:
 *   [0] t   – Unix timestamp em segundos (abertura)
 *   [1] v   – Volume em moeda base
 *   [2] c   – Fechamento
 *   [3] h   – Máxima
 *   [4] l   – Mínima
 *   [5] o   – Abertura
 *   [6] sum – Volume em moeda de cotação
 *
 * Converte para o formato padrão do projeto (mesmo do getCandles/Binance).
 */
function normalizeCandle(raw, intervalMs) {
  const fmt = (v) => parseFloat(v).toFixed(8);
  const openTimeMs = parseInt(raw[0]) * 1000;
  return {
    openTime:         openTimeMs,
    open:             fmt(raw[5]),
    high:             fmt(raw[3]),
    low:              fmt(raw[4]),
    close:            fmt(raw[2]),
    volume:           fmt(raw[1]),
    closeTime:        openTimeMs + intervalMs - 1,
    quoteVolume:      raw[6] ? fmt(raw[6]) : '0.00000000',
    trades:           0,
    baseAssetVolume:  '0.00000000',
    quoteAssetVolume: '0.00000000',
  };
}

/** Busca candles brutos da Gate.io e retorna normalizados. */
async function fetchFromGate(binanceSymbol, interval, limit) {
  const pair = toGateSymbol(binanceSymbol);
  const url  = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gate.io ${res.status} (${pair} ${interval}): ${text}`);
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`Gate.io resposta inesperada: ${JSON.stringify(raw)}`);

  const intervalMs = await convertIntervalToMiliseconds(interval);
  return raw.map(c => normalizeCandle(c, intervalMs));
}

/**
 * Mesmo padrão do getCandles:
 *  - Lê o JSON local existente
 *  - Calcula quantos candles novos buscar com base no tempo decorrido
 *  - Faz merge e deduplica por openTime
 *  - Salva e retorna os candles solicitados
 *
 * @param {string}  symbol   Símbolo Binance. Ex: 'FIOUSDT'
 * @param {string}  interval Ex: '1h', '4h', '8h'
 * @param {number}  limit    Quantidade de candles a retornar
 */
async function getGateCandles(symbol, interval, limit) {
  let dbCandles;
  try {
    dbCandles = await readCandles(symbol, interval);
  } catch (err) {
    if (err.code === 'ENOENT') {
      writeCandles(symbol, interval, []);
      dbCandles = [];
    } else {
      throw err;
    }
  }

  if (dbCandles.length > 3000) {
    dbCandles = dbCandles.slice(-2999);
  }

  const currentTimestamp  = Date.now();
  const dbLastItemOpenTime = dbCandles.length > 0
    ? dbCandles.slice(-1)[0].openTime
    : Date.now();

  const timeDifference   = currentTimestamp - dbLastItemOpenTime;
  const miliseconds      = await convertIntervalToMiliseconds(interval);
  const limitForUpdateDb = Math.floor(timeDifference / miliseconds);

  if (limit > dbCandles.length) {
    // Banco local tem menos candles do que o solicitado: faz carga completa
    const candles = await fetchFromGate(symbol, interval, limit);
    writeCandles(symbol, interval, candles);
    return candles;
  }

  if (limitForUpdateDb > 0) {
    // Há candles novos: busca apenas o delta
    const newCandles = await fetchFromGate(symbol, interval, limitForUpdateDb);
    newCandles.forEach(c => dbCandles.push(c));
  } else {
    // Atualiza somente o candle atual (em formação)
    const [latest] = await fetchFromGate(symbol, interval, 1);
    dbCandles.pop();
    dbCandles.push(latest);
  }

  // Deduplica por openTime (mesmo padrão do getCandles)
  const uniqueMap = {};
  dbCandles.forEach(c => { uniqueMap[c.openTime] = c; });
  const uniqueArray = Object.values(uniqueMap);

  writeCandles(symbol, interval, uniqueArray);
  return uniqueArray.slice(-limit);
}

module.exports = { getGateCandles };

// Uso direto:
//   node backend/gate/getGateCandles.js FIOUSDT          → todos os intervalos (1000 candles cada)
//   node backend/gate/getGateCandles.js FIOUSDT 8h       → só 8h
if (require.main === module) {
  const [,, symbol = 'FIOUSDT', interval = 'all'] = process.argv;
  const intervals = interval === 'all' ? ALL_INTERVALS : [interval];

  console.log(`\nGate.io → ${symbol}  [${intervals.join(', ')}]\n`);

  (async () => {
    for (const iv of intervals) {
      process.stdout.write(`  ${iv.padEnd(4)} ... `);
      try {
        const candles = await getGateCandles(symbol, iv, 1000);
        console.log(`${candles.length} candles  →  ${symbol}-${iv}.json`);
      } catch (err) {
        console.log(`ERRO: ${err.message}`);
      }
    }
    console.log('\nConcluído.');
  })();
}
