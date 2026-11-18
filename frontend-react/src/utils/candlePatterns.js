// Padrões de candle no FECHAMENTO — espelho ESM de backend/bot/shared/candleCloseCondition.js
// (bearishClosePattern / bullishClosePattern). Mude os dois juntos: a caixa "Price action" do
// gráfico usa estes nomes/regras pra mostrar a MESMA decisão que o bot toma no fechamento do candle
// (Explosão de Alta: corpo >= 5% OU padrão de alta, nunca padrão de baixa).

const isGreen = (c) => c.close > c.open;
const isRed = (c) => c.close < c.open;
const bodyOf = (c) => Math.abs(c.close - c.open);
const rangeOf = (c) => c.high - c.low;
const TWEEZER_TOL = 0.002;

/** Alta antes do candle: o último anterior fechou acima do fechamento de 3 candles antes dele. */
function priorUptrend(prev) {
  if (prev.length < 4) return false;
  return prev[prev.length - 1].close > prev[prev.length - 4].close;
}

function upperWickRejection(c) {
  const range = rangeOf(c);
  if (!(range > 0)) return null;
  const bodyTop = Math.max(c.open, c.close);
  const body = bodyOf(c);
  const upper = c.high - bodyTop;
  if (!(upper >= 2 * body && (bodyTop - c.low) <= 0.4 * range)) return null;
  if (body <= 0.1 * range) return 'gravestone doji';
  return c.close < c.open ? 'shooting star' : 'inverted hammer';
}

/** Corpo em cima, pavio inferior longo (hammer / hanging man, a diferença é a alta antes). */
function lowerWickShape(c) {
  const range = rangeOf(c);
  if (!(range > 0)) return false;
  const body = bodyOf(c);
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);
  return lower >= 2 * body && lower >= 0.6 * range && upper <= 0.1 * range;
}

/** @returns {string|null} padrão de BAIXA do candle fechado (nome em inglês, igual ao bot) */
export function bearishClosePattern(c, prev = []) {
  const p = prev[prev.length - 1];
  const wick = upperWickRejection(c);
  if (wick) return wick;
  if (lowerWickShape(c) && priorUptrend(prev)) return 'hanging man';
  if (p && isGreen(p) && isRed(c) && c.open >= p.close && c.close <= p.open) return 'bearish engulfing';
  if (p && isGreen(p) && isRed(c) && Math.abs(c.high - p.high) <= TWEEZER_TOL * Math.max(c.high, p.high)) return 'tweezer top';
  return null;
}

/** @returns {string|null} padrão de ALTA do candle fechado (nome em inglês, igual ao bot) */
export function bullishClosePattern(c, prev = []) {
  const p = prev[prev.length - 1];
  const p2 = prev[prev.length - 2];
  if (lowerWickShape(c) && !priorUptrend(prev)) return 'hammer';
  if (p2 && p && isRed(p2) && isGreen(c) && rangeOf(p2) > 0 && bodyOf(p2) >= 0.5 * rangeOf(p2)
    && bodyOf(p) <= 0.3 * bodyOf(p2) && c.close > (p2.open + p2.close) / 2) return 'morning star';
  if (p2 && p && [p2, p, c].every((k) => isGreen(k) && rangeOf(k) > 0 && (k.close - k.low) / rangeOf(k) >= 0.7)
    && p.close > p2.close && c.close > p.close
    && p.open >= p2.open && p.open <= p2.close && c.open >= p.open && c.open <= p.close) return 'three white soldiers';
  if (p && isRed(p) && isGreen(c) && c.open <= p.close && c.close >= p.open) return 'bullish engulfing';
  if (p && isRed(p) && isGreen(c) && c.open <= p.close && c.close > (p.open + p.close) / 2 && c.close < p.open) return 'piercing line';
  if (p && isRed(p) && isGreen(c) && Math.abs(c.low - p.low) <= TWEEZER_TOL * Math.max(c.low, p.low)) return 'tweezer bottom';
  if (isGreen(c) && rangeOf(c) > 0 && bodyOf(c) >= 0.9 * rangeOf(c)) return 'bullish marubozu';
  return null;
}

export const CANDLE_PATTERN_PT = {
  hammer: 'Martelo',
  'bullish engulfing': 'Engolfo de alta',
  'piercing line': 'Linha de perfuração',
  'morning star': 'Estrela da manhã',
  'tweezer bottom': 'Fundo pinça',
  'bullish marubozu': 'Marubozu de alta',
  'three white soldiers': 'Três soldados',
  'shooting star': 'Estrela cadente',
  'inverted hammer': 'Martelo invertido',
  'gravestone doji': 'Doji lápide',
  'hanging man': 'Enforcado',
  'bearish engulfing': 'Engolfo de baixa',
  'tweezer top': 'Topo pinça',
};

export const patternPt = (name) => (name ? (CANDLE_PATTERN_PT[name] ?? name) : null);

/** Explicação curta do padrão de ALTA (rótulo amarelo abaixo da faixa de entrada no gráfico). */
export const BULLISH_PATTERN_WHY = {
  hammer: 'pavio inferior longo: venderam, mas os compradores devolveram a queda',
  'bullish engulfing': 'o corpo verde cobre o vermelho anterior inteiro',
  'piercing line': 'o verde recupera mais da metade do vermelho anterior',
  'morning star': 'vermelho forte, indecisão e um verde acima do meio do 1º',
  'tweezer bottom': 'duas mínimas iguais: o suporte segurou duas vezes',
  'bullish marubozu': 'corpo verde quase sem pavio: comprou do início ao fim',
  'three white soldiers': 'três verdes em escada, cada um fechando mais alto',
};
