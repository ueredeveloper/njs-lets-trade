const router = require('express').Router();
const analyseBollingerBandRecovery = require('../utils/analyseBollingerBandRecovery');
const mcFavoritesStatsCache = require('../cache/mcFavoritesStatsCache');
const { intervalMs } = require('../bot/ma-cross/strategyEngine');

// GET /services/bollinger-band-recovery?symbol=BTCUSDT&interval=4h&period=20&stdDev=2&source=gate&medianTrendFilter=1&medianTrendLookback=10&pullbackPct=5&candleCount=1000&lookback=300&permH1=1&permM30=1&permM15=0
router.get('/bollinger-band-recovery', async (req, res) => {
    const { symbol, interval = '4h', period, stdDev, source, medianTrendFilter, medianTrendLookback, pullbackPct, candleCount, lookback, permH1, permM30, permM15 } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });

    const sym = symbol.toUpperCase();
    const truthy = (v) => v === '1' || v === 'true';
    const options = {
        interval,
        period: period ? parseInt(period) : 20,
        stdDev: stdDev ? parseFloat(stdDev) : 2,
        source: source ?? null,
        medianTrendFilter: medianTrendFilter === '1' || medianTrendFilter === 'true',
        medianTrendLookback: medianTrendLookback ? parseInt(medianTrendLookback) : 10,
        pullbackPct: pullbackPct ? Math.max(0, parseFloat(pullbackPct)) : 0,
        candleCount: candleCount ? Math.min(3000, Math.max(100, parseInt(candleCount))) : 300,
        // 0 = desligado (usa todo o candleCount pra buscar ciclos, comportamento padrão) — ver
        // analyseBollingerBandRecovery.js. Mesmos valores fixos oferecidos pela coluna "Larg".
        lookback: lookback ? Math.max(0, parseInt(lookback)) : 0,
        // Filtro PERM (nuvem EMA9×EMA21) na aba Estatísticas — 3 níveis independentes (1h/30m/15m),
        // TODOS os habilitados precisam concordar (ver analyseBollingerBandRecovery.js). Diferente
        // do bot ao vivo (cascata pra 1 único intervalo configurado).
        permFilter: {
            h1: truthy(permH1),
            m30: truthy(permM30),
            m15: truthy(permM15),
        },
    };
    const permKey = ['h1', 'm30', 'm15'].filter(k => options.permFilter[k]).join('+') || 'off';
    const cacheKey = `bb|${sym}|${options.interval}|${options.period}|${options.stdDev}|${options.source ?? 'binance'}|${options.medianTrendFilter ? `mt${options.medianTrendLookback}` : 'nomt'}|pb${options.pullbackPct}|c${options.candleCount}|lb${options.lookback}|perm${permKey}`;

    try {
        const { value, cache } = await mcFavoritesStatsCache.getOrCompute(
            sym, cacheKey, intervalMs(options.interval),
            () => analyseBollingerBandRecovery(sym, options),
        );
        res.json({ ...value, cache });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
