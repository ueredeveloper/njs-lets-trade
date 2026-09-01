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
      pullback: { enabled: false, belowPct: 0.5 },
      earlyConfirm: { enabled: true, interval: '5m', rsiThreshold: 70 },
      limitWaitCandles: 20,
      reentryCooldownCandles: 3,
      bandWidth: { enabled: true, interval: '5m', period: 20, stdDev: 2, lookback: 300, minPct: 1.5 },
      rsi5mFilter: { enabled: true, threshold: 70 },
      spikeGuard: { enabled: false, maxMovePct: 5 },
      macdFilter: { enabled: true, interval: '1h' },
      higherRsiFilter: { enabled: true, minRsi: 60 },
      supportResistance: {
        enabled: true, interval: '4h', candleCount: 50,
        entrySupportRank: 1, exitResistanceRank: 3, entryMaxPct: 5,
      },
    },
    exit: {
      targetMode: 'off',
      restingBracket: { enabled: true, targetPct: 10 },
      trailingTarget: { coinStepPct: 3, stepPct: 3 },
      trailingStop: {
        enabled: false, mode: 'continuous', startPct: 5, coinStepPct: 3, stopStepPct: 2,
        pivotPct: 1, aCoinStepPct: 3, aStopStepPct: 2.5, bCoinStepPct: 3, bStopStepPct: 1,
        pivotGainPct: 5, wNearPct: 4, wFarPct: 9, atrMult: 2, atrMaxPct: 12,
      },
      hardTakeProfit: { enabled: true, pct: 15 },
      reinforceOnStop: { enabled: true, addDropPct: 10, exitRisePct: 15, buyUsd: 40 },
    },
    stopLoss: { enabled: true, maxLossPct: 10 },
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
