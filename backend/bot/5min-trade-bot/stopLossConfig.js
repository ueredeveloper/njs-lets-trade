'use strict';

const STOP_LOSS_TYPES = ['fixed_2', 'fixed_5', 'hist', 'ma'];

const STOP_LOSS_LABELS = {
  fixed_2: 'Fixo −2% da entrada',
  fixed_5: 'Fixo −5% da entrada',
  hist:    'Histórico RSI (P75)',
  ma:      'MA −2% do piso adaptativo',
};

function normalizeStopLoss(raw, { required = false } = {}) {
  if (!raw || typeof raw !== 'object') {
    if (required) return null;
    return { types: [] };
  }
  let types = [];
  if (Array.isArray(raw.types)) {
    types = raw.types.filter(t => STOP_LOSS_TYPES.includes(t));
  } else if (STOP_LOSS_TYPES.includes(raw.type)) {
    types = [raw.type];
  }
  const unique = [...new Set(types)];
  if (required && !unique.length) return null;
  return { types: unique };
}

function isActiveStopLoss(stopLoss) {
  const types = normalizeStopLoss(stopLoss).types;
  return types.length > 0;
}

function stopLossTypes(stopLoss) {
  return normalizeStopLoss(stopLoss).types;
}

function stopLossLabel(stopLoss) {
  const types = stopLossTypes(stopLoss);
  if (!types.length) return 'nenhum';
  return types.map(t => STOP_LOSS_LABELS[t] ?? t).join(' + ');
}

function fixedStopPct(type) {
  if (type === 'fixed_2') return 2;
  if (type === 'fixed_5') return 5;
  return null;
}

module.exports = {
  STOP_LOSS_TYPES,
  STOP_LOSS_LABELS,
  normalizeStopLoss,
  isActiveStopLoss,
  stopLossTypes,
  stopLossLabel,
  fixedStopPct,
};
