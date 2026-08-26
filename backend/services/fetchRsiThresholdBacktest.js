const router = require('express').Router();
const analyseRsiThresholdBacktest = require('../utils/analyseRsiThresholdBacktest');
const mcFavoritesStatsCache = require('../cache/mcFavoritesStatsCache');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');
const { loadGlobalConfigBody } = require('../bot/rsi-momentum/strategyPresets');
const { sbReq } = require('../bot/shared/supabaseRest');

const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';

// GET /services/rsi-threshold-backtest?symbol=BTCUSDT&interval=15m&rsiThreshold=70
//     &pullbackPct=-2&targetPct=5&stopLossPct=5&positionSizeUsd=40
//     &bandWidthEnabled=1&bandWidthInterval=5m&bandWidthMinPct=2
//     &prevDayCloudEnabled=1&prevDayCloudMaxPct=70&prevDayCloudInterval=1d&prevDayCloudCandleCount=1
//     &minVolumeUsdt=1000000&excludeOpenExits=1
//     &prevCandleStopEnabled=1
//     &adxFilterEnabled=1&adxFilterInterval=1h&adxFilterMinAdx=25
//     &macdFilterEnabled=1&macdFilterInterval=1h
router.get('/rsi-threshold-backtest', async (req, res) => {
    const {
        symbol, interval, source, candleCount, lookbackHours,
        rsiThreshold, pullbackPct, targetPct, stopLossPct, positionSizeUsd,
        bandWidthEnabled, bandWidthInterval, bandWidthPeriod, bandWidthStdDev,
        bandWidthLookback, bandWidthMinPct,
        prevDayCloudEnabled, prevDayCloudMaxPct, prevDayCloudInterval, prevDayCloudCandleCount,
        minVolumeUsdt, excludeOpenExits,
        prevCandleStopEnabled,
        adxFilterEnabled, adxFilterInterval, adxFilterMinAdx,
        macdFilterEnabled, macdFilterInterval,
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
        prevDayCloud: prevDayCloudEnabled === '1' ? {
            enabled: true,
            maxPct:  prevDayCloudMaxPct ? parseFloat(prevDayCloudMaxPct) : 100,
            interval: prevDayCloudInterval ?? '4h',
            candleCount: prevDayCloudCandleCount ? parseInt(prevDayCloudCandleCount, 10) : 3,
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
