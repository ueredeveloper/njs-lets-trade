import { SECTION_TITLE_ROWS } from '../chartPanelStyles';

/**
 * Linhas do grid interno de uma caixa de manipulador = título + N grupos × linhas-por-grupo +
 * (linha do "+ nome" se ainda couber grupo). Mesma fórmula de bbRowSpan / quickEmaRowSpan.
 * Fica num .js puro porque computeMasonryLayout (CandlestickChart.jsx, fora de contexto JSX)
 * precisa dela.
 */
export function groupBoxRowSpan(descriptor, groups) {
  const perGroup = descriptor.rows.length;
  const n = (groups ?? []).length;
  const addRow = n < (descriptor.max ?? 4) ? 1 : 0;
  return Math.max(1, SECTION_TITLE_ROWS + n * perGroup + addRow);
}
