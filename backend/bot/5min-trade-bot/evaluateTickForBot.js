'use strict';

const { normalizeMaFilters } = require('./maFilter');
const { normalizeRecoveryPattern, isActiveRecoveryPattern } = require('./recoveryPatternConfig');
const { evaluate5mTradeLive } = require('./evaluate5mTrade');

/**
 * Avalia um tick do bot (busca 1h se necessário) — mesma lógica do painel ao vivo.
 */
async function evaluateTickForBot(adapter, state, candles5m, livePrice = null) {
  const maCfg = normalizeMaFilters(state.ma_filters);
  const recoveryCfg = normalizeRecoveryPattern(state.recovery_pattern);
  const cMap = { '5m': candles5m };

  let price = livePrice;
  if (price == null && typeof adapter.fetchLastPrice === 'function') {
    try {
      price = await adapter.fetchLastPrice();
    } catch {
      price = null;
    }
  }

  const needs1h = maCfg.enabled || isActiveRecoveryPattern(recoveryCfg);
  if (needs1h) {
    const active = maCfg.enabled
      ? maCfg.filters.find(f => f.enabled && f.mode === 'above')
      : { period: 50, interval: '1h' };
    const period = active?.period ?? 50;
    const interval = active?.interval ?? '1h';
    cMap[interval] = await adapter.fetchCandles(period + 30, interval);
    if (interval !== '1h' && isActiveRecoveryPattern(recoveryCfg)) {
      cMap['1h'] = await adapter.fetchCandles(80, '1h');
    }
  }

  return evaluate5mTradeLive(cMap, {
    symbol: state.symbol,
    exchange: state.exchange ?? 'binance',
    rsiBuy: state.rsi_buy,
    rsiSell: state.rsi_sell,
    maFilters: state.ma_filters,
    recoveryPattern: state.recovery_pattern,
    entryPaths: state.entry_paths,
    entryPath: state.entry_path,
    sellScope: state.sell_scope,
    phase: state.phase,
    lastBuyTime: state.last_buy_time,
    buyCount: state.buy_count,
    livePrice: price,
  });
}

module.exports = { evaluateTickForBot };
