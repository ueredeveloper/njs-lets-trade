'use strict';

const { calculateMa } = require('./movingAverage');

/**
 * Duração média (em candles) que a EMA rápida fica acima e abaixo da EMA lenta.
 *
 * Alinha as duas séries EMA (períodos diferentes geram arrays de tamanhos diferentes —
 * a EMA mais lenta "nasce" mais tarde) pelo openTime do candle, depois percorre sequencialmente
 * contando runs (sequências consecutivas) de "acima" e "abaixo" e tira a média de cada lado.
 *
 * @param {Array}  candles     candles no formato padrão do projeto ({ openTime, close, ... })
 * @param {number} fastPeriod  período da EMA rápida (default 9)
 * @param {number} slowPeriod  período da EMA lenta (default 21)
 * @returns {{
 *   avgCandlesAbove: number, avgCandlesBelow: number,
 *   aboveRunsCount: number, belowRunsCount: number,
 *   aboveRuns: number[], belowRuns: number[],
 *   samples: number,
 * } | null}
 */
function computeEmaCrossDurationStats(candles, fastPeriod = 9, slowPeriod = 21) {
  if (!Array.isArray(candles) || candles.length < slowPeriod + 1) return null;

  const closes = candles.map(c => parseFloat(c.close));
  const fastArr = calculateMa(closes, fastPeriod);
  const slowArr = calculateMa(closes, slowPeriod);
  if (!fastArr.length || !slowArr.length) return null;

  // fastArr[i] corresponde ao candle de índice (fastPeriod - 1 + i); mesma lógica pra slowArr.
  // Como slowPeriod > fastPeriod, a EMA lenta sempre começa depois — usa o índice dela como base.
  const offset = slowPeriod - fastPeriod;
  const samples = slowArr.length;

  const aboveRuns = [];
  const belowRuns = [];
  let currentState = null; // 'above' | 'below'
  let currentRunLength = 0;

  for (let i = 0; i < samples; i++) {
    const fast = fastArr[i + offset];
    const slow = slowArr[i];
    if (fast === slow) continue; // ignora empate exato — não pertence a nenhum dos dois lados

    const state = fast > slow ? 'above' : 'below';
    if (state === currentState) {
      currentRunLength++;
    } else {
      if (currentState === 'above') aboveRuns.push(currentRunLength);
      else if (currentState === 'below') belowRuns.push(currentRunLength);
      currentState = state;
      currentRunLength = 1;
    }
  }
  if (currentState === 'above') aboveRuns.push(currentRunLength);
  else if (currentState === 'below') belowRuns.push(currentRunLength);

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    avgCandlesAbove: parseFloat(avg(aboveRuns).toFixed(2)),
    avgCandlesBelow: parseFloat(avg(belowRuns).toFixed(2)),
    aboveRunsCount: aboveRuns.length,
    belowRunsCount: belowRuns.length,
    aboveRuns,
    belowRuns,
    samples,
  };
}

module.exports = { computeEmaCrossDurationStats };

// Uso direto:
//   node backend/utils/emaCrossDurationStats.js 龙虾USDT 1h 1000
//   node backend/utils/emaCrossDurationStats.js FIOUSDT 1h 500
if (require.main === module) {
  const { getGateCandles } = require('../gate/getGateCandles');

  const [, , symbol = '龙虾USDT', interval = '1h', limitArg = '1000'] = process.argv;
  const limit = parseInt(limitArg, 10);

  (async () => {
    console.log(`\nBuscando candles ${symbol} ${interval} (limit=${limit}) na Gate.io...`);
    const candles = await getGateCandles(symbol, interval, limit);
    console.log(`${candles.length} candles carregados.\n`);

    const stats = computeEmaCrossDurationStats(candles, 9, 21);
    if (!stats) {
      console.log('Histórico insuficiente para calcular EMA9/EMA21.');
      return;
    }

    console.log(`Símbolo:            ${symbol} (${interval})`);
    console.log(`Amostras (candles): ${stats.samples}`);
    console.log(`Runs acima:         ${stats.aboveRunsCount}`);
    console.log(`Runs abaixo:        ${stats.belowRunsCount}`);
    console.log(`Média candles EMA9 ACIMA da EMA21:  ${stats.avgCandlesAbove}`);
    console.log(`Média candles EMA9 ABAIXO da EMA21: ${stats.avgCandlesBelow}`);
  })().catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
  });
}
