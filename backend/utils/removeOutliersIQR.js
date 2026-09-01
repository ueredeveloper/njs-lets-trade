'use strict';

/** Percentil por interpolação linear (método usado por Excel/numpy `linear`). */
function quantile(sortedValues, q) {
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedValues[base + 1] !== undefined
    ? sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base])
    : sortedValues[base];
}

/** Remove outliers (altas/baixas exageradas — ex.: um crash/pump pontual de poucos minutos
 * alargando as bandas) pelo método de Tukey (cercas de 1.5×IQR) antes de tirar a média, evitando
 * que um evento breve infle o valor muito acima do que é "típico" na janela. Com menos de 4
 * amostras os quartis não são confiáveis, então não filtra nada. */
function removeOutliersIQR(values) {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const filtered = values.filter(v => v >= lowerFence && v <= upperFence);
  return filtered.length > 0 ? filtered : values;
}

/** Média de `values` descartando outliers (ver removeOutliersIQR). */
function averageWithoutOutliers(values) {
  const filtered = removeOutliersIQR(values);
  return filtered.reduce((s, v) => s + v, 0) / filtered.length;
}

/**
 * Média robusta da largura de banda (ver bollingerBandWidthSeries em indicatorGrowthEngines.js) —
 * descarta as ALTAS EXPRESSIVAS que inflam a média: um pump/crash pontual alarga as bandas por
 * ~`period` candles e não representa a "largura típica" da moeda. Camadas:
 *   1) cerca de Tukey (1.5×IQR) — tira extremos isolados;
 *   2) corta o decil superior (10% maiores valores restantes);
 *   3) descarta o que sobrar acima de 2.5× a mediana (regime largo vs. spike);
 *   4) média do que resta.
 * Com menos de 5 amostras devolve a média simples (quartis/decis não são confiáveis).
 * null se `values` vazio.
 */
function bandWidthRobustMean(values) {
  if (!values?.length) return null;
  if (values.length < 5) return values.reduce((s, v) => s + v, 0) / values.length;

  const sorted = [...removeOutliersIQR(values)].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const cap = median * 2.5;
  const keepCount = Math.max(1, Math.floor(sorted.length * 0.9)); // fora o decil superior
  const kept = sorted.slice(0, keepCount).filter((v) => v <= cap);
  const base = kept.length ? kept : sorted;
  return base.reduce((s, v) => s + v, 0) / base.length;
}

module.exports = { quantile, removeOutliersIQR, averageWithoutOutliers, bandWidthRobustMean };
