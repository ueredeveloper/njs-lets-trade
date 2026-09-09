/**
 * Ranking de níveis de S/R (Suporte/Resistência) no cliente. Fonte única — CandlestickChartLW.jsx
 * e o motor ECharts (buildSrMarkLines) importam daqui em vez de cada um ter sua cópia.
 *
 * `detectSupportResistance` (srDetectors.js) devolve os níveis já ordenados por preço desc, cada
 * um `{ price, touches, type:'support'|'resistance', ... }`. Aqui damos "posto":
 *   - resistência: menor preço = R1 (mais perto do preço atual, por cima)
 *   - suporte:     maior preço = S1 (mais perto do preço atual, por baixo)
 */

/** Anexa `rank` (1..) e `label` ('S1'/'R2'…) aos níveis de UM tipo, ordenados por proximidade. */
export function rankSrLevels(levels, type) {
  return (levels ?? [])
    .filter((l) => l.type === type && Number.isFinite(Number(l.price)))
    .sort((a, b) => (type === 'resistance' ? a.price - b.price : b.price - a.price))
    .map((l, i) => ({ ...l, rank: i + 1, label: `${type === 'resistance' ? 'R' : 'S'}${i + 1}` }));
}

/**
 * "Calcular linhas" do manipulador S/R: mantém só os `nSup` suportes e `nRes` resistências mais
 * próximos do preço, devolvendo a lista achatada (sem `rank`/`label` — quem desenha rerankeia com
 * rankSrLevels). `nSup`/`nRes` null/undefined = sem limite.
 */
export function sliceRankedSrLevels(levels, nSup, nRes) {
  const keep = [];
  for (const [type, n] of [['support', nSup], ['resistance', nRes]]) {
    const ranked = rankSrLevels(levels, type);
    const limit = n == null ? ranked.length : Math.max(0, Number(n));
    for (const l of ranked.slice(0, limit)) {
      // devolve o nível ORIGINAL (sem rank/label injetados) — o consumidor rerankeia
      const { rank, label, ...orig } = l;
      void rank; void label;
      keep.push(orig);
    }
  }
  return keep;
}
