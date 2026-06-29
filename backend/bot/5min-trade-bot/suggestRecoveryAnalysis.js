'use strict';

/**
 * Análise para padrões 1h + % acima da MA50 + sugestões de stop loss.
 */

const { analyzeRecoveryPatterns } = require('./suggestRecoveryPattern');
const { suggestAbovePctFor5m } = require('./suggestRecoveryMaZone');
const { checkRecoveryPatternsLive } = require('./recoveryPattern');
const { buildExtensionAboveReport } = require('../amap/suggestExtensionAbovePct');
const { buildTradeConfig } = require('../amap/strategyEngine');
const {
  historicalStopLoss,
  fixedStopLoss,
  compareStopLossOptions,
  maStopFromCandles,
} = require('./suggestStopLoss');
const { resolveMaStopFilter } = require('./maFilter');
const { DEFAULT_OPTS } = require('./suggest5mRsi');

const RECOVERY_MA = { period: 50, interval: '1h' };
/** Mesmo histórico 5m do sweep RSI — stop histórico precisa de janela longa (ex.: ACTUSDT RSI<21). */
const CANDLES_5M  = DEFAULT_OPTS.candleLimit;

async function buildRecoverySuggestPayload(fetchCandles, exchange, symbol, rsiBuy, rsiSell, maCfg) {
  const candles5m = await fetchCandles(exchange, symbol, '5m', CANDLES_5M);
  let candles1h   = await fetchCandles(exchange, symbol, RECOVERY_MA.interval, RECOVERY_MA.period + 520);

  const currentPrice = candles5m.length ? candles5m[candles5m.length - 1].close : 0;
  const hist         = historicalStopLoss(candles5m, 14, rsiBuy, currentPrice);
  const fixed2       = fixedStopLoss(currentPrice, 2);
  const fixed5       = fixedStopLoss(currentPrice, 5);

  const maStopFilter = resolveMaStopFilter(maCfg);
  let maCandles      = maStopFilter.interval === '1h' ? candles1h : null;
  if (!maCandles) {
    maCandles = await fetchCandles(exchange, symbol, maStopFilter.interval, maStopFilter.period + 500);
  }
  const ma          = maStopFromCandles(maCandles, maStopFilter, currentPrice);
  const stopCompare = compareStopLossOptions({ hist, ma, fixed2, fixed5 });

  const recoveryAnalysis = analyzeRecoveryPatterns(candles5m, candles1h, rsiBuy, rsiSell);
  const localMaZone      = suggestAbovePctFor5m(candles5m, candles1h, maCfg, rsiBuy, rsiSell);

  let mtReport = { signalCount: 0 };
  try {
    mtReport = buildExtensionAboveReport(
      { '5m': candles5m, '1h': candles1h },
      buildTradeConfig({
        entryRsi: { interval: '5m', period: 14, operator: '<', value: rsiBuy },
        exitRsi:  { interval: '5m', period: 14, operator: '>', value: rsiSell },
        extension: {
          enabled:       true,
          maPeriod:      RECOVERY_MA.period,
          maInterval:    RECOVERY_MA.interval,
          abovePct:      localMaZone.suggestedAbovePct ?? 5,
          threeCandles:  true,
          fourCandles:   true,
          threeInterval: '1h',
          fourInterval:  '1h',
          confirmLogic:  'any',
        },
      }),
    );
  } catch {
    /* % acima MA é opcional — não bloquear stops */
  }

  const suggestedAbovePct = mtReport.suggestedAbovePct ?? localMaZone.suggestedAbovePct ?? 5;
  const maZone = {
    ok:               mtReport.signalCount > 0 || localMaZone.ok,
    suggestedAbovePct,
    maPeriod:         RECOVERY_MA.period,
    maInterval:       RECOVERY_MA.interval,
    signalCount:      mtReport.signalCount ?? localMaZone.signalCount ?? 0,
    medianStretchPct: mtReport.medianStretchPct ?? localMaZone.medianStretchPct,
    aboveNowPct:      mtReport.aboveNowPct ?? localMaZone.aboveNowPct,
    extendedNow:      mtReport.extendedNow ?? localMaZone.extendedNow,
    usedDefault:      mtReport.usedDefault,
    rsiBuy,
    description:
      `Sugerido +${suggestedAbovePct}% acima MA${RECOVERY_MA.period} ${RECOVERY_MA.interval} ` +
      `(Multi-Trade · ${mtReport.signalCount ?? 0} sinais RSI<${rsiBuy} 5m)`,
  };

  const candlePatterns = checkRecoveryPatternsLive(candles1h);

  return {
    symbol,
    exchange,
    rsiBuy,
    rsiSell,
    currentPrice,
    hist,
    fixed2,
    fixed5,
    ma,
    stopCompare,
    recommended: stopCompare.recommended,
    recoveryAnalysis,
    recoveryRecommended: recoveryAnalysis.recommended ?? null,
    maZone,
    candlePatterns,
  };
}

module.exports = { buildRecoverySuggestPayload, RECOVERY_MA, CANDLES_5M };