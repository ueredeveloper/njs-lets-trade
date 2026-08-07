'use strict';

const { BollingerBands } = require('technicalindicators');
const { computeStopLossFloor } = require('../shared/stopLossFloor');

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

function intervalMs(iv) {
  return INTERVAL_MS[iv] ?? 3_600_000;
}

function closedCandlesOnly(candles) {
  if (!candles?.length || candles.length < 2) return candles ?? [];
  return candles.slice(0, -1);
}

/** Série de Bollinger Bands (upper/middle/lower) a partir de candles JÁ FECHADOS — ancora
 *  a banda no histórico consolidado, sem "perseguir" o candle ainda em formação. */
function computeBollingerSeries(candles, period, stdDev) {
  if (!candles?.length || candles.length < period) return [];
  const closes = candles.map(c => parseFloat(c.close));
  const bb = BollingerBands.calculate({ period, values: closes, stdDev });
  if (!bb.length) return [];
  const offset = candles.length - bb.length;
  return bb.map((b, i) => ({
    openTime: Number(candles[i + offset].openTime),
    lower: b.lower, middle: b.middle, upper: b.upper,
  }));
}

function getRequiredSpecs(config) {
  const entry = config.entry;
  const limit = entry.period * 3 + 30;
  return [{ interval: entry.interval, limit }];
}

/**
 * Sinal de entrada: a mínima do candle mais recente (ainda em formação — reage sem esperar
 * o fechamento) toca/rompe a banda inferior, calculada com candles JÁ FECHADOS.
 * entry.pullback desce esse gatilho pullback.belowPct% abaixo da banda — exige um repique
 * mais fundo antes de comprar; desligado (padrão) compra assim que toca a banda.
 */
function evaluateEntrySignal(config, cMap) {
  const entry = config.entry;
  const iv = entry.interval;
  const raw = cMap[iv] ?? [];
  if (raw.length < 2) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

  const closed = closedCandlesOnly(raw);
  const series = computeBollingerSeries(closed, entry.period, entry.stdDev);
  if (!series.length) return { allowed: false, reason: 'NO_BANDS' };

  const lastBb = series[series.length - 1];
  const live = raw[raw.length - 1];
  const liveLow = parseFloat(live.low ?? live.close);
  const liveClose = parseFloat(live.close);

  const pullbackPct = entry.pullback?.enabled ? Math.max(0, entry.pullback.belowPct) : 0;
  const threshold = lastBb.lower * (1 - pullbackPct / 100);

  if (liveLow > threshold) {
    return {
      allowed: false, reason: 'BB_LOWER_NOT_TOUCHED',
      close: liveClose, lower: lastBb.lower, threshold,
    };
  }

  return {
    allowed: true,
    close: liveClose,
    limitPrice: threshold,
    lower: lastBb.lower, middle: lastBb.middle, upper: lastBb.upper,
    threshold,
    entryDesc: pullbackPct > 0
      ? `BB(${entry.period},${entry.stdDev}) ${iv} banda inferior -${pullbackPct}%`
      : `BB(${entry.period},${entry.stdDev}) ${iv} banda inferior`,
  };
}

/** Preço-alvo (banda superior ao vivo) e preço-stop (piso percentual) vigentes — usado
 *  tanto pra colocar/repor a bracket TP/SL resting na corretora quanto pelo evaluateExit
 *  de fallback (candle, sem bracket). */
function computeBracketPrices(config, cMap, entryPrice, peakPrice) {
  const entry = config.entry;
  const iv = entry.interval;
  const raw = cMap[iv] ?? [];
  if (!raw.length) return { targetPrice: null, stopPrice: null, close: null };

  const closed = closedCandlesOnly(raw);
  const series = computeBollingerSeries(closed, entry.period, entry.stdDev);
  const live = raw[raw.length - 1];
  const close = parseFloat(live.close);
  if (!series.length) return { targetPrice: null, stopPrice: null, close };

  const lastBb = series[series.length - 1];
  const stopPrice = config.stopLoss?.enabled
    ? computeStopLossFloor(entryPrice, peakPrice ?? entryPrice, config.stopLoss)
    : null;

  return { targetPrice: lastBb.upper, stopPrice, close };
}

/** Saída via candle — fallback usado quando não há bracket resting (desligada ou falhou
 *  ao colocar): máxima do candle em formação alcança a banda superior, ou mínima rompe o
 *  piso do stop percentual. */
function evaluateExit(config, cMap, entryPrice, opts = {}) {
  const entry = config.entry;
  const iv = entry.interval;
  const raw = cMap[iv] ?? [];
  if (!raw.length) return { exit: false };

  const live = raw[raw.length - 1];
  const close = parseFloat(live.close);
  const high = parseFloat(live.high ?? live.close);
  const low = parseFloat(live.low ?? live.close);

  const { targetPrice, stopPrice } = computeBracketPrices(config, cMap, entryPrice, opts.peakPrice);

  if (targetPrice != null && high >= targetPrice) {
    return {
      exit: true, reason: 'BB_UPPER_TARGET', close,
      targetLevelValue: targetPrice,
      exitDesc: `BB(${entry.period},${entry.stdDev}) ${iv} banda superior`,
    };
  }
  if (stopPrice != null && low <= stopPrice) {
    return {
      exit: true, reason: 'STOP_LOSS', close,
      dropPct: entryPrice ? ((close - entryPrice) / entryPrice) * 100 : null,
      stopFloor: stopPrice,
    };
  }
  return { exit: false, close };
}

module.exports = {
  intervalMs,
  closedCandlesOnly,
  computeBollingerSeries,
  getRequiredSpecs,
  evaluateEntrySignal,
  evaluateExit,
  computeBracketPrices,
  computeStopLossFloor,
};
