const writeCandles               = require('../utils/write-candles');
const readCandles                = require('../utils/read-candles');
const convertIntervalToMiliseconds = require('../utils/convert-interval-to-miliseconds');
const { toGateSymbol }           = require('../utils/toGateSymbol');
const { retentionLimitFor }      = require('../utils/candleRetentionLimits');
const { withFileLock }           = require('../utils/fileLock');

const GATE_BASE      = 'https://api.gateio.ws/api/v4';
const GATE_MAX_LIMIT = 1000;

// `${symbol}_GATE|${interval}` -> quantidade máxima de candles que a Gate.io realmente
// devolveu numa carga completa (pode ser menor que o `limit` pedido — ver comentário no
// bloco `if (limit > dbCandles.length)` de getGateCandles). Só em memória (por processo):
// sem isso, um símbolo cujo histórico reachável da Gate é menor que `limit` (ex.: ~9000 em
// 1m, contra os 10500 pedidos pra sessão semanal) nunca alcançaria `limit` no cache, e cada
// chamada recarregaria tudo de novo do zero em vez de só buscar o delta.
const gateHistoryCeiling = new Map();

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

async function fetchGatePage(pair, interval, limit, toSec) {
  let url = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=${limit}`;
  if (toSec != null) url += `&to=${toSec}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gate.io ${res.status} (${pair} ${interval}): ${text}`);
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`Gate.io resposta inesperada: ${JSON.stringify(raw)}`);
  return raw;
}

/**
 * Busca candles brutos da Gate.io e retorna normalizados — pagina pra trás (parâmetro `to`,
 * em segundos) quando `limit` > 1000 (teto por chamada da Gate.io, mesma ideia de
 * backend/binance/fetchKlines.js pro lado Binance/`endTime`). Sem isso, um pedido de
 * histórico maior nesse único intervalo (ex.: VWAP semanal em candles de 1m, ~10500 candles
 * pra cobrir 7 dias — ver candleRetentionLimits.js) voltava truncado nos últimos ~1000
 * candles sem erro nenhum — mesmo bug que existia do lado Binance (caso PYRUSDT/ACEUSDT).
 *
 * A Gate.io também tem um teto próprio de profundidade de histórico por request encadeado
 * (erro "Candlestick too long ago", ~10000 candles pra trás em 1m — menos que os 10080 de uma
 * semana cheia, mas próximo). Trata isso como "chegou ao início do que a Gate deixa
 * consultar": devolve o que já foi paginado até aqui em vez de derrubar a chamada inteira.
 */
async function fetchFromGate(binanceSymbol, interval, limit) {
  const pair = toGateSymbol(binanceSymbol);
  const intervalMs = await convertIntervalToMiliseconds(interval);

  if (limit <= GATE_MAX_LIMIT) {
    const raw = await fetchGatePage(pair, interval, limit, null);
    return raw.map(c => normalizeCandle(c, intervalMs));
  }

  const intervalSec = Math.floor(intervalMs / 1000);
  const pages = [];
  let remaining = limit;
  let toSec = null;

  while (remaining > 0) {
    const pageSize = Math.min(remaining, GATE_MAX_LIMIT);
    let raw;
    try {
      // eslint-disable-next-line no-await-in-loop
      raw = await fetchGatePage(pair, interval, pageSize, toSec);
    } catch (err) {
      if (toSec != null && /too long ago/i.test(err.message)) break;
      throw err;
    }
    if (!raw.length) break;
    pages.unshift(raw);
    toSec = parseInt(raw[0][0], 10) - 1;
    remaining -= raw.length;
    if (raw.length < pageSize) break; // chegou ao início do histórico
  }

  const merged = pages.flat().map(c => normalizeCandle(c, intervalMs));
  const unique = Object.values(
    Object.fromEntries(merged.map(c => [c.openTime, c])),
  ).sort((a, b) => a.openTime - b.openTime);

  return unique.slice(-limit);
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
  // Chave de cache própria (não `symbol` puro) — `getCandles.js` (Binance) usa a mesma
  // dupla readCandles/writeCandles com `${symbol}-${interval}.json`. Sem esse sufixo, um
  // símbolo consultado nas duas corretoras (ex.: geral pela Binance, favorito configurado
  // pra Gate) faz os dois merges caírem no MESMO arquivo, misturando preço/volume de
  // exchanges diferentes pro resto da vida do cache (achado investigando BANKUSDT
  // mostrando VWAP muito diferente da que o bot realmente usa — ver git blame).
  const cacheKey = `${symbol}_GATE`;

  return withFileLock(`${cacheKey}-${interval}`, async () => {
    let dbCandles;
    try {
      dbCandles = await readCandles(cacheKey, interval);
    } catch (err) {
      if (err.code === 'ENOENT') {
        await writeCandles(cacheKey, interval, []);
        dbCandles = [];
      } else {
        throw err;
      }
    }

    const retentionLimit = retentionLimitFor(interval);
    if (dbCandles.length > retentionLimit) {
      dbCandles = dbCandles.slice(-(retentionLimit - 1));
    }

    const currentTimestamp  = Date.now();
    const dbLastItemOpenTime = dbCandles.length > 0
      ? dbCandles.slice(-1)[0].openTime
      : Date.now();

    const timeDifference   = currentTimestamp - dbLastItemOpenTime;
    const miliseconds      = await convertIntervalToMiliseconds(interval);
    const limitForUpdateDb = Math.floor(timeDifference / miliseconds);

    const ceilingKey = `${cacheKey}|${interval}`;
    const effectiveLimit = Math.min(limit, gateHistoryCeiling.get(ceilingKey) ?? limit);

    if (effectiveLimit > dbCandles.length) {
      // Banco local tem menos candles do que o solicitado: faz carga completa (pagina se
      // effectiveLimit > 1000 — ver fetchFromGate). Se a Gate devolver menos que o pedido
      // (bateu no teto de histórico dela), trava esse teto pra essa chave — sem isso,
      // `effectiveLimit > dbCandles.length` ficaria sempre verdadeiro e cada chamada
      // recarregaria tudo de novo em vez de só buscar o delta.
      const candles = await fetchFromGate(symbol, interval, effectiveLimit);
      if (candles.length < effectiveLimit) gateHistoryCeiling.set(ceilingKey, candles.length);
      await writeCandles(cacheKey, interval, candles);
      return candles.slice(-limit);
    }

    if (limitForUpdateDb > 0) {
      // Há candles novos: busca apenas o delta (fetchFromGate pagina se precisar)
      const newCandles = await fetchFromGate(symbol, interval, Math.min(limitForUpdateDb, retentionLimit));
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

    await writeCandles(cacheKey, interval, uniqueArray);
    return uniqueArray.slice(-limit);
  });
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
