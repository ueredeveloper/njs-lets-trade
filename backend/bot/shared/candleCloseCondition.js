'use strict';

/**
 * Entrada "no fechamento do candle" da OCO manual do gráfico (entry_kind 'candle_close'): o pedido
 * é feito com o candle do gráfico ainda aberto e o bot só compra (a mercado) depois que ele FECHA,
 * se o candle NÃO fechou num padrão de baixa / rejeição de alta (bearishClosePattern):
 *   1 candle — shooting star, inverted hammer, gravestone doji (upperWickRejection) e hanging man
 *   (só depois de alta); 2 candles (com o anterior) — bearish engulfing e tweezer top.
 * Evita ficar olhando o gráfico até o candle fechar pra ver se a moeda segurou a alta.
 *
 * Candles de minuto/hora/dia da Binance e da Gate são alinhados no epoch UTC, então o candle aberto
 * agora é floor(now / intervalo) — semana (1w, começa na segunda) fica de fora.
 */

const fetchKlines = require('../../binance/fetchKlines');
const { fetchGateKlines } = require('../../gate/fetchGateKlines');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const BINANCE_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'];
const GATE_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '8h', '1d'];

function intervalMs(interval) {
  const m = /^(\d+)([mhd])$/.exec(interval ?? '');
  return m ? Number(m[1]) * UNIT_MS[m[2]] : NaN;
}

/**
 * Monta o close_condition a gravar na linha, a partir do candle ABERTO agora.
 * @throws Error com mensagem pro usuário se o intervalo não for suportado
 */
function buildCloseCondition({ exchange, interval }, nowMs = Date.now()) {
  const allowed = exchange === 'gate' ? GATE_INTERVALS : BINANCE_INTERVALS;
  if (!allowed.includes(interval)) {
    throw new Error(`intervalo ${interval} não suportado pra compra no fechamento (${exchange}: ${allowed.join(', ')})`);
  }
  const ivMs = intervalMs(interval);
  const candleOpenTime = Math.floor(nowMs / ivMs) * ivMs;
  return { interval, candleOpenTime, closeAt: candleOpenTime + ivMs };
}

/**
 * Candle de rejeição de alta: shooting star (vermelho), inverted hammer (verde) ou gravestone doji
 * (corpo ~0). Os três = pavio superior >= 2× o corpo com o topo do corpo nos 40% de baixo do range.
 * @returns {string|null} nome do padrão, ou null se o candle segurou a alta
 */
function upperWickRejection({ open, high, low, close }) {
  const range = high - low;
  if (!(range > 0)) return null;
  const bodyTop = Math.max(open, close);
  const body = Math.abs(close - open);
  const upper = high - bodyTop;
  if (!(upper >= 2 * body && (bodyTop - low) <= 0.4 * range)) return null;
  if (body <= 0.1 * range) return 'gravestone doji';
  return close < open ? 'shooting star' : 'inverted hammer';
}

const isGreen = (c) => c.close > c.open;
const isRed = (c) => c.close < c.open;

/** Alta antes do candle: o último anterior fechou acima do fechamento de 3 candles antes dele. */
function priorUptrend(prev) {
  if (prev.length < 4) return false;
  return prev[prev.length - 1].close > prev[prev.length - 4].close;
}

/**
 * Hanging man: corpo nos 30% de cima, pavio inferior >= 2× o corpo, pavio superior pequeno — o
 * mesmo desenho do hammer, mas DEPOIS DE ALTA (aí é sinal de baixa). Dragonfly (corpo ~0) entra.
 */
function hangingMan(c, prev) {
  const range = c.high - c.low;
  if (!(range > 0) || !priorUptrend(prev)) return false;
  const body = Math.abs(c.close - c.open);
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);
  return lower >= 2 * body && lower >= 0.6 * range && upper <= 0.1 * range;
}

/** Bearish engulfing: anterior verde, este vermelho e o corpo deste cobre o corpo inteiro do anterior. */
function bearishEngulfing(c, p) {
  return !!p && isGreen(p) && isRed(c) && c.open >= p.close && c.close <= p.open;
}

// Tweezer top: máximas "iguais" — até 0,2% de diferença (cripto raramente bate o mesmo tick).
const TWEEZER_HIGH_TOL = 0.002;
function tweezerTop(c, p) {
  return !!p && isGreen(p) && isRed(c) && Math.abs(c.high - p.high) <= TWEEZER_HIGH_TOL * Math.max(c.high, p.high);
}

/**
 * Padrão de baixa no candle que acabou de fechar.
 * @param {{open,high,low,close}} candle
 * @param {Array<{open,high,low,close}>} prev  candles ANTERIORES (ascendentes), pode ser vazio
 * @returns {string|null} nome do padrão, ou null se o candle segurou a alta
 */
function bearishClosePattern(candle, prev = []) {
  const p = prev[prev.length - 1];
  return upperWickRejection(candle)
    ?? (hangingMan(candle, prev) ? 'hanging man' : null)
    ?? (bearishEngulfing(candle, p) ? 'bearish engulfing' : null)
    ?? (tweezerTop(candle, p) ? 'tweezer top' : null);
}

/** Candle FECHADO que abriu em `openTime` + `prev` (até 4 anteriores), ou null se não está entre
 *  os últimos candles (bot ficou fora tempo demais) ou ainda não fechou. */
async function fetchClosedCandle(exchange, symbol, interval, openTime, nowMs = Date.now()) {
  const ivMs = intervalMs(interval);
  if (openTime + ivMs > nowMs) return null;
  const raw = exchange === 'gate'
    ? await fetchGateKlines(toGateSymbol(symbol), interval, ivMs, 10)
    : await fetchKlines(symbol, interval, 10);
  const candles = raw.map((k) => ({
    openTime: Number(k.openTime), open: Number(k.open), high: Number(k.high), low: Number(k.low), close: Number(k.close),
  }));
  const idx = candles.findIndex((k) => k.openTime === openTime);
  if (idx < 0) return null;
  return { ...candles[idx], prev: candles.slice(Math.max(0, idx - 4), idx) };
}

module.exports = {
  buildCloseCondition, fetchClosedCandle, upperWickRejection, bearishClosePattern, intervalMs, BINANCE_INTERVALS, GATE_INTERVALS,
};
