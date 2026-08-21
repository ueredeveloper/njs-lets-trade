'use strict';

// Regras de filtro/ranking do motor rsiThrust (arranque de RSI, ex.: 50→70), compartilhadas
// entre o caminho ao vivo (fetchIndicatorGrowthFilter.js) e o cache pré-aquecido
// (indicatorGrowthCache.js) — as duas pontas precisam concordar em quem "passa" e em que ordem.

/** Velocidade (pontos de RSI/min) usada pra ranquear — cai pro arranque em andamento (ainda
 *  sem `avgVelocity` histórico) quando é só isso que a moeda tem até agora. */
function thrustVelocity(row, from, to) {
  if (row.avgVelocity != null) return row.avgVelocity;
  if (row.current?.inProgress && row.current.minutesElapsed > 0) {
    return (to - from) / row.current.minutesElapsed;
  }
  return 0;
}

/** Passa no filtro: histórico confiável de arranque rápido (≤ maxMinutes) OU explodindo
 *  agora (arranque em andamento, ainda dentro de maxMinutes). */
function passesThrustFilter(result, maxMinutes, minOccurrences) {
  if (!result) return false;
  const hasReliableHistory = result.totalOccurrences >= minOccurrences && result.avgMinutes <= maxMinutes;
  const isExplodingNow = result.current?.inProgress && result.current.minutesElapsed <= maxMinutes;
  return hasReliableHistory || isExplodingNow;
}

/** Ordena: quem está explodindo agora primeiro, depois por velocidade decrescente. */
function compareThrustRows(a, b, from, to) {
  if (!!a.current?.inProgress !== !!b.current?.inProgress) return a.current?.inProgress ? -1 : 1;
  return thrustVelocity(b, from, to) - thrustVelocity(a, from, to);
}

module.exports = { thrustVelocity, passesThrustFilter, compareThrustRows };
