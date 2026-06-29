'use strict';

const { historicalStopLoss, maStopLoss, fixedStopLoss } = require('./suggestStopLoss');
const {
  isActiveStopLoss, stopLossLabel, stopLossTypes, fixedStopPct, STOP_LOSS_LABELS,
} = require('./stopLossConfig');

const RSI_PERIOD = 14;

async function computeOneStop(adapter, type, maFilters, rsiBuy, entryPrice, currentPrice) {
  const fixedPct = fixedStopPct(type);
  if (fixedPct != null) {
    const fixed = fixedStopLoss(entryPrice, fixedPct);
    if (!fixed.ok) return { ok: false, type, reason: fixed.reason };
    return {
      ok: true, type, label: STOP_LOSS_LABELS[type], stopPrice: fixed.stopPrice, stopPct: fixed.stopPct,
    };
  }
  if (type === 'hist') {
    const candles5m = await adapter.fetchCandles(500, '5m');
    const hist = historicalStopLoss(candles5m, RSI_PERIOD, rsiBuy, entryPrice);
    if (!hist.ok) return { ok: false, type: 'hist', reason: hist.reason };
    return {
      ok: true, type: 'hist',
      label: hist.label ? `${hist.label} P75` : STOP_LOSS_LABELS.hist,
      stopPrice: parseFloat((entryPrice * (1 - hist.stopPct / 100)).toFixed(8)),
      stopPct: hist.stopPct,
      episodeCount: hist.episodeCount,
    };
  }
  if (type === 'ma') {
    const ma = await maStopLoss(adapter, maFilters, currentPrice);
    if (!ma.ok) return { ok: false, type: 'ma', reason: ma.reason };
    return {
      ok: true, type: 'ma', label: ma.label,
      stopPrice: ma.stopPrice, stopPct: ma.stopPct, adaptiveFloor: ma.adaptiveFloor,
    };
  }
  return null;
}

/** Calcula todos os stops ativos; retorna o mais apertado (maior stopPrice). */
async function computeActiveStops(adapter, stopLoss, maFilters, rsiBuy, entryPrice, currentPrice) {
  if (!isActiveStopLoss(stopLoss)) return null;

  const types = stopLossTypes(stopLoss);
  const parts = [];
  for (const type of types) {
    const r = await computeOneStop(adapter, type, maFilters, rsiBuy, entryPrice, currentPrice);
    if (r) parts.push(r);
  }
  const okParts = parts.filter(p => p.ok);
  if (!okParts.length) {
    return { ok: false, parts, label: stopLossLabel(stopLoss) };
  }
  const tightest = okParts.reduce((best, p) => (p.stopPrice > best.stopPrice ? p : best), okParts[0]);
  return {
    ok: true,
    label: stopLossLabel(stopLoss),
    stopPrice: tightest.stopPrice,
    stopPct: tightest.stopPct,
    types,
    parts: okParts,
    triggeredBy: tightest.type,
  };
}

/** @deprecated use computeActiveStops */
async function computeActiveStop(adapter, stopLoss, maFilters, rsiBuy, entryPrice, currentPrice) {
  return computeActiveStops(adapter, stopLoss, maFilters, rsiBuy, entryPrice, currentPrice);
}

module.exports = { computeActiveStops, computeActiveStop, computeOneStop };
