import { buildEmaCrossMergedSeries } from './emaCrossSeries';

/**
 * "Bars Since MA Cross" — botão "BARS" no painel de indicadores. Mesma ideia do indicador
 * homônimo (TradeStation/TradingView): conta quantos candles se passaram desde o último
 * cruzamento EMA9×EMA21. Positivo enquanto EMA9 > EMA21 (cresce a cada candle que a alta
 * persiste), negativo enquanto EMA9 < EMA21 — reinicia em ±1 a cada cruzamento novo. Cruzamentos
 * de médias tendem a reverter depois de um certo tempo; o valor ajuda a comparar a perna atual
 * com a duração típica.
 *
 * @returns {Array<{time:number, value:number}>} value > 0 = candles desde que cruzou pra cima;
 *          value < 0 = candles desde que cruzou pra baixo (módulo = quantidade de candles).
 */
export function computeBarsSinceMaCross(candlesticks, ma9, ma21) {
  const merged = buildEmaCrossMergedSeries(candlesticks, ma9, ma21);
  const out = [];
  let state = null;
  let count = 0;
  for (const m of merged) {
    if (m.fast === m.slow) continue; // empate exato: não avança nem inverte
    const s = m.fast > m.slow ? 'above' : 'below';
    if (s === state) count++;
    else { state = s; count = 1; }
    out.push({ time: m.time, value: state === 'above' ? count : -count });
  }
  return out;
}
