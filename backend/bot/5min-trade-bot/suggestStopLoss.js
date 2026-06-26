'use strict';

/**
 * Sugestões de stop loss para o 5min-trade-bot.
 *
 * historicalStopLoss : analisa episódios RSI < rsiBuy nos candles 5m
 *                      e retorna o P75 da queda máxima (= nível de stop sugerido).
 * maStopLoss         : usa a MA50 configurada + dip adaptativo do histórico.
 *                      Stop = piso_adaptativo * 0.98  (2% abaixo do piso).
 */

const ti = require('technicalindicators');
const { normalizeMaFilters, suggestMaTolerance } = require('./maFilter');

const MAX_DROP_PCT = 25; // ignora quedas > 25% (outliers / delisting)

/**
 * @param {object[]} candles   candles 5m (quanto mais, melhor)
 * @param {number}   rsiPeriod
 * @param {number}   rsiBuy    limiar de compra (ex: 30)
 * @param {number}   currentPrice
 * @returns {{ ok, stopPrice?, stopPct?, avgDropPct?, episodeCount?, reason? }}
 */
function historicalStopLoss(candles, rsiPeriod, rsiBuy, currentPrice) {
  if (!candles?.length || candles.length < rsiPeriod + 10) {
    return { ok: false, reason: 'dados_insuficientes' };
  }

  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period: rsiPeriod });

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
      // episódio termina quando RSI recupera (histerese +5)
      if (rsi >= rsiBuy + 5) {
        const dropPct = entryClose > 0 ? (entryClose - minClose) / entryClose * 100 : 0;
        if (dropPct >= 0 && dropPct <= MAX_DROP_PCT) {
          episodes.push(parseFloat(dropPct.toFixed(2)));
        }
        inDip = false;
      }
    }
  }

  if (episodes.length < 2) {
    return { ok: false, reason: 'poucos_episodios', episodeCount: episodes.length };
  }

  const sorted = [...episodes].sort((a, b) => a - b);
  const p75    = sorted[Math.min(Math.floor(sorted.length * 0.75), sorted.length - 1)];
  const avg    = sorted.reduce((s, v) => s + v, 0) / sorted.length;

  return {
    ok:           true,
    stopPrice:    parseFloat((currentPrice * (1 - p75 / 100)).toFixed(8)),
    stopPct:      parseFloat(p75.toFixed(2)),
    avgDropPct:   parseFloat(avg.toFixed(2)),
    episodeCount: episodes.length,
  };
}

/**
 * Stop pela MA50 configurada em ma_filters: 2% abaixo do piso adaptativo.
 *
 * piso_adaptativo = MA50 * (1 - dipPct/100)
 * stop = piso_adaptativo * 0.98
 *
 * @returns {{ ok, stopPrice?, stopPct?, maValue?, adaptiveFloor?, adaptiveDipPct?, label?, reason? }}
 */
async function maStopLoss(adapter, maFilters, currentPrice) {
  const cfg = normalizeMaFilters(maFilters);
  if (!cfg.enabled) return { ok: false, reason: 'ma_desabilitado' };

  const f = cfg.filters.find(fi => fi.enabled && fi.mode === 'above');
  if (!f) return { ok: false, reason: 'sem_filtro_above' };

  let candles;
  try {
    candles = await adapter.fetchCandles(f.period + 500, f.interval);
  } catch {
    return { ok: false, reason: 'erro_candles' };
  }
  if (!candles?.length || candles.length < f.period) {
    return { ok: false, reason: 'dados_insuficientes' };
  }

  const sug = suggestMaTolerance(candles, f.period, f.interval, {
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
    label:          `MA${f.period}(${f.interval})`,
  };
}

/**
 * Computa ambas as sugestões. Busca 500 candles 5m (histórico) + candles do intervalo MA.
 */
async function computeStopSuggestions(adapter, maFilters, rsiPeriod, rsiBuy, currentPrice) {
  const candles5m = await adapter.fetchCandles(500, '5m');
  const hist = historicalStopLoss(candles5m, rsiPeriod, rsiBuy, currentPrice);
  const ma   = await maStopLoss(adapter, maFilters, currentPrice);
  return { hist, ma };
}

module.exports = { historicalStopLoss, maStopLoss, computeStopSuggestions };
