'use strict';

/**
 * GET /services/rsi-momentum-watchlist
 *
 * Lista as moedas mais PRÓXIMAS de disparar o sinal do bot RSI Momentum, aplicando a MESMA
 * config global ativa (rsi_momentum_global_config — a que o scanner usa). Pra cada par USDT
 * ativo acima do volume mínimo: roda evaluateEntryReadiness (todos os filtros SEM curto-circuito)
 * e devolve o RSI atual + distância até o limiar + status de cada filtro. Ordenado da mais pronta
 * (todos os filtros OK, RSI colado no limiar e subindo) pra menos pronta.
 *
 * Cache em memória, TTL 45s (a varredura é cara — ~200-300 pares × candles). Não persiste.
 */

const router = require('express').Router();
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { fetchBinanceCandles } = require('../bot/prices');
const { getRequiredSpecs, evaluateEntryReadiness } = require('../bot/rsi-momentum/strategyEngine');
const { loadGlobalConfigBody } = require('../bot/rsi-momentum/strategyPresets');
const { toEngineConfig, normalizeRsiMomentumConfig } = require('../bot/rsi-momentum/tradeConfigSchema');
const { getSymbolCategories } = require('../utils/assetCategories');
const getTickers = require('../binance/cachedTicker24hr');
const { sbReq } = require('../bot/shared/supabaseRest');

const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';
const CONCURRENCY = 15;
const TTL_MS = 45_000;
const MAX_ROWS = 60;
// Só entra na lista quem está "no páreo" pra CRUZAR o limiar de baixo pra cima: RSI de GAP_MAX
// pontos abaixo até GAP_ABOVE pontos acima. Bem acima do limiar = já passou do ponto de entrada
// (o bot precisa de um cruzamento fresco de baixo pra cima), não é "quase entrando".
const GAP_MAX = 12;
const GAP_ABOVE = 3;

let cache = { at: 0, payload: null, computing: null };

async function fetchCandleMap(symbol, specs) {
    const entries = await Promise.all(
        specs.map(async ({ interval, limit }) => [interval, await fetchBinanceCandles(symbol, limit, interval)]),
    );
    return Object.fromEntries(entries);
}

async function runWithConcurrency(items, worker, concurrency) {
    let idx = 0;
    const results = [];
    async function next() {
        while (idx < items.length) {
            const cur = idx++;
            results[cur] = await worker(items[cur]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
    return results;
}

/** "Score de prontidão" — quanto MENOR, mais perto de entrar. Ordena a lista.
 *  1) quem já cruzaria agora vem primeiro; 2) depois quem tem todos os filtros OK;
 *  3) depois pela distância do RSI ao limiar; 4) subindo/acelerando desempata. */
function readyScore(r) {
    if (r.crossed) return -1000 + r.gapToThreshold;
    const filterPenalty = (r.filtersTotal - r.filtersOk) * 100;
    const gap = Math.max(0, r.gapToThreshold);       // acima do limiar mas sem cruzar → gap 0
    const momentum = r.accelerating ? -1.5 : r.rising ? -0.5 : 1.5;
    return filterPenalty + gap + momentum;
}

function summarizeConfig(body) {
    const e = body.entry;
    return {
        interval: e.interval,
        rsiThreshold: e.rsiThreshold,
        minVolumeUsdt: Number(body.volume?.minVolumeUsdt ?? 0),
        filters: {
            bandWidth: e.bandWidth?.enabled ? { interval: e.bandWidth.interval, minPct: e.bandWidth.minPct } : null,
            rsi5m: e.rsi5mFilter?.enabled ? { threshold: e.rsi5mFilter.threshold } : null,
            macd: e.macdFilter?.enabled ? { interval: e.macdFilter.interval } : null,
            higherRsi: e.higherRsiFilter?.enabled ? { minRsi: e.higherRsiFilter.minRsi } : null,
            supportResistance: e.supportResistance?.enabled
                ? { interval: e.supportResistance.interval, entryMaxPct: e.supportResistance.entryMaxPct, entrySupportRank: e.supportResistance.entrySupportRank }
                : null,
            earlyConfirm: e.earlyConfirm?.enabled
                ? { interval: e.earlyConfirm.interval, rsiThreshold: Math.max(e.rsiThreshold, Number(e.earlyConfirm.rsiThreshold ?? e.rsiThreshold)) }
                : null,
        },
    };
}

async function compute() {
    const body = normalizeRsiMomentumConfig(await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID));
    const config = toEngineConfig(body);
    const specs = getRequiredSpecs(config);
    const minVolumeUsdt = Number(body.volume?.minVolumeUsdt ?? 0);

    const [{ list: allSymbols }, tickers] = await Promise.all([
        getActiveUsdtPairs(),
        getTickers().catch(() => null),
    ]);
    const volumeMap = new Map(Array.isArray(tickers) ? tickers.map((t) => [t.symbol, Number(t.quoteVolume)]) : []);

    let candidates = allSymbols.filter((s) => !getSymbolCategories(s).includes('stablecoins'));
    if (minVolumeUsdt > 0 && volumeMap.size) {
        candidates = candidates.filter((s) => (volumeMap.get(s) ?? 0) >= minVolumeUsdt);
    }

    const rows = [];
    await runWithConcurrency(candidates, async (symbol) => {
        let readiness;
        try {
            const cMap = await fetchCandleMap(symbol, specs);
            readiness = evaluateEntryReadiness(config, cMap);
        } catch {
            return;
        }
        if (!readiness) return;
        // Fora do páreo: nem cruzou, nem está na faixa de RSI perto do limiar.
        if (!readiness.crossed && (readiness.gapToThreshold > GAP_MAX || readiness.gapToThreshold < -GAP_ABOVE)) return;
        rows.push({
            symbol,
            volumeUsd: volumeMap.has(symbol) ? (Number(volumeMap.get(symbol)) || 0) : null,
            rsi: readiness.rsi,
            rsiPrev: readiness.rsiPrev,
            threshold: readiness.threshold,
            gapToThreshold: readiness.gapToThreshold,
            rising: readiness.rising,
            accelerating: readiness.accelerating,
            crossed: readiness.crossed,
            filtersOk: readiness.filtersOk,
            filtersTotal: readiness.filtersTotal,
            blockers: readiness.blockers,
            onlyMissingCross: readiness.onlyMissingCross,
            filters: readiness.filters.map((f) => ({ key: f.key, ok: f.ok, reason: f.reason })),
        });
    }, CONCURRENCY);

    rows.sort((a, b) => readyScore(a) - readyScore(b));

    return {
        config: summarizeConfig(body),
        entryEnabled: body.entry.enabled !== false,
        scannedAt: new Date().toISOString(),
        symbolsTotal: allSymbols.length,
        symbolsScanned: candidates.length,
        readyCount: rows.filter((r) => r.onlyMissingCross || r.crossed).length,
        coins: rows.slice(0, MAX_ROWS),
    };
}

router.get('/rsi-momentum-watchlist', async (req, res) => {
    const now = Date.now();
    if (cache.payload && now - cache.at < TTL_MS && req.query.fresh !== '1') {
        return res.json({ ...cache.payload, cache: { hit: true, ageMs: now - cache.at } });
    }
    try {
        if (!cache.computing) {
            cache.computing = compute().finally(() => { cache.computing = null; });
        }
        const payload = await cache.computing;
        cache = { at: Date.now(), payload, computing: null };
        res.json({ ...payload, cache: { hit: false, ageMs: 0 } });
    } catch (err) {
        console.error('[rsi-momentum-watchlist]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
