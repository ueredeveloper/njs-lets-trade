'use strict';

/** Distância mínima do stop em toda OCO do gráfico/Price action (espelho: frontend-react/src/utils/manualOco.js). */
const MIN_STOP_PCT = 10;

/** Stop nunca a menos de MIN_STOP_PCT% abaixo do preço de referência; stop já mais longe fica como está. */
function applyMinStop(stop, price) {
  const ref = Number(price);
  if (!(ref > 0)) return stop;
  return Math.min(Number(stop), ref * (1 - MIN_STOP_PCT / 100));
}

module.exports = { MIN_STOP_PCT, applyMinStop };
