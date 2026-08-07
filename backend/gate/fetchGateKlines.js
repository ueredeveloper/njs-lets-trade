'use strict';

/**
 * Busca candles brutos da Gate.io paginando automaticamente quando `limit` > 1000 (teto
 * por chamada da Gate — mesmo valor da Binance, ver backend/binance/fetchKlines.js, que
 * segue a mesma ideia: pagina pra trás usando o parâmetro `to` da API, em vez de `endTime`
 * como na Binance).
 *
 * Sem isso, um pedido de histórico maior que 1000 candles nesse único intervalo (ex.: VWAP
 * de sessão semanal calculada em candles de 1m, que precisa de ~10500 pra cobrir 7 dias —
 * ver candleRetentionLimits.js) voltava truncado nos últimos ~1000 candles sem erro nenhum
 * — mesmo bug que existia do lado Binance (caso PYRUSDT/ACEUSDT).
 */

const GATE_BASE = 'https://api.gateio.ws/api/v4';
const PAGE_MAX  = 1000;

/** Gate.io retorna [t(s), v(base), c, h, l, o, sum(quote), closed?] — mesmo formato usado
 *  em getGateCandles.js, mas aqui devolve OHLCV já em número (mesmo contrato do
 *  fetchBinanceCandles/fetchGateCandles de prices.js), não string. */
function normalizeCandle(raw) {
  return {
    openTime: parseInt(raw[0], 10) * 1000,
    open:  parseFloat(raw[5]),
    high:  parseFloat(raw[3]),
    low:   parseFloat(raw[4]),
    close: parseFloat(raw[2]),
    volume: parseFloat(raw[1]),
  };
}

async function fetchPage(pair, interval, limit, toSec) {
  let url = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=${limit}`;
  if (toSec != null) url += `&to=${toSec}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gate.io klines ${res.status} (${pair} ${interval}): ${text}`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`Gate.io klines resposta inesperada: ${JSON.stringify(raw)}`);
  return raw;
}

/**
 * @param {string} pair       Par no formato Gate.io, ex: "PYR_USDT"
 * @param {string} interval   Ex: '1m', '15m', '4h'
 * @param {number} intervalMs Duração do candle em ms (convertIntervalToMiliseconds(interval))
 * @param {number} [limit=500]
 */
async function fetchGateKlines(pair, interval, intervalMs, limit = 500) {
  if (limit <= PAGE_MAX) {
    const raw = await fetchPage(pair, interval, limit, null);
    return raw.map(normalizeCandle);
  }

  // Paginação: busca de trás pra frente em janelas de PAGE_MAX, usando `to` (segundos) —
  // confirmado empiricamente que `to = openTime_do_primeiro_candle_da_pagina - 1` devolve a
  // página imediatamente anterior sem gap nem sobreposição.
  const intervalSec = Math.floor(intervalMs / 1000);
  const pages = [];
  let remaining = limit;
  let toSec = null;

  while (remaining > 0) {
    const pageSize = Math.min(remaining, PAGE_MAX);
    let raw;
    try {
      // eslint-disable-next-line no-await-in-loop
      raw = await fetchPage(pair, interval, pageSize, toSec);
    } catch (err) {
      // Gate.io tem um teto próprio de profundidade de histórico por request encadeado
      // (~10000 candles pra trás, mensagem "Candlestick too long ago"), menor que o que
      // daria pra cobrir uma sessão semanal em 1m (10080). Trata como "chegou ao início
      // do que a Gate deixa consultar" — devolve o que já foi paginado até aqui em vez de
      // derrubar a chamada inteira (mesmo espírito do `raw.length < pageSize` abaixo).
      if (toSec != null && /too long ago/i.test(err.message)) break;
      throw err;
    }
    if (!raw.length) break;
    pages.unshift(raw);
    toSec = parseInt(raw[0][0], 10) - 1;
    remaining -= raw.length;
    if (raw.length < pageSize) break; // chegou ao início do histórico
  }

  const merged = pages.flat().map(normalizeCandle);
  const unique = Object.values(
    Object.fromEntries(merged.map(c => [c.openTime, c])),
  ).sort((a, b) => a.openTime - b.openTime);

  return unique.slice(-limit);
}

module.exports = { fetchGateKlines };
