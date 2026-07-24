'use strict';

// Motores de "crescimento por ciclo": varrem o histórico de candles de uma moeda
// procurando ciclos fundo→topo (entrada → saída) e calculam a valorização (%) média
// entre entrada e saída. Mesma lógica das telas de Estatísticas (analyseBollingerBandRecovery,
// analyseRsiOversoldRecovery, analyseMaCrossStats), porém enxuta e alimentada só por candles
// já em memória — usada pelo filtro cross-market de "Analisar Indicadores".

const { BollingerBands, RSI } = require('technicalindicators');
const { buildMaTimeSeries } = require('./movingAverage');
const { maValueAt, detectCrossAtPair, intervalMs } = require('../bot/ma-cross/strategyEngine');

function summarize(occurrences) {
  const total = occurrences.length;
  const avgAppreciationPercent = total > 0
    ? parseFloat((occurrences.reduce((s, o) => s + o, 0) / total).toFixed(2))
    : 0;
  return { totalOccurrences: total, avgAppreciationPercent };
}

/** Ciclo: mínima toca/cruza a banda inferior (fundo) → máxima toca/cruza a banda superior (topo). */
function computeBollingerGrowth(candles, { period = 20, stdDev = 2 } = {}) {
  if (!candles?.length || candles.length < period + 1) return null;

  const closes = candles.map(c => parseFloat(c.close));
  const bb = BollingerBands.calculate({ period, values: closes, stdDev });
  const offset = period - 1;

  const occurrences = [];
  let state = 'SEEK_ENTRY';
  let minLowIdx = null;

  for (let i = 0; i < bb.length; i++) {
    const candle = candles[i + offset];
    const low = parseFloat(candle.low);
    const high = parseFloat(candle.high);

    if (state === 'SEEK_ENTRY' && low <= bb[i].lower) {
      minLowIdx = i;
      state = 'SEEK_EXIT';
      continue;
    }

    if (state === 'SEEK_EXIT') {
      if (low < parseFloat(candles[minLowIdx + offset].low)) minLowIdx = i;

      if (high >= bb[i].upper) {
        const entryPrice = parseFloat(candles[minLowIdx + offset].close);
        const exitPrice = parseFloat(candle.close);
        occurrences.push(((exitPrice - entryPrice) / entryPrice) * 100);
        minLowIdx = null;
        state = 'SEEK_ENTRY';
      }
    }
  }

  return summarize(occurrences);
}

/** Ciclo: RSI cai abaixo de `oversold` (fundo) → RSI sobe acima de `overbought` (topo). */
function computeRsiGrowth(candles, { period = 14, oversold = 30, overbought = 70 } = {}) {
  if (!candles?.length || candles.length < period + 1) return null;

  const closes = candles.map(c => parseFloat(c.close));
  const rsiValues = RSI.calculate({ values: closes, period });
  const offset = period;

  const occurrences = [];
  let state = 'SEEK_ENTRY';
  let minRsiIdx = null;

  for (let i = 0; i < rsiValues.length; i++) {
    if (state === 'SEEK_ENTRY' && rsiValues[i] < oversold + 1) {
      minRsiIdx = i;
      state = 'SEEK_EXIT';
      continue;
    }

    if (state === 'SEEK_EXIT') {
      if (rsiValues[i] < rsiValues[minRsiIdx]) minRsiIdx = i;

      if (rsiValues[i] >= overbought - 1) {
        const entryPrice = parseFloat(candles[minRsiIdx + offset].close);
        const exitPrice = parseFloat(candles[i + offset].close);
        occurrences.push(((exitPrice - entryPrice) / entryPrice) * 100);
        minRsiIdx = null;
        state = 'SEEK_ENTRY';
      }
    }
  }

  return summarize(occurrences);
}

/** Ciclo: EMA(period1) cruza acima de EMA(period2) (entrada) → cruza abaixo (saída). */
function computeMaCrossGrowth(candles, { period1 = 9, period2 = 21, interval, tolerancePct = 0 } = {}) {
  const warmup = Math.max(period1, period2);
  if (!candles?.length || candles.length < warmup + 5) return null;

  const series1 = buildMaTimeSeries(candles, period1);
  const series2 = buildMaTimeSeries(candles, period2);
  const ms = intervalMs(interval);

  const occurrences = [];
  let state = 'SEEK_ENTRY';
  let entryPrice = null;

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i];
    const prev = candles[i - 1];
    if (Number(candle.openTime) - Number(prev.openTime) !== ms) continue;

    const ma1 = maValueAt(series1, candle.openTime);
    const ma2 = maValueAt(series2, candle.openTime);
    const prevMa1 = maValueAt(series1, prev.openTime);
    const prevMa2 = maValueAt(series2, prev.openTime);

    if (state === 'SEEK_ENTRY' && detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, 'cross_up', tolerancePct)) {
      entryPrice = parseFloat(candle.close);
      state = 'SEEK_EXIT';
      continue;
    }

    if (state === 'SEEK_EXIT' && detectCrossAtPair(prevMa1, prevMa2, ma1, ma2, 'cross_down', tolerancePct)) {
      const exitPrice = parseFloat(candle.close);
      occurrences.push(((exitPrice - entryPrice) / entryPrice) * 100);
      entryPrice = null;
      state = 'SEEK_ENTRY';
    }
  }

  return summarize(occurrences);
}

const ENGINES = {
  bollinger: computeBollingerGrowth,
  rsi: computeRsiGrowth,
  maCross: computeMaCrossGrowth,
};

/** @returns {{totalOccurrences:number, avgAppreciationPercent:number}|null} */
function computeIndicatorGrowth(engine, candles, params) {
  const fn = ENGINES[engine];
  if (!fn) throw new Error(`motor de crescimento desconhecido: ${engine}`);
  return fn(candles, params);
}

module.exports = {
  ENGINES,
  computeIndicatorGrowth,
  computeBollingerGrowth,
  computeRsiGrowth,
  computeMaCrossGrowth,
};
