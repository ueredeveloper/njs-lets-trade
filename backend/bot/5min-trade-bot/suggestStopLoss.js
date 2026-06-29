'use strict';

/**
 * Sugestões de stop loss para o 5min-trade-bot.
 *
 * fixedStopLoss      : −X% do preço de referência (entrada)
 * historicalStopLoss : episódios RSI < rsiBuy até recuperar — P75 da queda máxima
 * maStopLoss         : MA configurada + piso adaptativo − 2%
 */

const ti = require('technicalindicators');
const { suggestMaTolerance, resolveMaStopFilter } = require('./maFilter');

const MAX_DROP_PCT = 25;

function fixedStopLoss(referencePrice, pct) {
  const price = Number(referencePrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: 'preco_invalido' };
  }
  const stopPct   = Number(pct);
  const stopPrice = parseFloat((price * (1 - stopPct / 100)).toFixed(8));
  return {
    ok: true,
    stopPrice,
    stopPct,
    label: `Fixo −${stopPct}%`,
  };
}

/**
 * Mede quanto o preço caiu em cada episódio RSI < rsiBuy até RSI recuperar (rsiBuy + 3).
 *
 * @param {object[]} candles
 * @param {number}   rsiPeriod
 * @param {number}   rsiBuy    limiar de compra do usuário (ex: 25, 30)
 * @param {number}   referencePrice — preço atual ou médio de entrada
 */
function collectHistEpisodes(rsiArr, closes, rsiPeriod, rsiBuy, recoverAbove) {
  const episodes = [];
  let inDip      = false;
  let entryClose = 0;
  let minClose   = Infinity;

  for (let i = 0; i < rsiArr.length; i++) {
    const rsi   = rsiArr[i];
    const close = closes[rsiPeriod + i];

    if (!inDip && rsi < rsiBuy) {
      inDip      = true;
      entryClose = close;
      minClose   = close;
    } else if (inDip) {
      if (close < minClose) minClose = close;
      if (rsi >= recoverAbove) {
        const dropPct = entryClose > 0 ? (entryClose - minClose) / entryClose * 100 : 0;
        if (dropPct >= 0 && dropPct <= MAX_DROP_PCT) {
          episodes.push(parseFloat(dropPct.toFixed(2)));
        }
        inDip = false;
      }
    }
  }

  if (inDip && entryClose > 0 && Number.isFinite(minClose)) {
    const dropPct = (entryClose - minClose) / entryClose * 100;
    if (dropPct >= 0 && dropPct <= MAX_DROP_PCT) {
      episodes.push(parseFloat(dropPct.toFixed(2)));
    }
  }

  return episodes;
}

function historicalStopLoss(candles, rsiPeriod, rsiBuy, referencePrice) {
  if (!candles?.length || candles.length < rsiPeriod + 10) {
    return { ok: false, reason: 'dados_insuficientes', rsiBuy };
  }

  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period: rsiPeriod });

  let episodes = collectHistEpisodes(rsiArr, closes, rsiPeriod, rsiBuy, rsiBuy + 3);
  if (!episodes.length) {
    episodes = collectHistEpisodes(rsiArr, closes, rsiPeriod, rsiBuy, rsiBuy + 1);
  }

  if (episodes.length < 1) {
    const minRsiObserved = rsiArr.length
      ? parseFloat(Math.min(...rsiArr).toFixed(2))
      : null;
    return {
      ok: false,
      reason: 'poucos_episodios',
      episodeCount: 0,
      drops: episodes,
      rsiBuy,
      label: `RSI<${rsiBuy}`,
      minRsiObserved,
      candleCount: closes.length,
    };
  }

  const sorted    = [...episodes].sort((a, b) => a - b);
  const p75Idx    = Math.min(Math.floor(sorted.length * 0.75), sorted.length - 1);
  const p75       = sorted[p75Idx];
  const median    = sorted[Math.floor(sorted.length / 2)];
  const avg       = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const refPrice  = Number(referencePrice);

  const survivalPct = pct => parseFloat(
    (episodes.filter(d => d <= pct).length / episodes.length * 100).toFixed(1),
  );

  return {
    ok:           true,
    rsiBuy,
    label:        `RSI<${rsiBuy}`,
    lowSample:    episodes.length < 3,
    stopPrice:    parseFloat((refPrice * (1 - p75 / 100)).toFixed(8)),
    stopPct:      parseFloat(p75.toFixed(2)),
    medianPct:    parseFloat(median.toFixed(2)),
    avgDropPct:   parseFloat(avg.toFixed(2)),
    episodeCount: episodes.length,
    drops:        episodes,
    survival2Pct: survivalPct(2),
    survival5Pct: survivalPct(5),
    description:
      `${episodes.length} episódios RSI<${rsiBuy} → recuperação: ` +
      `mediana −${median.toFixed(2)}%, média −${avg.toFixed(2)}%, P75 −${p75.toFixed(2)}%`,
  };
}

/**
 * Stop pela MA configurada em ma_filters: 2% abaixo do piso adaptativo.
 */
function maStopFromCandles(candles, filter, currentPrice) {
  if (!candles?.length || candles.length < filter.period) {
    return { ok: false, reason: 'dados_insuficientes' };
  }
  const sug = suggestMaTolerance(candles, filter.period, filter.interval, {
    defaultPct: 3, maxPct: 8, minPct: 0.5, minEpisodes: 3,
  });
  const { currentMa, floor, suggestedTolerancePct } = sug;
  if (!currentMa || !floor) return { ok: false, reason: 'ma_indisponivel' };

  const stopPrice = parseFloat((floor * 0.98).toFixed(8));
  const stopPct   = parseFloat(((currentPrice - stopPrice) / currentPrice * 100).toFixed(2));

  return {
    ok:             true,
    stopPrice,
    stopPct,
    maValue:        parseFloat(currentMa.toFixed(8)),
    adaptiveFloor:  parseFloat(floor.toFixed(8)),
    adaptiveDipPct: suggestedTolerancePct,
    label:          `MA${filter.period}(${filter.interval})`,
  };
}

async function maStopLoss(adapter, maFilters, currentPrice) {
  const f = resolveMaStopFilter(maFilters);
  let candles;
  try {
    candles = await adapter.fetchCandles(f.period + 500, f.interval);
  } catch {
    return { ok: false, reason: 'erro_candles' };
  }
  return maStopFromCandles(candles, f, currentPrice);
}

/** Compara fixo −2%/−5% com histórico e escolhe o melhor. */
function compareStopLossOptions({ hist, ma, fixed2, fixed5 }) {
  const notes = {};

  if (!hist?.ok) {
    const rec = fixed5?.ok ? 'fixed_5' : 'fixed_2';
    notes[rec] = 'Sem histórico RSI suficiente — use stop fixo';
    return { recommended: rec, notes, survival2Pct: null, survival5Pct: null };
  }

  const surv2 = hist.survival2Pct ?? 0;
  const surv5 = hist.survival5Pct ?? 0;
  const p75     = hist.stopPct;
  const median  = hist.medianPct;

  notes.fixed_2 = surv2 >= 70
    ? `−2% cobriria ${surv2}% dos dips (mediana −${median}%) — adequado`
    : `−2% cobriria só ${surv2}% dos dips — mediana −${median}%, P75 −${p75}%`;
  notes.fixed_5 = `−5% cobriria ${surv5}% dos episódios históricos`;
  notes.hist    = `P75 −${p75}% baseado em ${hist.episodeCount} quedas RSI<${hist.rsiBuy}`;

  let recommended;
  if (hist.episodeCount >= 3 && Math.abs(p75 - 2) > 1.5 && surv2 < 65) {
    recommended = 'hist';
  } else if (surv2 >= 70 && median <= 2.5) {
    recommended = 'fixed_2';
  } else if (surv5 >= 60 && p75 > 4) {
    recommended = 'fixed_5';
  } else if (hist.episodeCount >= 3) {
    recommended = 'hist';
  } else if (ma?.ok) {
    recommended = 'ma';
  } else {
    recommended = fixed5?.ok ? 'fixed_5' : 'fixed_2';
  }

  if (ma?.ok) {
    notes.ma = `Stop MA em −${ma.stopPct}% (piso adaptativo)`;
  }

  return {
    recommended,
    notes,
    survival2Pct: surv2,
    survival5Pct: surv5,
    fixed2Fits:   surv2 >= 65,
  };
}

/** @deprecated use compareStopLossOptions */
function pickRecommendedStop(opts) {
  return compareStopLossOptions(opts).recommended;
}

async function computeStopSuggestions(adapter, maFilters, rsiPeriod, rsiBuy, referencePrice) {
  const { DEFAULT_OPTS } = require('./suggest5mRsi');
  const candles5m = await adapter.fetchCandles(DEFAULT_OPTS.candleLimit, '5m');
  const hist   = historicalStopLoss(candles5m, rsiPeriod, rsiBuy, referencePrice);
  const ma     = await maStopLoss(adapter, maFilters, referencePrice);
  const fixed2 = fixedStopLoss(referencePrice, 2);
  const fixed5 = fixedStopLoss(referencePrice, 5);
  const stopCompare = compareStopLossOptions({ hist, ma, fixed2, fixed5 });
  const recommended = stopCompare.recommended;
  return { hist, ma, fixed2, fixed5, recommended, stopCompare };
}

module.exports = {
  fixedStopLoss,
  historicalStopLoss,
  collectHistEpisodes,
  maStopLoss,
  maStopFromCandles,
  compareStopLossOptions,
  pickRecommendedStop,
  computeStopSuggestions,
};
