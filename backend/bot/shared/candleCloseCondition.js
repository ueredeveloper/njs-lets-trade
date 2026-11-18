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

// ─── Padrões de ALTA (Explosão automática, v1.187.0) ────────────────────────────────────────────
// Candle fechado num destes desenhos autoriza a entrada mesmo com corpo abaixo do mínimo do scanner
// (minBodyPct). Rodam DEPOIS de bearishClosePattern — um candle de baixa nunca chega aqui (ex.: o
// martelo depois de alta já foi barrado como hanging man). Inverted hammer fica de fora (é barrado).

const bodyOf = (c) => Math.abs(c.close - c.open);
const rangeOf = (c) => c.high - c.low;

/** Martelo: o mesmo desenho do hanging man (corpo em cima, pavio inferior longo), sem alta antes. */
function hammer(c, prev) {
  const range = rangeOf(c);
  if (!(range > 0) || priorUptrend(prev)) return false;
  const body = bodyOf(c);
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);
  return lower >= 2 * body && lower >= 0.6 * range && upper <= 0.1 * range;
}

/** Bullish engulfing: anterior vermelho, este verde e o corpo deste cobre o corpo inteiro do anterior. */
function bullishEngulfing(c, p) {
  return !!p && isRed(p) && isGreen(c) && c.open <= p.close && c.close >= p.open;
}

/** Piercing line: anterior vermelho, este verde abre no/abaixo do fechamento dele e fecha acima do
 *  meio do corpo dele, sem passar da abertura (aí já seria engolfo). */
function piercingLine(c, p) {
  if (!p || !isRed(p) || !isGreen(c)) return false;
  const mid = (p.open + p.close) / 2;
  return c.open <= p.close && c.close > mid && c.close < p.open;
}

/** Morning star: vermelho forte (corpo >= 50% do range), candle pequeno (corpo <= 30% do 1º) e um
 *  verde fechando acima do meio do corpo do 1º. */
function morningStar(c, prev) {
  const p2 = prev[prev.length - 2];
  const p1 = prev[prev.length - 1];
  if (!p2 || !p1 || !isRed(p2) || !isGreen(c)) return false;
  const b2 = bodyOf(p2);
  if (!(rangeOf(p2) > 0) || b2 < 0.5 * rangeOf(p2)) return false;
  return bodyOf(p1) <= 0.3 * b2 && c.close > (p2.open + p2.close) / 2;
}

/** Tweezer bottom: anterior vermelho, este verde, mínimas "iguais" (mesma tolerância do tweezer top). */
function tweezerBottom(c, p) {
  return !!p && isRed(p) && isGreen(c) && Math.abs(c.low - p.low) <= TWEEZER_HIGH_TOL * Math.max(c.low, p.low);
}

/** Marubozu de alta: verde com corpo >= 90% do range (quase sem pavio). */
function bullishMarubozu(c) {
  const range = rangeOf(c);
  return range > 0 && isGreen(c) && bodyOf(c) >= 0.9 * range;
}

/** Three white soldiers: 3 verdes, cada um fecha acima do anterior, abre dentro do corpo do anterior
 *  e fecha nos 30% de cima do próprio range. */
function threeWhiteSoldiers(c, prev) {
  const p2 = prev[prev.length - 2];
  const p1 = prev[prev.length - 1];
  if (!p2 || !p1) return false;
  const trio = [p2, p1, c];
  if (!trio.every((k) => isGreen(k) && rangeOf(k) > 0 && (k.close - k.low) / rangeOf(k) >= 0.7)) return false;
  return p1.close > p2.close && c.close > p1.close
    && p1.open >= p2.open && p1.open <= p2.close
    && c.open >= p1.open && c.open <= p1.close;
}

/**
 * Padrão de ALTA no candle que acabou de fechar.
 * @param {{open,high,low,close}} candle
 * @param {Array<{open,high,low,close}>} prev  candles ANTERIORES (ascendentes), pode ser vazio
 * @returns {string|null} nome do padrão, ou null
 */
function bullishClosePattern(candle, prev = []) {
  const p = prev[prev.length - 1];
  if (hammer(candle, prev)) return 'hammer';
  if (morningStar(candle, prev)) return 'morning star';
  if (threeWhiteSoldiers(candle, prev)) return 'three white soldiers';
  if (bullishEngulfing(candle, p)) return 'bullish engulfing';
  if (piercingLine(candle, p)) return 'piercing line';
  if (tweezerBottom(candle, p)) return 'tweezer bottom';
  if (bullishMarubozu(candle)) return 'bullish marubozu';
  return null;
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
  buildCloseCondition, fetchClosedCandle, upperWickRejection, bearishClosePattern, bullishClosePattern, intervalMs, BINANCE_INTERVALS, GATE_INTERVALS,
};
