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

module.exports = { quantile, removeOutliersIQR, averageWithoutOutliers };
