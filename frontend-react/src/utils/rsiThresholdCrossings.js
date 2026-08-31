/**
 * Candles em que o RSI(14) cruzou PRA CIMA de `threshold` — mesmo gatilho de entrada do bot
 * RSI Momentum (`rsi[i-1] < threshold && rsi[i] >= threshold`, ver evaluateEntrySignal em
 * backend/bot/rsi-momentum/strategyEngine.js). O array `rsiArray` vem alinhado ao FIM de
 * `candlesticks` (offset = candlesticks.length - rsiArray.length), mesma convenção do resto do
 * gráfico (alignSeries). Devolve os `openTime` (ms) desses candles.
 */
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
