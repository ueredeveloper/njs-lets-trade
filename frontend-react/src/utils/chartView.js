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

/** dataZoom horizontal (tempo) inside — arraste move, scroll amplia. */
export function buildInsideDataZoom(xAxisIndex = null, yAxisIndex = 0) {
  const x = xAxisIndex != null
    ? { type: 'inside', xAxisIndex: Array.isArray(xAxisIndex) ? xAxisIndex : [xAxisIndex], filterMode: 'filter' }
    : { type: 'inside', filterMode: 'filter' };
  const zooms = [x];
  if (yAxisIndex != null) zooms.push(buildVerticalDataZoom(yAxisIndex));
  return zooms;
}

/** dataZoom ECharts com janela fixa (persiste entre notMerge) + zoom vertical opcional */
export function buildFixedDataZoom(startPct, endPct, xAxisIndex = null, yAxisIndex = 0) {
  const base = { type: 'inside', start: startPct, end: endPct, filterMode: 'filter' };
  const x = xAxisIndex != null
    ? { ...base, xAxisIndex: Array.isArray(xAxisIndex) ? xAxisIndex : [xAxisIndex] }
    : base;
  const zooms = [x];
  if (yAxisIndex != null) zooms.push(buildVerticalDataZoom(yAxisIndex));
  return zooms;
}
