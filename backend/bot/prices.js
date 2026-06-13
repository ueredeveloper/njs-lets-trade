'use strict';

/**
 * @module prices
 * Funções públicas para buscar preços e candles nas exchanges Binance e Gate.io.
 * Usado pelo bot (rsiTradeBot.js) e pelos testes (backend/tests/bot-prices.test.js).
 */

const GATE_BASE    = 'https://api.gateio.ws/api/v4';
const BINANCE_BASE = 'https://api.binance.com';


/**
 * Busca candles históricos na Binance.
 * @param {string} symbol      - Par no formato Binance, ex: "EDUUSDT"
 * @param {number} [limit=200] - Quantidade de candles (máx 1000)
 * @param {string} [interval='1m'] - Intervalo: '1m','5m','15m','30m','1h','4h','1d'
 * @returns {Promise<Array<{openTime:number, open:number, high:number, low:number, close:number}>>}
 */
async function fetchBinanceCandles(symbol, limit = 200, interval = '1m') {
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Candles Binance ${symbol}: HTTP ${res.status}`);
  const raw = await res.json();
  // Binance retorna: [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map(c => ({
    openTime: Number(c[0]),
    open:  parseFloat(c[1]),
    high:  parseFloat(c[2]),
    low:   parseFloat(c[3]),
    close: parseFloat(c[4]),
  }));
}

/**
 * Busca candles históricos na Gate.io.
 * @param {string} pair        - Par no formato Gate.io, ex: "SKYAI_USDT"
 * @param {number} [limit=200] - Quantidade de candles (máx 1000)
 * @param {string} [interval='30m'] - Intervalo: '1m','5m','15m','30m','1h','4h','1d'
 * @returns {Promise<Array<{openTime:number, open:number, high:number, low:number, close:number}>>}
 */
async function fetchGateCandles(pair, limit = 200, interval = '30m') {
  const url = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Candles Gate ${pair}: HTTP ${res.status}`);
  const raw = await res.json();
  // Gate.io retorna: [timestamp_s, vol_base, close, high, low, open, vol_quote]
  return raw.map(c => ({
    openTime: Number(c[0]) * 1000,
    open:  parseFloat(c[5]),
    high:  parseFloat(c[3]),
    low:   parseFloat(c[4]),
    close: parseFloat(c[2]),
  }));
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
