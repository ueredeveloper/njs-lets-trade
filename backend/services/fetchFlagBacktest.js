const router = require('express').Router();
const { analyseFlagBacktest } = require('../utils/analyseFlagBacktest');
const { saveFlagStudy, listFlagStudies, resolveFlagStudy } = require('../utils/flagStudyStore');

// GET /services/flag-backtest?interval=4h&candleCount=3000
//     [&symbol=BTCUSDT&source=gate]   (sem symbol = TODO o mercado USDT da Binance)
//     &minVolumeUsdt=5000000&includeGateFavorites=1
//     &directions=bull,bear&entryModes=close,nextOpen,retest&retestCandles=6
//     &stopMode=flag|channel|pct&stopPct=5&targetFrac=1&maxHoldCandles=30
//     &feePct=0.1&slippagePct=0.05&positionSizeUsd=40
//     &minPoleGainPct=6&maxPoleBars=12&maxRetracePct=0.5&minFlagBars=4&maxFlagBars=20&volRatioMax=1&onlyTight=0
//
// Backtest de bandeiras de alta/baixa — ver backend/utils/analyseFlagBacktest.js.
// Cada busca grava o estudo COMPLETO em backend/data/flag-studies/ (ver flagStudyStore.js) e a
// resposta traz `studyFile` (null se não gravou) — baixar em GET /services/flag-backtest/studies/:file.
router.get('/flag-backtest', async (req, res) => {
    const q = req.query;
    try {
        const result = await analyseFlagBacktest({
            collectStudy: true,
            symbol: q.symbol || null,
            source: q.source || null,
            interval: q.interval,
            candleCount: q.candleCount,
            positionSizeUsd: q.positionSizeUsd,
            minVolumeUsdt: q.minVolumeUsdt ? parseFloat(q.minVolumeUsdt) : 0,
            includeGateFavorites: q.includeGateFavorites === '1',
            directions: q.directions,
            entryModes: q.entryModes,
            retestCandles: q.retestCandles,
            stopMode: q.stopMode,
            stopPct: q.stopPct,
            targetFrac: q.targetFrac,
            maxHoldCandles: q.maxHoldCandles,
            costs: { feePct: q.feePct, slippagePct: q.slippagePct },
            pattern: {
                minPoleGainPct: q.minPoleGainPct,
                maxPoleBars: q.maxPoleBars,
                maxRetracePct: q.maxRetracePct,
                minFlagBars: q.minFlagBars,
                maxFlagBars: q.maxFlagBars,
                volRatioMax: q.volRatioMax,
                onlyTight: q.onlyTight,
            },
        });
        const studyFile = saveFlagStudy(result);
        delete result.study;
        res.json({ ...result, studyFile });
    } catch (err) {
        console.error('[flag-backtest]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /services/flag-backtest/studies — lista os estudos gravados (mais recente primeiro).
router.get('/flag-backtest/studies', (req, res) => {
    res.json(listFlagStudies());
});

// GET /services/flag-backtest/studies/:file — baixa um estudo (só nomes da própria pasta).
router.get('/flag-backtest/studies/:file', (req, res) => {
    const full = resolveFlagStudy(req.params.file);
    if (!full) return res.status(404).json({ error: 'Estudo não encontrado' });
    res.download(full, req.params.file);
});

module.exports = router;
