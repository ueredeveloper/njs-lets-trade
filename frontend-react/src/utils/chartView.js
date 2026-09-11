/** Fonte que controla o gráfico — evita efeitos concorrentes resetarem zoom/markers */
export const CHART_VIEW = {
  DEFAULT:      'default',
  TABLE:        'table',
  STATISTICS:   'statistics',
  MULTITRADE:   'multitrade',
  FIVE_M_TRADE: 'five_m_trade',
  TRADES:       'trades',
};

/** Zoom/markers controlados por painéis de trade (Multi-Trade, 5m Trade) */
export function isTradePanelChartView(source) {
  return source === CHART_VIEW.MULTITRADE || source === CHART_VIEW.FIVE_M_TRADE;
}

export const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000,
};

/** Quantidade de candles desde fetchFromMs até agora (+ buffer) */
export function computeCandleLimitFromTime(fetchFromMs, interval, { buffer = 40, max = 3000, min = 100 } = {}) {
  const ms = INTERVAL_MS[interval] ?? 3_600_000;
  return Math.min(max, Math.max(min, Math.ceil((Date.now() - fetchFromMs) / ms) + buffer));
}

/** Velas extras antes da entrada / depois da saída no zoom MT e Estatísticas */
export const CHART_ZOOM_PAD = 10;

/**
 * Calcula índices e percentuais de dataZoom para [startDate, endDate] ± padding velas.
 * @returns {{ startIdx, endIdx, startPct, endPct } | null}
 */
export function computeZoomWindow(candles, { startDate, endDate }, padding = CHART_ZOOM_PAD) {
  if (!candles?.length || !startDate || !endDate) return null;
  const startMs = new Date(startDate).getTime();
  const endMs   = new Date(endDate).getTime();
  const startIdx = candles.findIndex(c => Number(c.openTime) >= startMs);
  let endIdx = candles.findIndex(c => Number(c.openTime) >= endMs);
  if (startIdx === -1) return null;
  if (endIdx === -1) endIdx = candles.length - 1;
  const s = Math.max(0, startIdx - padding);
  const e = Math.min(candles.length - 1, endIdx + padding);
  const len = candles.length;
  return {
    startIdx: s,
    endIdx: e,
    startPct: (s / len) * 100,
    endPct:   (e / len) * 100,
  };
}

/**
 * dataZoom vertical (eixo de preço): zoom com Shift+scroll, arraste move na vertical.
 * filterMode 'none' para não descartar candles ao ampliar/reduzir o preço.
 */
export function buildVerticalDataZoom(yAxisIndex = 0) {
  return {
    type: 'inside',
    yAxisIndex: Array.isArray(yAxisIndex) ? yAxisIndex : [yAxisIndex],
    filterMode: 'none',
    zoomOnMouseWheel: 'shift',
    moveOnMouseMove: true,
    moveOnMouseWheel: false,
  };
}

/**
 * zoomOnMouseWheel desligado no eixo horizontal: o fator nativo do ECharts pro scroll
 * (~1.1–1.4x por "tick", hardcoded em RoamController) pula de zoom rápido demais.
 * O zoom por scroll no eixo do tempo é feito manualmente (ver computeManualWheelZoom /
 * handleChartWheel em CandlestickChart.jsx) com passo fixo e bem menor. Arrastar
 * (moveOnMouseMove) continua nativo.
 */
export function buildInsideDataZoom(xAxisIndex = null, yAxisIndex = 0) {
  const x = xAxisIndex != null
    ? { type: 'inside', xAxisIndex: Array.isArray(xAxisIndex) ? xAxisIndex : [xAxisIndex], filterMode: 'filter', zoomOnMouseWheel: false }
    : { type: 'inside', filterMode: 'filter', zoomOnMouseWheel: false };
  const zooms = [x];
  if (yAxisIndex != null) zooms.push(buildVerticalDataZoom(yAxisIndex));
  return zooms;
}

/** dataZoom ECharts com janela fixa (persiste entre notMerge) + zoom vertical opcional */
export function buildFixedDataZoom(startPct, endPct, xAxisIndex = null, yAxisIndex = 0) {
  const base = { type: 'inside', start: startPct, end: endPct, filterMode: 'filter', zoomOnMouseWheel: false };
  const x = xAxisIndex != null
    ? { ...base, xAxisIndex: Array.isArray(xAxisIndex) ? xAxisIndex : [xAxisIndex] }
    : base;
  const zooms = [x];
  if (yAxisIndex != null) zooms.push(buildVerticalDataZoom(yAxisIndex));
  return zooms;
}

/** Passo de zoom manual por "tick" de scroll — bem menor que o nativo do ECharts,
 *  pra crescer aos poucos (ex.: 1x → 1.05x → 1.1x...) em vez de pular direto pra 5x. */
export const MANUAL_ZOOM_STEP_RATIO = 0.05;
/** Não deixa a janela visível encolher pra menos que 1% do dataset (evita zoom infinito). */
export const MIN_ZOOM_SPAN_PCT = 1;

/**
 * Calcula o novo [start, end] (%) do dataZoom horizontal, ancorado na posição do
 * cursor (anchorPct, também em %), reduzindo/expandindo a janela visível em
 * `stepRatio` por chamada. Usado pelo handler de wheel manual em CandlestickChart.
 */
export function computeManualWheelZoom(start, end, anchorPct, zoomIn, stepRatio = MANUAL_ZOOM_STEP_RATIO) {
  const span = end - start;
  if (!(span > 0)) return { start, end };
  const factor = zoomIn ? (1 - stepRatio) : (1 + stepRatio);
  const newSpan = Math.max(MIN_ZOOM_SPAN_PCT, Math.min(100, span * factor));
  const anchorRatio = (anchorPct - start) / span;
  let newStart = anchorPct - anchorRatio * newSpan;
  let newEnd = newStart + newSpan;
  if (newStart < 0) { newEnd -= newStart; newStart = 0; }
  if (newEnd > 100) { newStart -= (newEnd - 100); newEnd = 100; }
  return { start: Math.max(0, newStart), end: Math.min(100, newEnd) };
}
