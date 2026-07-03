'use strict';

/**
 * Análise adaptativa de dip abaixo de uma MA por símbolo.
 *
 * Identifica episódios onde o preço fecha abaixo da MA, depois recupera
 * (volta a fechar acima). Para cada episódio mede o maior % abaixo da MA.
 * O threshold adaptativo é a média desses dips (com clamp min/max).
 *
 * Responde: "quanto essa moeda costuma cair abaixo da MA50 antes de retomar a alta?"
 */

const { calculateMa, computeMa } = require('../../utils/movingAverage');

const DEFAULT_OPTS = { defaultPct: 3.0, maxPct: 5.0, minPct: 0.5, minEpisodes: 3 };

/**
 * @returns {{ dipPct, episodes, usedDefault, reason?, avgRaw?, episodeCount? }}
 */
function analyzeAdaptiveDip(candles, period = 50, opts = {}) {
  const { defaultPct, maxPct, minPct, minEpisodes } = { ...DEFAULT_OPTS, ...opts };

  if (!candles?.length || candles.length < period + 10) {
    return { dipPct: defaultPct, episodes: [], usedDefault: true, reason: 'dados_insuficientes', episodeCount: 0 };
  }

  const closes  = candles.map(c => c.close);
  const maArr   = calculateMa(closes, period);
  const aligned = maArr.map((ma, i) => ({
    openTime: candles[period - 1 + i].openTime,
    close:    closes[period - 1 + i],
    ma,
  }));

  const episodes = [];
  let inDip    = false;
  let dipStart = -1;

  for (let i = 0; i < aligned.length; i++) {
    const below = aligned[i].close < aligned[i].ma;

    if (below && !inDip) {
      if (i > 0 && aligned[i - 1].close >= aligned[i - 1].ma) {
        inDip    = true;
        dipStart = i;
      }
    } else if (!below && inDip) {
      let maxDipPct = 0;
      for (let j = dipStart; j < i; j++) {
        const pct = (aligned[j].ma - aligned[j].close) / aligned[j].ma * 100;
        if (pct > maxDipPct) maxDipPct = pct;
      }
      episodes.push({
        maxDipPct: parseFloat(maxDipPct.toFixed(2)),
        startTime: aligned[dipStart].openTime,
        endTime:   aligned[i - 1].openTime,
      });
      inDip = false;
    }
  }

  if (episodes.length < minEpisodes) {
    return {
      dipPct: defaultPct, episodes, usedDefault: true,
      reason: 'poucos_episodios', episodeCount: episodes.length,
    };
  }

  const avg    = episodes.reduce((s, e) => s + e.maxDipPct, 0) / episodes.length;
  const dipPct = Math.max(minPct, Math.min(maxPct, parseFloat(avg.toFixed(2))));
  return {
    dipPct, episodes, usedDefault: false,
    avgRaw: parseFloat(avg.toFixed(2)), episodeCount: episodes.length,
  };
}

function computeAdaptiveDipPct(candles, period, opts) {
  return analyzeAdaptiveDip(candles, period, opts).dipPct;
}

function lastMa(candles, period = 50) {
  return computeMa(candles, period);
}

module.exports = { analyzeAdaptiveDip, computeAdaptiveDipPct, lastMa, DEFAULT_OPTS };
