/** Converte um `panelConfig` do RSI Momentum (mesmo shape usado pelo painel Estatísticas e
 *  devolvido por getRsiMomentumConfig/getRsiMomentumCuratedBot — ver rsiMomentumConfigToStatsPrefs
 *  no backend) no objeto `options` que fetchRsiThresholdBacktest/analyseRsiThresholdBacktest
 *  esperam. Extraído de StatisticsPanel.jsx pra ser reaproveitado pela caixa de análise do
 *  gráfico (previsão de trade dentro de um retângulo desenhado — ver CandlestickChart.jsx). */
export function buildRsiMomCommonOptions(p, candleCount, tradeInterval) {
  // 'srSupport' não é um modo "trailing" (preço ABSOLUTO da linha de suporte, fixo — não anda com
  // o pico) — igual 'fixed' nesse sentido, só que o valor vem do S/R em vez do stopLossPct %.
  const stopTrailing = !['fixed', 'srSupport'].includes(p.stopMode);
  return {
    rsiThreshold: p.rsiThreshold,
    pullbackPct: p.pullbackPct,
    targetPct: p.targetPct,
    stopLossPct: p.stopLossPct,
    targetMode: p.targetMode,
    hardTakeProfit: p.hardTakeProfitEnabled ? { enabled: true, pct: p.hardTakeProfitPct } : null,
    trailingStop: stopTrailing ? {
      enabled: true,
      mode: p.stopMode,
      startPct: p.stopLossPct,
      ...(p.stopMode === 'continuous' ? {
        coinStepPct: p.trailingCoinStepPct,
        stopStepPct: p.trailingStopStepPct,
      } : {}),
      ...(p.stopMode === 'twoPhase' ? {
        pivotPct: p.tsPivotPct,
        aCoinStepPct: p.tsPhaseACoinStep,
        aStopStepPct: p.tsPhaseAStopStep,
        bCoinStepPct: p.tsPhaseBCoinStep,
        bStopStepPct: p.tsPhaseBStopStep,
      } : {}),
      ...(p.stopMode === 'peakTrail' ? {
        pivotGainPct: p.tsPivotGainPct,
        wNearPct: p.tsWNearPct,
        wFarPct: p.tsWFarPct,
      } : {}),
      ...(p.stopMode === 'atrTrail' ? {
        pivotGainPct: p.tsPivotGainPct,
        wNearPct: p.tsWNearPct,
        atrMult: p.tsAtrMult,
        atrMaxPct: p.tsAtrMaxPct,
      } : {}),
    } : null,
    trailingTarget: p.targetMode === 'continuous' ? {
      coinStepPct: p.trailingTargetCoinStepPct,
      stepPct: p.trailingTargetStepPct,
    } : null,
    positionSizeUsd: p.positionSizeUsd,
    candleCount,
    lookbackHours: p.lookbackHours,
    bandWidth: p.bandWidthEnabled ? {
      enabled: true,
      interval: p.bandWidthInterval,
      minPct: p.bandWidthMinPct,
      lookback: p.bandWidthLookback,
    } : null,
    supportResistance: p.srEnabled ? {
      enabled: true,
      interval: p.srInterval,
      candleCount: p.srCandleCount,
      entrySupportRank: p.srEntrySupportRank,
      exitResistanceRank: p.srExitResistanceRank,
      entryMaxPct: p.srEntryMaxPct,
      stopEnabled: p.stopMode === 'srSupport',
      stopSupportRank: p.srStopSupportRank,
      // Stop S/R escalável (estudo) — só faz sentido com stopMode 'srSupport'. Ver
      // srStopTrailingEnabled/CoinStepPct/StopStepPct em RSI_MOM_DEFAULT_PREFS.
      stopTrailingEnabled: p.stopMode === 'srSupport' && !!p.srStopTrailingEnabled,
      stopTrailingCoinStepPct: p.srStopTrailingCoinStepPct,
      stopTrailingStopStepPct: p.srStopTrailingStopStepPct,
    } : null,
    minVolumeUsdt: p.minVolumeUsdt,
    excludeOpenExits: p.excludeOpenExits,
    adxFilter: p.adxFilterEnabled ? {
      enabled: true,
      interval: p.adxFilterInterval,
      minAdx: p.adxFilterMinAdx,
    } : null,
    macdFilter: p.macdFilterEnabled ? {
      enabled: true,
      interval: p.macdFilterInterval,
    } : null,
    higherRsiFilter: p.higherRsiFilterEnabled ? {
      enabled: true,
      minRsi: p.higherRsiFilterMinRsi,
    } : null,
    emaCrossFilter: p.emaCrossFilterEnabled ? {
      enabled: true,
      interval: p.emaCrossFilterInterval,
    } : null,
    rsi5mFilter: p.rsi5mFilterEnabled ? {
      enabled: true,
      threshold: p.rsi5mFilterThreshold,
    } : null,
    newHighFilter: p.newHighFilterEnabled ? {
      enabled: true,
      lookback: p.newHighFilterLookback,
      marginPct: p.newHighFilterMarginPct,
    } : null,
    reinforceOnStop: p.reinforceOnStopEnabled ? {
      enabled: true,
      mode: p.reinforceMode === 'rearm' ? 'rearm' : 'ladder',
      addDropPct: p.reinforceAddDropPct,
      exitRisePct: p.reinforceExitRisePct,
      rearmStopPct: p.reinforceRearmStopPct,
      rearmTargetPct: p.reinforceRearmTargetPct,
      waitCandles: p.reinforceWaitCandles,
      buyUsd: p.reinforceBuyUsd,
      reentryTrigger: p.reinforceReentryTrigger === 'rsiRecross' ? 'rsiRecross' : 'immediate',
      reentryRsi: {
        // '' (padrão) = mesmo intervalo do trade — ver RSI_MOM_DEFAULT_PREFS.
        interval: p.reinforceReentryInterval || tradeInterval,
        rsiThreshold: p.reinforceReentryRsi,
        confirmInterval: p.reinforceReentryConfirmInterval || '5m',
        rsi5mFilter: { enabled: !!p.reinforceReentryRsi5mEnabled, threshold: p.reinforceReentryRsi5mThreshold },
        earlyConfirm: { enabled: p.reinforceReentryEarlyConfirmEnabled !== false, rsiThreshold: p.reinforceReentryEarlyConfirmRsi },
      },
    } : null,
    entriesDayRange: p.entriesDayRangeMax != null ? { min: 2, max: p.entriesDayRangeMax } : null,
    includeGateFavorites: !!p.includeGateFavorites,
    avoidCorrelatedEntries: !!p.avoidCorrelatedEntries,
  };
}
