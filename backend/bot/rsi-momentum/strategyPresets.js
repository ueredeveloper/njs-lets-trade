'use strict';

const { normalizeRsiMomentumConfig, toEngineConfig } = require('./tradeConfigSchema');

const STRATEGY_IDS = ['rsi-momentum'];

const PRESET_BODIES = {
  'rsi-momentum': {
    label: 'RSI Momentum',
    kind: 'rsi_momentum',
    entry: {
      enabled: true,
      interval: '15m',
      rsiThreshold: 69,
      priorRsiFilter: { enabled: true, count: 3 },
      pullback: { enabled: true, belowPct: 0.5 },
      limitWaitCandles: 20,
      reentryCooldownCandles: 3,
      bandWidth: { enabled: true, interval: '5m', period: 20, stdDev: 2, lookback: 300, minPct: 2 },
    },
    exit: { restingBracket: { enabled: true, targetPct: 5 } },
    stopLoss: { enabled: true, maxLossPct: 5 },
    polling: { pollMs: 60_000, fastPollMs: 20_000 },
    volume: { minVolumeUsdt: 1_000_000 },
    entryCooldownHours: 0,
  },
};

function isRsiMomentumStrategy(id) {
  return STRATEGY_IDS.includes(id);
}

function normalizeStrategyId(id) {
  return STRATEGY_IDS.includes(id) ? id : 'rsi-momentum';
}

function getStrategyPresetBody(strategyId) {
  return PRESET_BODIES[normalizeStrategyId(strategyId)] ?? PRESET_BODIES['rsi-momentum'];
}

/**
 * Config global do RSI Momentum editável em Configurações → RSI Momentum no painel (ver
 * rsi_momentum_global_config, backend/services/supabaseService.js). Relida do banco a cada
 * ciclo do scanner (ver marketScanner.js#scanMarketOnce) e a cada novo sinal — mudanças salvas
 * no painel valem sem precisar reiniciar o bot. Sem linha salva ainda (usuário nunca abriu o
 * formulário), cai no preset estático de PRESET_BODIES.
 */
async function loadGlobalConfigBody(sbReq, userId) {
  let rows;
  try {
    rows = await sbReq('GET', 'rsi_momentum_global_config', null, `?user_id=eq.${userId}&limit=1`);
  } catch {
    return getStrategyPresetBody('rsi-momentum');
  }
  const row = rows?.[0];
  if (!row?.trade_config) return getStrategyPresetBody('rsi-momentum');
  return normalizeRsiMomentumConfig(row.trade_config);
}

function resolveConfigBody(row) {
  if (row?.trade_config?.kind) return row.trade_config;
  const sid = row?.strategy_id;
  if (!isRsiMomentumStrategy(sid)) return null;
  return getStrategyPresetBody(sid);
}

function buildTradeConfig(body) {
  return toEngineConfig(normalizeRsiMomentumConfig(body));
}

module.exports = {
  STRATEGY_IDS,
  PRESET_BODIES,
  isRsiMomentumStrategy,
  normalizeStrategyId,
  getStrategyPresetBody,
  loadGlobalConfigBody,
  resolveConfigBody,
  buildTradeConfig,
};
