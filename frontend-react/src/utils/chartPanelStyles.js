/**
 * Primitivos visuais compartilhados do painel de indicadores do gráfico (dropdown no topo do
 * chart). Extraídos de CandlestickChart.jsx pra o novo GroupBox.jsx (caixas de manipulador no
 * padrão Bollinger/EMA) poder reusar exatamente o mesmo visual sem duplicar nem criar ciclo de
 * import. CandlestickChart.jsx passa a importar daqui — nada de comportamento muda.
 *
 * `PanelTip` (usa JSX) fica em ../components/PanelTip.jsx — aqui só puro.
 */

export const PANEL_GAP = 2;
export const PANEL_TILE_PAD = 2;

/** Legend/título (ex.: "BOLLINGER BANDS", "S/R") no topo de cada bloco de manipulador. Ocupa 1
 *  linha inteira do grid do próprio bloco — reservada no total de linhas (ver groupBoxRowSpan /
 *  bbRowSpan), não descontada à parte. */
export const SECTION_TITLE_ROWS = 1;

export function scaleFontSize(dims, ratio = 0.32, min = 10, max = 18) {
  if (!dims) return min;
  return Math.max(min, Math.min(max, Math.round(Math.min(dims.w, dims.h) * ratio)));
}

export const panelBtn = (active, color, darkText = false, dims = null) => ({
  fontSize: scaleFontSize(dims),
  padding: 0,
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'monospace',
  background: active ? color : 'rgba(0,0,0,0.45)',
  color: active ? (darkText ? '#000' : '#fff') : color,
  border: `1px solid ${color}`,
  opacity: active ? 1 : 0.7,
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
  lineHeight: 1,
  boxSizing: 'border-box',
  textAlign: 'center',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const panelSelect = (color, dims = null) => ({
  width: '100%',
  height: '100%',
  minHeight: 0,
  fontSize: scaleFontSize(dims, 0.26, 9, 14),
  padding: 0,
  borderRadius: 3,
  fontFamily: 'monospace',
  boxSizing: 'border-box',
  textAlign: 'center',
  cursor: 'pointer',
  background: '#111',
  color,
  border: `1px solid ${color}66`,
});

export function scaleSectionTitle(dims) {
  return {
    fontSize: scaleFontSize(dims, 0.24, 8, 12),
    letterSpacing: 0.4,
    color: '#64748b',
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: 1.1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
  };
}
