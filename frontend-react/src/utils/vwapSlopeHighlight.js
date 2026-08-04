/**
 * Destaque visual (rosa) dos trechos onde a própria VWAP está em queda acentuada —
 * Configurações → "Destaque de queda da VWAP" (uiPrefs.vwapSlopeHighlightDefault). Mesmo
 * cálculo do vwapSlopeFilter do bot vwap-bands (vwapSlopeAt em
 * backend/bot/vwap-bands/strategyEngine.js): compara o valor da VWAP em cada ponto com o de
 * `lookback` pontos atrás NA MESMA SÉRIE (unidade do vwapInterval escolhido no gráfico, ex.:
 * 4h) — só overlay, não bloqueia nenhuma compra/venda.
 */

/** Um flag booleano por ponto de `points` (mesma ordem) — true se a queda da VWAP entre esse
 *  ponto e o de `lookback` pontos atrás passar de `minSlopePct`. */
export function computeVwapSlopeFlags(points, lookback, minSlopePct) {
  if (!points?.length) return [];
  if (!lookback) return points.map(() => false);
  return points.map((p, i) => {
    const pastIdx = i - lookback;
    if (pastIdx < 0) return false;
    const past = Number(points[pastIdx].value);
    const current = Number(p.value);
    if (!(past > 0) || !Number.isFinite(current)) return false;
    return ((current - past) / past) * 100 < minSlopePct;
  });
}

/**
 * Agrupa `points` (já convertidos via `toPoint(rawPoint, value)`) em segmentos contíguos por
 * flag — usado pelo TradingView Lightweight Charts (CandlestickChartLW), que desenha cada
 * segmento como uma LineSeries própria sobre o eixo do tempo real (sem grid denso por
 * candle). O ponto de fronteira é duplicado no segmento seguinte pra a linha não abrir
 * buraco na transição de cor.
 */
export function splitPointsByFlag(points, flags, field, toPoint) {
  const segments = [];
  let cur = null;
  for (let i = 0; i < points.length; i++) {
    const raw = points[i][field];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    const declining = !!flags[i];
    const point = toPoint(points[i], raw);
    if (cur && cur.declining === declining) {
      cur.points.push(point);
    } else {
      if (cur) {
        cur.points.push(point);
        segments.push(cur);
      }
      cur = { declining, points: [point] };
    }
  }
  if (cur) segments.push(cur);
  return segments;
}
