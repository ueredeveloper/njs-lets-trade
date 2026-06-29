'use strict';

/**
 * Sugere % abaixo do mercado para ordem limit na entrada RSI.
 * Usa os mesmos episódios RSI < rsiBuy até recuperação do histórico de stop.
 */

const ti = require('technicalindicators');
const { collectHistEpisodes } = require('./suggestStopLoss');

const MAX_BELOW_PCT = 8;
const MIN_BELOW_PCT = 0.1;

function suggestEntryBelowPct(candles, rsiPeriod, rsiBuy, currentPrice) {
  if (!candles?.length || candles.length < rsiPeriod + 10) {
    return { ok: false, reason: 'dados_insuficientes', rsiBuy };
  }

  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period: rsiPeriod });

  let episodes = collectHistEpisodes(rsiArr, closes, rsiPeriod, rsiBuy, rsiBuy + 3);
  if (!episodes.length) {
    episodes = collectHistEpisodes(rsiArr, closes, rsiPeriod, rsiBuy, rsiBuy + 1);
  }

  if (!episodes.length) {
    return {
      ok: false,
      reason: 'poucos_episodios',
      episodeCount: 0,
      drops: [],
      rsiBuy,
      label: `RSI<${rsiBuy}`,
    };
  }

  const sorted  = [...episodes].sort((a, b) => a - b);
  const median  = sorted[Math.floor(sorted.length / 2)];
  const p75Idx  = Math.min(Math.floor(sorted.length * 0.75), sorted.length - 1);
  const p75     = sorted[p75Idx];
  const avg     = sorted.reduce((s, v) => s + v, 0) / sorted.length;

  // Mediana: limite realista que costuma ser atingido antes da recuperação
  let suggested = parseFloat(median.toFixed(2));
  if (suggested < MIN_BELOW_PCT) suggested = MIN_BELOW_PCT;
  if (suggested > MAX_BELOW_PCT) suggested = MAX_BELOW_PCT;

  const ref = Number(currentPrice);
  const limitPrice = Number.isFinite(ref) && ref > 0
    ? parseFloat((ref * (1 - suggested / 100)).toFixed(8))
    : null;

  const fillRate = pct => parseFloat(
    (episodes.filter(d => d >= pct).length / episodes.length * 100).toFixed(1),
  );

  return {
    ok: true,
    rsiBuy,
    label: `RSI<${rsiBuy}`,
    lowSample: episodes.length < 3,
    suggestedBelowPct: suggested,
    medianDropPct: parseFloat(median.toFixed(2)),
    p75DropPct: parseFloat(p75.toFixed(2)),
    avgDropPct: parseFloat(avg.toFixed(2)),
    episodeCount: episodes.length,
    drops: episodes,
    currentPrice: ref,
    limitPrice,
    fillRateMedian: fillRate(suggested),
    description:
      `${episodes.length} episódios RSI<${rsiBuy}: queda mediana −${median.toFixed(2)}% ` +
      `→ sugerido limit −${suggested}% (atingido em ~${fillRate(suggested)}% dos casos)`,
  };
}

module.exports = { suggestEntryBelowPct, MAX_BELOW_PCT, MIN_BELOW_PCT };
