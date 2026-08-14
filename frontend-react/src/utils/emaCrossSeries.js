/**
 * Base compartilhada por todos os indicadores derivados do cruzamento EMA9×EMA21 no gráfico
 * (nuvem PERM / inclinação EMA9 em emaCrossPersistenceCloud.js, "Bars Since MA Cross" em
 * barsSinceMaCross.js): alinha as duas séries de EMA aos candles pelo openTime e devolve só os
 * pontos em que as DUAS já têm valor (a EMA de período maior nasce mais tarde).
 */

/** Mesma convenção de alinhamento usada em CandlestickChartLW.jsx (alignIndicatorToCandles):
 *  arr[i] corresponde ao candle de índice (candlesticks.length - arr.length + i). */
export function alignEmaToCandles(candlesticks, arr) {
  if (!arr?.length || !candlesticks?.length) return [];
  const offset = candlesticks.length - arr.length;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const c = candlesticks[offset + i];
    const v = Number(arr[i]);
    if (!c || !Number.isFinite(v)) continue;
    out.push({ time: Math.floor(Number(c.openTime) / 1000), value: v });
  }
  return out;
}

/** [{ time, fast, slow }] — só nos candles em que as duas EMAs têm valor. */
export function buildEmaCrossMergedSeries(candlesticks, fastArr, slowArr) {
  const fast = alignEmaToCandles(candlesticks, fastArr);
  const slowMap = new Map(alignEmaToCandles(candlesticks, slowArr).map((p) => [p.time, p.value]));
  const merged = [];
  for (const p of fast) {
    const slowValue = slowMap.get(p.time);
    if (slowValue == null) continue;
    merged.push({ time: p.time, fast: p.value, slow: slowValue });
  }
  return merged;
}
