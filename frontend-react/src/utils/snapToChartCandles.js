/**
 * Encaixa uma série de pontos com timestamp PRÓPRIO — de um intervalo "estrangeiro" (ex.: EMA9/21
 * ou TD Sequential calculados em 1h sobre um gráfico exibido em 15m) — nos candles REALMENTE
 * desenhados no gráfico: cada ponto passa a usar o horário do candle do gráfico mais recente que
 * seja <= o horário original. Sem isso, o Lightweight Charts espaça as colunas pela união de
 * todos os timestamps das séries (mesmo problema já resolvido pra VWAP/Bollinger via
 * alignFieldToCandles em CandlestickChartLW.jsx) — um timestamp estrangeiro mais fino que o
 * intervalo do gráfico empurraria os candles reais uns dos outros.
 */

/** [{ time, ... }] com `time` substituído pelo horário do candle do gráfico correspondente;
 *  pontos anteriores ao candle mais antigo carregado são descartados. Quando o intervalo
 *  estrangeiro é mais fino que o do gráfico, vários pontos podem cair no mesmo candle — colapsa
 *  consecutivos de mesmo horário (mantém o último), evitando um segmento de largura zero se
 *  auto-interceptando no desenho da nuvem/histograma. */
export function snapPointsToChartCandles(chartCandlesticks, points) {
  if (!points?.length || !chartCandlesticks?.length) return [];
  const chartTimes = chartCandlesticks.map((c) => Math.floor(Number(c.openTime) / 1000));
  const snapped = [];
  for (const p of points) {
    let lo = 0, hi = chartTimes.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chartTimes[mid] <= p.time) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best === -1) continue; // ponto mais antigo que o candle mais antigo carregado
    snapped.push({ ...p, time: chartTimes[best] });
  }
  const out = [];
  for (const p of snapped) {
    if (out.length && out[out.length - 1].time === p.time) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}
