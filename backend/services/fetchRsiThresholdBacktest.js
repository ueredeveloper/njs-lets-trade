const router = require('express').Router();
const analyseRsiThresholdBacktest = require('../utils/analyseRsiThresholdBacktest');
const mcFavoritesStatsCache = require('../cache/mcFavoritesStatsCache');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');
const { loadGlobalConfigBody } = require('../bot/rsi-momentum/strategyPresets');
const { sbReq } = require('../bot/shared/supabaseRest');
const { parseTrailingStopQuery } = require('../utils/parseTrailingStopQuery');

const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';

// GET /services/rsi-threshold-backtest?symbol=BTCUSDT&interval=15m&rsiThreshold=70
//     &pullbackPct=-2&targetPct=5&stopLossPct=5&positionSizeUsd=40
//     &bandWidthEnabled=1&bandWidthInterval=5m&bandWidthMinPct=2
//     &minVolumeUsdt=1000000&excludeOpenExits=1
//     &prevCandleStopEnabled=1
//     &adxFilterEnabled=1&adxFilterInterval=1h&adxFilterMinAdx=25
//     &macdFilterEnabled=1&macdFilterInterval=1h
//     &higherRsiFilterEnabled=1&higherRsiFilterMinRsi=50   (RSI 1h mínimo — confirmação multi-timeframe)
//     &trailingStopEnabled=1&trailingStopMode=continuous&trailingStopStartPct=5&trailingStopCoinStepPct=1&trailingStopStopStepPct=1
//     &trailingStopMode=twoPhase&trailingStopPivotPct=1&trailingStopACoinStepPct=3&trailingStopAStopStepPct=2.5&trailingStopBCoinStepPct=3&trailingStopBStopStepPct=1
//     &trailingStopMode=peakTrail&trailingStopPivotGainPct=5&trailingStopWNearPct=4&trailingStopWFarPct=9
//     &trailingStopMode=atrTrail&trailingStopPivotGainPct=5&trailingStopWNearPct=4&trailingStopAtrMult=2&trailingStopAtrMaxPct=12
//     &targetMode=continuous&trailingTargetCoinStepPct=3&trailingTargetStepPct=3
router.get('/rsi-threshold-backtest', async (req, res) => {
    const {
        symbol, interval, source, candleCount, lookbackHours,
        rsiThreshold, pullbackPct, targetPct, stopLossPct, positionSizeUsd,
        bandWidthEnabled, bandWidthInterval, bandWidthPeriod, bandWidthStdDev,
        bandWidthLookback, bandWidthMinPct,
        srEnabled, srInterval, srCandleCount, srEntrySupportRank, srExitResistanceRank, srEntryMaxPct,
        minVolumeUsdt, excludeOpenExits,
        prevCandleStopEnabled,
        adxFilterEnabled, adxFilterInterval, adxFilterMinAdx,
        macdFilterEnabled, macdFilterInterval,
        higherRsiFilterEnabled, higherRsiFilterMinRsi,
        rsi5mFilterEnabled, rsi5mFilterThreshold,
        newHighFilterEnabled, newHighFilterLookback, newHighFilterMarginPct,
        hardTakeProfitEnabled, hardTakeProfitPct,
        reinforceOnStopEnabled, reinforceAddDropPct, reinforceExitRisePct, reinforceBuyUsd,
        targetMode, trailingTargetCoinStepPct, trailingTargetStepPct,
        entriesDayRangeMin, entriesDayRangeMax,
    } = req.query;

    if (!symbol || !interval) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: symbol, interval' });
    }

    // Mesma regra "não é repique de volatilidade" do bot ao vivo (entry.priorRsiFilter, ver
    // evaluateEntrySignal em backend/bot/rsi-momentum/strategyEngine.js) — lida da config GLOBAL
    // real pra estatística ficar fiel ao que o bot realmente exige, em vez de um valor fixo.
    const globalConfig = await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID);

    const options = {
        priorRsiFilter:  globalConfig?.entry?.priorRsiFilter ?? null,
        rsiThreshold:    rsiThreshold    != null ? parseFloat(rsiThreshold)    : 70,
        pullbackPct:     pullbackPct     != null ? parseFloat(pullbackPct)     : 0,
        targetPct:       targetPct       != null ? parseFloat(targetPct)      : 5,
        stopLossPct:     stopLossPct     != null ? parseFloat(stopLossPct)    : 5,
        positionSizeUsd: positionSizeUsd != null ? parseFloat(positionSizeUsd) : 40,
        source:          source ?? null,
        candleCount:     candleCount ? parseInt(candleCount, 10) : undefined,
        lookbackHours:   lookbackHours != null ? parseFloat(lookbackHours) : 0,
        bandWidth: bandWidthEnabled === '1' ? {
            enabled:  true,
            interval: bandWidthInterval ?? '5m',
            period:   bandWidthPeriod   ? parseInt(bandWidthPeriod, 10)   : 20,
            stdDev:   bandWidthStdDev   ? parseFloat(bandWidthStdDev)     : 2,
            lookback: bandWidthLookback ? parseInt(bandWidthLookback, 10) : 300,
            minPct:   bandWidthMinPct   ? parseFloat(bandWidthMinPct)     : 2,
        } : null,
        supportResistance: srEnabled === '1' ? {
            enabled: true,
            interval: srInterval ?? '4h',
            candleCount: srCandleCount ? parseInt(srCandleCount, 10) : 200,
            entrySupportRank: srEntrySupportRank ? parseInt(srEntrySupportRank, 10) : 1,
            exitResistanceRank: srExitResistanceRank ? parseInt(srExitResistanceRank, 10) : 1,
            entryMaxPct: srEntryMaxPct === 'adapt' ? 'adapt' : (srEntryMaxPct ? parseFloat(srEntryMaxPct) : 10),
        } : null,
        minVolumeUsdt:    minVolumeUsdt ? parseFloat(minVolumeUsdt) : 0,
        excludeOpenExits: excludeOpenExits === '1',
        prevCandleStop:   prevCandleStopEnabled === '1',
        adxFilter: adxFilterEnabled === '1' ? {
            enabled:  true,
            interval: adxFilterInterval ?? '1h',
            minAdx:   adxFilterMinAdx ? parseFloat(adxFilterMinAdx) : 25,
        } : null,
        macdFilter: macdFilterEnabled === '1' ? {
            enabled:  true,
            interval: macdFilterInterval ?? '1h',
        } : null,
        higherRsiFilter: higherRsiFilterEnabled === '1' ? {
            enabled: true,
            minRsi:  higherRsiFilterMinRsi ? parseFloat(higherRsiFilterMinRsi) : 50,
        } : null,
        rsi5mFilter: rsi5mFilterEnabled === '1' ? {
            enabled:   true,
            threshold: rsi5mFilterThreshold ? parseFloat(rsi5mFilterThreshold) : 70,
        } : null,
        newHighFilter: newHighFilterEnabled === '1' ? {
            enabled:   true,
            lookback:  newHighFilterLookback   ? parseInt(newHighFilterLookback, 10) : 20,
            marginPct: newHighFilterMarginPct != null ? parseFloat(newHighFilterMarginPct) : 2,
        } : null,
        hardTakeProfit: hardTakeProfitEnabled === '1' ? {
            enabled: true,
            pct:     hardTakeProfitPct ? parseFloat(hardTakeProfitPct) : 15,
        } : null,
        reinforceOnStop: reinforceOnStopEnabled === '1' ? {
            enabled:     true,
            addDropPct:  reinforceAddDropPct  ? parseFloat(reinforceAddDropPct)  : 10,
            exitRisePct: reinforceExitRisePct ? parseFloat(reinforceExitRisePct) : 15,
            buyUsd:      reinforceBuyUsd       ? parseFloat(reinforceBuyUsd)       : 40,
        } : null,
        trailingStop: parseTrailingStopQuery(req.query, stopLossPct != null ? parseFloat(stopLossPct) : null),
        targetMode: (targetMode === 'fixed' || targetMode === 'continuous' || targetMode === 'off') ? targetMode : 'fixed',
        trailingTarget: targetMode === 'continuous' ? {
            coinStepPct: trailingTargetCoinStepPct ? parseFloat(trailingTargetCoinStepPct) : 3,
            stepPct:     trailingTargetStepPct     ? parseFloat(trailingTargetStepPct)     : 3,
        } : null,
        entriesDayRange: entriesDayRangeMax != null ? {
            min: entriesDayRangeMin != null ? parseInt(entriesDayRangeMin, 10) : 2,
            max: parseInt(entriesDayRangeMax, 10),
        } : null,
    };

    const sym = symbol.toUpperCase();
    const cacheKey = `rsi-threshold|${sym}|${interval}|${JSON.stringify(options)}`;

    try {
        const { value, cache } = await mcFavoritesStatsCache.getOrCompute(
            sym, cacheKey, intervalMs(interval),
            () => analyseRsiThresholdBacktest(sym, interval, options),
        );
        res.json({ ...value, cache });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
