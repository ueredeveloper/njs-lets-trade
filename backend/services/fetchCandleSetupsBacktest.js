const router = require('express').Router();
const { analyseCandleSetupsBacktest } = require('../utils/analyseCandleSetupsBacktest');
const { SETUP_LABELS } = require('../bot/candle-setups/tradeConfigSchema');

// GET /services/candle-setups-backtest?interval=15m&setups=pfr,pontoContinuo,fechouForaDentro
//     [&symbol=BTCUSDT&source=gate]   (sem symbol = TODO o mercado USDT da Binance)
//     &candleCount=3000&positionSizeUsd=40&minVolumeUsdt=1000000&includeGateFavorites=1
//     &feePct=0.1&slippagePct=0.05
//     &entryOffsetPct=0.02&stopOffsetPct=0.02&validCandles=2&cancelOnStopBreak=1
//     &minRiskPct=1&maxRiskPct=3&maxHoldCandles=48&cooldownCandles=0
//     &pcTouchPeriod=21&pcTolerancePct=0&pcRequireHHHL=1&pcRequireCloseAbove=0
//     &pfrCloseAbove=prevClose|prevHigh
//     &ffStopMode=both|outside&ffFinalTarget=2R|middleBand|upperBand&ffRequireBullish=0
//
// Backtest dos "Setups Matadores para Day Trade" (só compra) — ver
// backend/utils/analyseCandleSetupsBacktest.js e backend/trading-books/leitura.md.
router.get('/candle-setups-backtest', async (req, res) => {
    const q = req.query;
    const f = (v) => (v != null && v !== '' ? parseFloat(v) : undefined);
    const setups = q.setups ? String(q.setups).split(',').map((s) => s.trim()).filter((s) => s in SETUP_LABELS) : undefined;

    const options = {
        symbol: q.symbol || null,
        source: q.source || null,
        interval: q.interval || undefined,
        candleCount: f(q.candleCount),
        positionSizeUsd: f(q.positionSizeUsd),
        maxRows: q.maxRows ? parseInt(q.maxRows, 10) : undefined,
        minVolumeUsdt: f(q.minVolumeUsdt),
        includeGateFavorites: q.includeGateFavorites === '1',
        setups,
        common: {
            entryOffsetPct: f(q.entryOffsetPct),
            stopOffsetPct: f(q.stopOffsetPct),
            validCandles: f(q.validCandles),
            cancelOnStopBreak: q.cancelOnStopBreak,
            minRiskPct: f(q.minRiskPct),
            maxRiskPct: f(q.maxRiskPct),
            maxHoldCandles: f(q.maxHoldCandles),
            cooldownCandles: f(q.cooldownCandles),
        },
        costs: { feePct: f(q.feePct), slippagePct: f(q.slippagePct) },
        params: {
            pontoContinuo: {
                touchPeriod: f(q.pcTouchPeriod),
                tolerancePct: f(q.pcTolerancePct),
                requireHHHL: q.pcRequireHHHL,
                requireCloseAbove: q.pcRequireCloseAbove,
            },
            pfr: { closeAbove: q.pfrCloseAbove },
            fechouForaDentro: { stopMode: q.ffStopMode, finalTarget: q.ffFinalTarget, requireBullish: q.ffRequireBullish },
        },
    };

    try {
        res.json(await analyseCandleSetupsBacktest(options));
    } catch (err) {
        console.error('[candle-setups-backtest]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
