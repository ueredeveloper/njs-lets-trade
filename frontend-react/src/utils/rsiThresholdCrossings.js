/**
 * Candles em que o RSI(14) cruzou PRA CIMA de `threshold` — mesmo gatilho de entrada do bot
 * RSI Momentum (`rsi[i-1] < threshold && rsi[i] >= threshold`, ver evaluateEntrySignal em
 * backend/bot/rsi-momentum/strategyEngine.js). O array `rsiArray` vem alinhado ao FIM de
 * `candlesticks` (offset = candlesticks.length - rsiArray.length), mesma convenção do resto do
 * gráfico (alignSeries). Devolve os `openTime` (ms) desses candles.
 */
/**
 * RSI de Wilder sobre um array de closes (números). Mesma fórmula do pacote `technicalindicators`
 * usado no backend (média inicial simples nos primeiros `period`, depois suavização de Wilder).
 * Devolve um array alinhado ao FIM de `closes` — o 1º valor corresponde a `closes[period]`.
 */
export function computeRsiWilder(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  const rsiAt = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  const out = [rsiAt()];
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out.push(rsiAt());
  }
  return out;
}

/**
 * Cruzamentos PRA CIMA do `threshold` calculados direto de candles brutos (`{ close, openTime }`)
 * de um intervalo qualquer — usado pela linha vertical roxa do "Limiar RSI" quando o intervalo do
 * RSI é diferente do intervalo do gráfico. Devolve os `openTime` (ms) desses candles.
 */
export function computeRsiUpCrossingsFromCandles(candles, threshold, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period + 1) return [];
  const closes = candles.map((c) => Number(c.close ?? c[4]));
  const rsi = computeRsiWilder(closes, period);
  return computeRsiUpCrossings(rsi, candles, threshold);
}

export function computeRsiUpCrossings(rsiArray, candlesticks, threshold) {
  if (!Array.isArray(rsiArray) || rsiArray.length < 2 || !candlesticks?.length) return [];
  const t = Number(threshold);
  if (!Number.isFinite(t) || t <= 0) return [];
  const offset = candlesticks.length - rsiArray.length;
  if (offset < 0) return [];
  const out = [];
  for (let i = 1; i < rsiArray.length; i++) {
    const prev = Number(rsiArray[i - 1]);
    const cur = Number(rsiArray[i]);
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    if (prev < t && cur >= t) {
      const c = candlesticks[offset + i];
      if (c) out.push(Number(c.openTime));
    }
  }
  return out;
}
