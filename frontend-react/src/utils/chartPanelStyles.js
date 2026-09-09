/**
 * Primitivos visuais compartilhados do painel de indicadores do gráfico (dropdown no topo do
 * chart) — usados por CandlestickChart.jsx e GroupBox.jsx. Puro (sem JSX); `PanelTip` fica em
 * ../components/PanelTip.jsx.
 *
 * Padrão CARD (mock "Painel Indicadores Nano"): tamanho FIXO compacto, todo o chrome sai de
 * var(--color-pnl-*) (ver src/utils/palettes.js). O antigo padrão grid dirigido por `dims`
 * (panelBtn/panelSelect/scaleSectionTitle) foi removido na v1.136.x.
 */

export const PANEL_GAP = 2;

/* As funções que aceitam `accent` usam a cor de IDENTIDADE da série (chip S/R, período EMA,
 * grupo BB) só na borda/preenchimento do controle quando ativo; o resto é sempre da paleta. */

export const CARD_CONTROL_H = 19;
const MONO = 'monospace';

export function panelCard() {
  return {
    border: '1px solid var(--color-pnl-border)',
    background: 'var(--color-pnl-card)',
    borderRadius: 6,
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    boxSizing: 'border-box',
    width: '100%',
  };
}

export function cardHeader() {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    minHeight: CARD_CONTROL_H,
    borderBottom: '1px solid var(--color-pnl-border)',
    paddingBottom: 3,
  };
}

export function cardTitle() {
  return {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: 'var(--color-pnl-accent)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  };
}

/** Rótulo pequeno em caixa alta (nota de seção / contador n/max). */
export function cardSectionLabel() {
  return {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'var(--color-pnl-muted)',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  };
}

export function cardOnBtn(on) {
  return {
    height: CARD_CONTROL_H,
    padding: '0 7px',
    borderRadius: 3,
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    boxSizing: 'border-box',
    border: '1px solid var(--color-pnl-on)',
    color: on ? '#04120a' : 'var(--color-pnl-on)',
    background: on ? 'var(--color-pnl-on)' : 'transparent',
    transition: 'all 0.15s',
  };
}

export function cardCloseBtn() {
  return {
    width: CARD_CONTROL_H,
    height: CARD_CONTROL_H,
    padding: 0,
    borderRadius: 3,
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 1,
    cursor: 'pointer',
    boxSizing: 'border-box',
    border: '1px solid var(--color-pnl-border-2)',
    color: 'var(--color-pnl-danger)',
    background: 'transparent',
    transition: 'all 0.15s',
  };
}

export function cardAddBtn() {
  return {
    width: '100%',
    height: CARD_CONTROL_H,
    padding: 0,
    borderRadius: 3,
    fontFamily: MONO,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    cursor: 'pointer',
    boxSizing: 'border-box',
    border: '1px dashed var(--color-pnl-border-2)',
    color: 'var(--color-pnl-muted)',
    background: 'transparent',
    transition: 'all 0.15s',
  };
}

export function toggleGroup(wrap = false) {
  return {
    display: 'flex',
    gap: 2,
    flexWrap: wrap ? 'wrap' : 'nowrap',
    alignItems: 'stretch',
    width: '100%',
  };
}

/** Botão de toggle. `accent` = cor de identidade opcional (borda + fill quando ativo). */
export function toggleBtn(active, accent) {
  const line = accent || 'var(--color-pnl-border-2)';
  return {
    flex: '1 1 auto',
    height: CARD_CONTROL_H,
    minWidth: 22,
    padding: '0 4px',
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
    borderRadius: 3,
    cursor: 'pointer',
    boxSizing: 'border-box',
    border: `1px solid ${active ? line : 'var(--color-pnl-border-2)'}`,
    color: active ? (accent ? '#04120a' : 'var(--color-pnl-text)') : 'var(--color-pnl-muted)',
    background: active ? (accent || 'var(--color-pnl-toggle)') : 'transparent',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  };
}

/** Select do card. `accent` = cor de identidade opcional (borda tingida). */
export function cardSelect(accent) {
  return {
    width: '100%',
    height: CARD_CONTROL_H,
    minWidth: 0,
    padding: '0 2px',
    fontFamily: MONO,
    fontSize: 10,
    borderRadius: 3,
    cursor: 'pointer',
    boxSizing: 'border-box',
    background: 'var(--color-pnl-input)',
    color: 'var(--color-pnl-text)',
    border: `1px solid ${accent ? `${accent}66` : 'var(--color-pnl-border-2)'}`,
  };
}
