'use strict';

// Motores de "crescimento por ciclo": varrem o histórico de candles de uma moeda
// procurando ciclos fundo→topo (entrada → saída) e calculam a valorização (%) média
// entre entrada e saída. Mesma lógica das telas de Estatísticas (analyseBollingerBandRecovery,
// analyseRsiOversoldRecovery, analyseMaCrossStats), porém enxuta e alimentada só por candles
// já em memória — usada pelo filtro cross-market de "Analisar Indicadores".

const { BollingerBands, RSI } = require('technicalindicators');
const { buildMaTimeSeries } = require('./movingAverage');
const { maValueAt, detectCrossAtPair, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { averageWithoutOutliers } = require('./removeOutliersIQR');

function summarize(occurrences) {
  const total = occurrences.length;
  const avgAppreciationPercent = total > 0
    ? parseFloat(averageWithoutOutliers(occurrences).toFixed(2))
    : 0;
  return { totalOccurrences: total, avgAppreciationPercent };
}

/** Ciclo: mínima toca/cruza a banda inferior (fundo) → máxima toca/cruza a banda superior (topo).
 * @returns {number[]|null} valorização (%) de cada ciclo completo, ou null se candles insuficientes.
 *  Reaproveitado pelo filtro de Largura de Banda (fetchBollingerBandWidthFilter.js/bbBandWidthCache.js) —
 *  a "largura" de uma moeda é definida como quanto ela sobe do fundo até o topo da banda, não a
 *  distância instantânea entre as bandas (que fica artificialmente alta por vários candles após um
 *  crash/pump pontual, mesmo já sem o preço estar de fato subindo rumo ao topo). */
function bollingerCycleOccurrences(candles, { period = 20, stdDev = 2 } = {}) {
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

  return occurrences;
}

function computeBollingerGrowth(candles, params) {
  const occurrences = bollingerCycleOccurrences(candles, params);
  return occurrences === null ? null : summarize(occurrences);
}

/**
 * Largura das Bandas de Bollinger candle a candle: para cada candle onde a BB está definida,
 * `w_i = (upper_i - lower_i) / lower_i * 100` (distância entre as bandas em % da banda inferior).
 * Devolve a série de w_i pra o chamador tirar a média robusta (ver bandWidthRobustMean em
 * removeOutliersIQR.js — descarta as altas expressivas que inflam a média). null se candles
 * insuficientes pro período.
 */
function bollingerBandWidthSeries(candles, { period = 20, stdDev = 2 } = {}) {
  if (!candles?.length || candles.length < period + 1) return null;
  const closes = candles.map(c => parseFloat(c.close));
  const bb = BollingerBands.calculate({ period, values: closes, stdDev });
  const out = [];
  for (const b of bb) {
    if (b.lower > 0 && b.upper > b.lower) out.push(((b.upper - b.lower) / b.lower) * 100);
  }
  return out.length ? out : null;
}

/**
 * Mesma série de bollingerBandWidthSeries, mas pareada com o timestamp (openTime) do candle de
 * cada ponto — usada pra desenhar a evolução no tempo (Estatísticas → aba Banda BB), em vez de só
 * a média/min/max agregados que bollingerBandWidthSeries alimenta hoje.
 */
function bollingerBandWidthSeriesWithTime(candles, { period = 20, stdDev = 2 } = {}) {
  if (!candles?.length || candles.length < period + 1) return null;
  const closes = candles.map(c => parseFloat(c.close));
  const bb = BollingerBands.calculate({ period, values: closes, stdDev });
  const offset = period - 1;
  const out = [];
  for (let i = 0; i < bb.length; i++) {
    const b = bb[i];
    if (b.lower > 0 && b.upper > b.lower) {
      out.push({ time: Number(candles[i + offset].openTime), widthPct: ((b.upper - b.lower) / b.lower) * 100 });
    }
  }
  return out.length ? out : null;
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

/** Ciclo: RSI cruza de baixo pra cima do nível `from` (ex.: 50) → atinge `to` (ex.: 70) sem
 * antes recuar abaixo de `from` — mede quantos minutos o "arranque" (thrust) levou, e a
 * velocidade média (pontos de RSI por minuto). Diferente de computeRsiGrowth: aqui o que
 * importa é o TEMPO do movimento do RSI, não a valorização de preço do ciclo fundo→topo.
 * Se o ciclo mais recente ainda está em andamento (RSI entre from e to, sem ter recuado),
 * isso fica exposto em `current` — é o sinal de "explodindo agora". */
function computeRsiThrust(candles, { period = 14, from = 50, to = 70, interval } = {}) {
  if (!candles?.length || candles.length < period + 2) return null;
  if (to <= from) throw new Error('rsiThrust: "to" deve ser maior que "from"');

  const closes = candles.map(c => parseFloat(c.close));
  const rsiValues = RSI.calculate({ values: closes, period });
  if (rsiValues.length < 2) return null;

  const minutesPerCandle = intervalMs(interval) / 60_000;
  const occurrencesMinutes = [];
  let state = 'SEEK_ENTRY';
  let entryIdx = null;

  for (let i = 1; i < rsiValues.length; i++) {
    if (state === 'SEEK_ENTRY') {
      if (rsiValues[i - 1] < from && rsiValues[i] >= from) {
        entryIdx = i;
        state = 'SEEK_EXIT';
      }
      continue;
    }

    if (rsiValues[i] < from) {
      state = 'SEEK_ENTRY';
      entryIdx = null;
      continue;
    }

    if (rsiValues[i] >= to) {
      occurrencesMinutes.push((i - entryIdx) * minutesPerCandle);
      state = 'SEEK_ENTRY';
      entryIdx = null;
    }
  }

  const lastIdx = rsiValues.length - 1;
  const current = state === 'SEEK_EXIT'
    ? {
      inProgress: true,
      minutesElapsed: parseFloat(((lastIdx - entryIdx) * minutesPerCandle).toFixed(1)),
      currentRsi: parseFloat(rsiValues[lastIdx].toFixed(2)),
    }
    : { inProgress: false, minutesElapsed: null, currentRsi: parseFloat(rsiValues[lastIdx].toFixed(2)) };

  const totalOccurrences = occurrencesMinutes.length;
  if (totalOccurrences === 0) {
    return { totalOccurrences: 0, avgMinutes: null, avgVelocity: null, current };
  }

  const avgMinutes = parseFloat(averageWithoutOutliers(occurrencesMinutes).toFixed(1));
  const avgVelocity = avgMinutes > 0 ? parseFloat(((to - from) / avgMinutes).toFixed(3)) : null;

  return { totalOccurrences, avgMinutes, avgVelocity, current };
}

/**
 * Expansão da largura de banda dentro da janela de candles buscada: acha o MENOR valor de largura
 * da série (o "fundo" mais recente que a janela alcança) e mede a subida até o valor ATUAL — em
 * pontos concretos ("foi de 1% pra 3%", "de 4% pra 10%"), não um cruzamento de patamar fixo
 * escolhido a dedo (que só faz sentido pra uma moeda cuja largura "normal" já é perto desses
 * valores — a largura "normal" varia demais de moeda pra moeda pra um limiar único fazer sentido
 * no mercado inteiro). `ratio`/`gainPct` (atual ÷ fundo, e o ganho % equivalente) respondem direto
 * "dobrou?"/"triplicou?" (ratio 2 = ganho 100%, ratio 3 = ganho 200%) — o que importa é o GANHO
 * relativo, não os valores absolutos em si (1%→2% e 5%→10% são o mesmo ganho de 100%). O quanto a
 * busca alcança pra trás é o próprio `lookback` já usado pra buscar a série (ver conversa sobre
 * lookback pequeno perder expansões que começaram antes da janela). Usado pela aba Estatísticas →
 * Banda BB (avaliação de velocidade de expansão, independente do RSI Momentum).
 */
const BAND_WIDTH_RATIO_MIN_TROUGH_PCT = 0.05;

function computeBandWidthExpansion(candles, { period = 20, stdDev = 2 } = {}) {
  const series = bollingerBandWidthSeriesWithTime(candles, { period, stdDev });
  if (!series || series.length < 2) return null;

  let troughIdx = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i].widthPct < series[troughIdx].widthPct) troughIdx = i;
  }
  const lastIdx = series.length - 1;
  const trough = series[troughIdx];
  const current = series[lastIdx];
  const minutesSinceTrough = (current.time - trough.time) / 60_000;
  const velocityPpPerMin = minutesSinceTrough > 0
    ? parseFloat(((current.widthPct - trough.widthPct) / minutesSinceTrough).toFixed(4))
    : null;
  // Fundo perto de 0 (stablecoin, ou candle flat) faz a razão explodir pra números sem sentido
  // (ex.: USDP/XUSD deram "ratio" na casa dos trilhões) — abaixo desse piso, "ganho relativo" não
  // é uma pergunta que faça sentido pra essa moeda; null em vez de um número absurdo.
  const ratio = trough.widthPct >= BAND_WIDTH_RATIO_MIN_TROUGH_PCT ? current.widthPct / trough.widthPct : null;
  const rising = lastIdx > 0 ? current.widthPct > series[lastIdx - 1].widthPct : false;

  return {
    troughWidthPct: parseFloat(trough.widthPct.toFixed(2)),
    troughTime: trough.time,
    currentWidthPct: parseFloat(current.widthPct.toFixed(2)),
    minutesSinceTrough: parseFloat(minutesSinceTrough.toFixed(1)),
    velocityPpPerMin,
    ratio: ratio != null ? parseFloat(ratio.toFixed(2)) : null,
    gainPct: ratio != null ? parseFloat(((ratio - 1) * 100).toFixed(1)) : null,
    rising,
  };
}

const ENGINES = {
  bollinger: computeBollingerGrowth,
  rsi: computeRsiGrowth,
  maCross: computeMaCrossGrowth,
  rsiThrust: computeRsiThrust,
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
  computeRsiThrust,
  computeBandWidthExpansion,
  bollingerCycleOccurrences,
  bollingerBandWidthSeries,
  bollingerBandWidthSeriesWithTime,
};
