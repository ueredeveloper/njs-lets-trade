/**
 * Ranking de níveis de S/R (Suporte/Resistência) no cliente. Fonte única — CandlestickChartLW.jsx
 * e o motor ECharts (buildSrMarkLines) importam daqui em vez de cada um ter sua cópia.
 *
 * `detectSupportResistance` (srDetectors.js) devolve os níveis já ordenados por preço desc, cada
 * um `{ price, touches, type:'support'|'resistance', ... }`. Aqui damos "posto":
 *   - resistência: menor preço = R1 (mais perto do preço atual, por cima)
 *   - suporte:     maior preço = S1 (mais perto do preço atual, por baixo)
 */

/**
 * Anexa `rank` (1..) e `label` ('S1'/'R2'…) aos níveis de UM tipo, ordenados por proximidade.
 * Se o nível JÁ traz um `rank` (ex.: veio de `sliceRankedSrLevels`, que rankeia sobre o conjunto
 * completo antes de fatiar), esse posto é preservado — senão "R3" viraria "R1" ao ser desenhado
 * sozinho.
 */
export function rankSrLevels(levels, type) {
  return (levels ?? [])
    .filter((l) => l.type === type && Number.isFinite(Number(l.price)))
    .sort((a, b) => (type === 'resistance' ? a.price - b.price : b.price - a.price))
    .map((l, i) => {
      const rank = Number.isFinite(Number(l.rank)) ? Number(l.rank) : i + 1;
      return { ...l, rank, label: l.label ?? `${type === 'resistance' ? 'R' : 'S'}${rank}` };
    });
}

/**
 * Um SELETOR de postos do manipulador S/R (campos `support`/`resistance`). Formatos aceitos:
 *   - `'all'` / `null` / `undefined` → todos os postos (S1, S2, … Sn — sem teto)
 *   - `number[]`  → só esses postos exatos, ex.: `[1, 3]` = S1 e S3 (não S2)
 *   - `number`    → LEGADO cumulativo "top N" (`3` = S1–S3)
 * `srRankAllowed(sel, rank)` diz se o posto `rank` (1..) passa no seletor.
 */
export function srRankAllowed(sel, rank) {
  if (sel == null || sel === 'all') return true;
  if (Array.isArray(sel)) return sel.includes(Number(rank));
  const n = Number(sel);
  return Number.isFinite(n) ? Number(rank) <= n : true;
}

/**
 * Normaliza um valor persistido de seletor de postos p/ `'all'` ou `number[]` limpo (inteiros ≥1,
 * únicos, ordenados). `fallback` quando o valor é ausente/inválido. Migra o legado `number` (top N)
 * pra `[1..n]`.
 */
export function normalizeSrRankSel(raw, fallback = 'all') {
  if (raw === 'all') return 'all';
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20))]
      .sort((a, b) => a - b);
  }
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1) return Array.from({ length: Math.min(n, 20) }, (_, i) => i + 1);
  return fallback;
}

/**
 * Manipulador S/R — um seletor de postos por tipo: rankeia sobre o conjunto COMPLETO, mantém só os
 * postos que passam em `selSup` (suportes) / `selRes` (resistências) e devolve os níveis já com
 * `rank`/`label` do conjunto completo preservados (rankSrLevels respeita esse posto), pra "R3"
 * continuar "R3" mesmo desenhado sozinho. Seletores: ver `srRankAllowed`.
 */
export function sliceRankedSrLevels(levels, selSup, selRes) {
  const keep = [];
  for (const [type, sel] of [['support', selSup], ['resistance', selRes]]) {
    for (const l of rankSrLevels(levels, type)) {
      if (srRankAllowed(sel, l.rank)) keep.push(l);
    }
  }
  return keep;
}
