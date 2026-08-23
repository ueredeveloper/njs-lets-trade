const router = require('express').Router();
const analyseRsiThresholdBacktestMarket = require('../utils/analyseRsiThresholdBacktestMarket');

// GET /services/rsi-threshold-backtest-market?interval=15m&rsiThreshold=70
//     &pullbackPct=-2&targetPct=5&stopLossPct=5&positionSizeUsd=40&lookbackHours=6
//     &bandWidthEnabled=1&bandWidthInterval=5m&bandWidthMinPct=2
//
// Mesmo cálculo de /rsi-threshold-backtest, mas rodado em TODOS os pares USDT ativos da
// Binance de uma vez (sem `symbol`) — ver backend/utils/analyseRsiThresholdBacktestMarket.js.
router.get('/rsi-threshold-backtest-market', async (req, res) => {
    const {
        interval, source, candleCount, lookbackHours, maxRows,
        rsiThreshold, pullbackPct, targetPct, stopLossPct, positionSizeUsd,
        bandWidthEnabled, bandWidthInterval, bandWidthPeriod, bandWidthStdDev,
        bandWidthLookback, bandWidthMinPct,
    } = req.query;

    if (!interval) {
        return res.status(400).json({ error: 'Parâmetro obrigatório: interval' });
    }

    const options = {
        interval,
        rsiThreshold:    rsiThreshold    != null ? parseFloat(rsiThreshold)    : 70,
        pullbackPct:     pullbackPct     != null ? parseFloat(pullbackPct)     : 0,
        targetPct:       targetPct       != null ? parseFloat(targetPct)      : 5,
        stopLossPct:     stopLossPct     != null ? parseFloat(stopLossPct)    : 5,
        positionSizeUsd: positionSizeUsd != null ? parseFloat(positionSizeUsd) : 40,
        source:          source ?? null,
        candleCount:     candleCount ? parseInt(candleCount, 10) : undefined,
        lookbackHours:   lookbackHours != null ? parseFloat(lookbackHours) : 0,
        maxRows:         maxRows ? parseInt(maxRows, 10) : undefined,
        bandWidth: bandWidthEnabled === '1' ? {
            enabled:  true,
            interval: bandWidthInterval ?? '5m',
            period:   bandWidthPeriod   ? parseInt(bandWidthPeriod, 10)   : 20,
            stdDev:   bandWidthStdDev   ? parseFloat(bandWidthStdDev)     : 2,
            lookback: bandWidthLookback ? parseInt(bandWidthLookback, 10) : 300,
            minPct:   bandWidthMinPct   ? parseFloat(bandWidthMinPct)     : 2,
        } : null,
    };

    try {
        const value = await analyseRsiThresholdBacktestMarket(options);
        res.json(value);
    } catch (err) {
        console.error('[rsi-threshold-backtest-market]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
