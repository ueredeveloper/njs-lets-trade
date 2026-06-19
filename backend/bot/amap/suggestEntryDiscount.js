'use strict';

/**
 * Sugere desconto de entrada PENDING a partir do histórico.
 *
 * Para cada vez que o RSI de entrada é atingido (ex.: RSI < 30 em 15m),
 * mede quanto o preço ainda cai (mínimo do candle) antes de:
 *   - RSI de saída ser atingido, ou
 *   - preço recuperar acima do gatilho (cancelamento PENDING), ou
 *   - timeout do PENDING.
 */

const ti = require('technicalindicators');

function checkRsi(value, rule) {
  if (value == null) return false;
  if (rule.operator === '<=') return value <= rule.value;
  if (rule.operator === '>=') return value >= rule.value;
  return rule.operator === '<' ? value < rule.value : value > rule.value;
}

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

const DEFAULT_OPTS = {
  defaultDiscount: 0.001,
  minDiscount:     0.0005,  // 0,05%
  maxDiscount:     0.05,    // 5%
  minEpisodes:     3,
  safetyFactor:    0.85,    // mediana × fator → alvo um pouco conservador
};

function rsiCrossedInto(entryRule, prevRsi, currRsi) {
  if (currRsi == null) return false;
  if (prevRsi == null) return checkRsi(currRsi, entryRule);
  const wasIn = checkRsi(prevRsi, entryRule);
  const isIn  = checkRsi(currRsi, entryRule);
  return !wasIn && isIn;
}

function buildRsiPoints(candles, period) {
  if (!candles?.length) return [];
  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period });
  const offset = closes.length - rsiArr.length;
  return rsiArr.map((rsi, i) => {
    const c = candles[offset + i];
    return { openTime: c.openTime, close: c.close, low: c.low, rsi, idx: offset + i };
  });
}

function exitRsiAt(exitPoints, openTime) {
  let best = null;
  for (const pt of exitPoints) {
    if (pt.openTime <= openTime) best = pt.rsi;
    else break;
  }
  return best;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

/**
 * @param {object[]} entryCandles
 * @param {object} entryRsi  — { interval, period, operator, value }
 * @param {object} exitRsi
 * @param {object} opts — pendingTimeoutMs, pendingCancelPct, …
 */
function analyzeEntryDiscount(entryCandles, entryRsi, exitRsi, opts = {}, exitCandles = null) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const intervalMs = INTERVAL_MS[entryRsi.interval] ?? 900_000;
  const maxBars    = Math.max(1, Math.ceil((o.pendingTimeoutMs ?? 30 * 60_000) / intervalMs));

  if (!entryCandles?.length || entryCandles.length < entryRsi.period + 20) {
    return {
      suggestedDiscount: o.defaultDiscount,
      suggestedPct:      o.defaultDiscount * 100,
      usedDefault:       true,
      reason:            'dados_insuficientes',
      episodeCount:      0,
      episodes:          [],
    };
  }

  const entryPoints = buildRsiPoints(entryCandles, entryRsi.period);
  const exitSource  = exitCandles ?? entryCandles;
  const exitPoints  = (entryRsi.interval === exitRsi.interval && entryRsi.period === exitRsi.period && !exitCandles)
    ? entryPoints
    : buildRsiPoints(exitSource, exitRsi.period);

  const cancelPct = o.pendingCancelPct ?? 0.002;
  const episodes  = [];

  for (let i = 1; i < entryPoints.length; i++) {
    const pt     = entryPoints[i];
    const prev   = entryPoints[i - 1];
    if (!rsiCrossedInto(entryRsi, prev.rsi, pt.rsi)) continue;

    const triggerPrice = pt.close;
    let minLow         = pt.low;
    let endReason      = 'end_of_data';
    let barsHeld       = 0;

    for (let j = i + 1; j < entryPoints.length; j++) {
      const fwd = entryPoints[j];
      barsHeld = j - i;
      minLow   = Math.min(minLow, fwd.low);

      const exitVal = exitRsiAt(exitPoints, fwd.openTime);
      const cancelOnExit = o.pendingCancelOnExitRsi !== false;
      if (cancelOnExit && exitVal != null && checkRsi(exitVal, exitRsi)) {
        endReason = 'exit_rsi';
        break;
      }
      if (fwd.close > triggerPrice * (1 + cancelPct)) {
        endReason = 'recovery';
        break;
      }
      if (barsHeld >= maxBars) {
        endReason = 'timeout';
        break;
      }
    }

    const maxDipPct = Math.max(0, (triggerPrice - minLow) / triggerPrice * 100);
    episodes.push({
      triggerTime:  pt.openTime,
      triggerPrice,
      maxDipPct:    parseFloat(maxDipPct.toFixed(3)),
      endReason,
      barsHeld,
    });
  }

  if (episodes.length < o.minEpisodes) {
    return {
      suggestedDiscount: o.defaultDiscount,
      suggestedPct:      parseFloat((o.defaultDiscount * 100).toFixed(2)),
      usedDefault:       true,
      reason:            'poucos_episodios',
      episodeCount:      episodes.length,
      episodes,
      avgDipPct:         null,
      medianDipPct:      null,
    };
  }

  const dips        = episodes.map(e => e.maxDipPct).sort((a, b) => a - b);
  const avgDipPct   = dips.reduce((s, d) => s + d, 0) / dips.length;
  const medianDipPct = percentile(dips, 0.5);
  const rawPct      = medianDipPct * o.safetyFactor;
  const clampedPct  = Math.max(o.minDiscount * 100, Math.min(o.maxDiscount * 100, rawPct));
  const discount    = parseFloat((clampedPct / 100).toFixed(4));

  const hitRate = episodes.filter(e => e.maxDipPct >= clampedPct).length / episodes.length;

  return {
    suggestedDiscount: discount,
    suggestedPct:      parseFloat(clampedPct.toFixed(2)),
    usedDefault:       false,
    reason:            null,
    episodeCount:      episodes.length,
    episodes,
    avgDipPct:         parseFloat(avgDipPct.toFixed(2)),
    medianDipPct:      parseFloat(medianDipPct.toFixed(2)),
    hitRateAtSuggested: parseFloat((hitRate * 100).toFixed(1)),
    maxBars,
  };
}

function buildEntryDiscountReport(cMap, config) {
  const entryIv = config.entryRsi?.interval;
  const exitIv  = config.exitRsi?.interval;
  const candles = cMap[entryIv];
  const exitCandles = exitIv !== entryIv ? cMap[exitIv] : null;
  return {
    interval: entryIv,
    entryRsi: config.entryRsi,
    ...analyzeEntryDiscount(candles, config.entryRsi, config.exitRsi, {
      pendingTimeoutMs: config.pendingTimeoutMs,
      pendingCancelPct: config.pendingCancelPct,
      pendingCancelOnExitRsi: config.pendingCancelOnExitRsi,
    }, exitCandles),
  };
}

module.exports = {
  analyzeEntryDiscount,
  buildEntryDiscountReport,
  DEFAULT_OPTS,
  rsiCrossedInto,
};
