'use strict';

const { detectPivotPointsHighLow } = require('./pivotPointsHighLow');

/**
 * Williams Fractals (Bill Williams): marca cada candle que é um topo/fundo
 * local — o `high` (ou `low`) mais extremo dentro de uma janela de `bars`
 * candles de cada lado, todos já fechados. É o caso particular do
 * detectPivotPointsHighLow com leftBars = rightBars = bars (padrão 2, a
 * definição clássica de fractal). Devolve um marcador por fractal:
 * `[{ type: 'high'|'low', price, time }]` ordenado por tempo.
 */
function detectWilliamsFractals(candles, opts = {}) {
  const bars = Math.max(1, opts.bars ?? 2);
  return detectPivotPointsHighLow(candles, { leftBars: bars, rightBars: bars });
}

module.exports = { detectWilliamsFractals };
