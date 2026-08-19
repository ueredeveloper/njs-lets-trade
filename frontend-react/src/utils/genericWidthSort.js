/**
 * Ordenação por largura das Bandas de Bollinger pra filtros "simples" (RSI, MA, Ichimoku…)
 * que ainda não têm coluna de largura própria — mesmo padrão de seletor cíclico usado nos
 * favoritos (ver bollingerFavoritesSort.js), só que com 'off' como opção inicial pra não
 * disparar um scan de largura toda vez que o usuário troca de aba de filtro.
 */
export const GENERIC_WIDTH_SORT_OPTIONS = [
  { id: 'off',  labelKey: 'genwidth.sort.off',  shortKey: 'genwidth.sort.short.off' },
  { id: 'far',  labelKey: 'genwidth.sort.far',  shortKey: 'genwidth.sort.short.far' },
  { id: 'near', labelKey: 'genwidth.sort.near', shortKey: 'genwidth.sort.short.near' },
];

export function getGenericWidthSortOption(sortBy) {
  return GENERIC_WIDTH_SORT_OPTIONS.find(o => o.id === sortBy) ?? GENERIC_WIDTH_SORT_OPTIONS[0];
}

/** direction: -1 = anterior, +1 = próximo */
export function cycleGenericWidthSort(current, direction = 1) {
  const idx = GENERIC_WIDTH_SORT_OPTIONS.findIndex(o => o.id === current);
  const i = idx < 0 ? 0 : idx;
  const n = GENERIC_WIDTH_SORT_OPTIONS.length;
  return GENERIC_WIDTH_SORT_OPTIONS[(i + direction + n * 10) % n].id;
}
