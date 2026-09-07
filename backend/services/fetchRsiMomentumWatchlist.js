'use strict';

/**
 * GET /services/rsi-momentum-watchlist
 *
 * Lista as moedas mais PRÓXIMAS de disparar o sinal do bot RSI Momentum. Dois formulários em
 * Analisar Indicadores ("Momentum RSI · Trade Geral" / "· Trade Exclusivo"):
 *   - scope=geral     → config global ativa (rsi_momentum_global_config — a que o scanner usa)
 *   - scope=exclusivo → config do bot curado da moeda `symbol` (rsi_multi_bot_state.curated=true)
 * Overrides opcionais na query (tradeInterval / srInterval / srCandleCount / rsiSignal) aplicam
 * um patch no body antes de normalizar — a varredura roda com a config ajustada.
 *
 * Pra cada par USDT ativo acima do volume mínimo: roda evaluateEntryReadiness (todos os filtros
 * SEM curto-circuito) e devolve o RSI atual + distância até o limiar + status de cada filtro.
 * Ordenado da mais pronta (todos os filtros OK, RSI colado no limiar e subindo) pra menos pronta.
 *
 * Cache em memória, TTL 45s (a varredura é cara — ~200-300 pares × candles): DOIS slots fixos,
 * `geral` e `exclusivo`, cada um chaveado pela assinatura dos overrides efetivos. Não persiste.
 */

const router = require('express').Router();
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { fetchBinanceCandles } = require('../bot/prices');
const { getRequiredSpecs, evaluateEntryReadiness } = require('../bot/rsi-momentum/strategyEngine');
const { loadGlobalConfigBody, loadCuratedConfigBody } = require('../bot/rsi-momentum/strategyPresets');
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

const SR_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d']);
const TRADE_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d']);

// Dois slots fixos de cache — um por formulário. Cada slot guarda a assinatura (`key`) dos
// overrides com que o `payload` foi calculado; overrides diferentes recomputam e sobrescrevem o
// slot. `computing`/`computingKey` deduplicam requisições concorrentes da MESMA assinatura.
const slots = {
    geral:     { at: 0, key: null, payload: null, computing: null, computingKey: null },
    exclusivo: { at: 0, key: null, payload: null, computing: null, computingKey: null },
};

/** Extrai/valida os overrides da query. Valores ausentes ou inválidos viram undefined (usa o da config). */
function parseOverrides(q) {
    const o = {};
    if (q.tradeInterval && TRADE_INTERVALS.has(String(q.tradeInterval))) o.tradeInterval = String(q.tradeInterval);
    if (q.srInterval && SR_INTERVALS.has(String(q.srInterval))) o.srInterval = String(q.srInterval);
    const cc = Number(q.srCandleCount);
    if (Number.isFinite(cc) && cc >= 10 && cc <= 500) o.srCandleCount = Math.round(cc);
    const rs = Number(q.rsiSignal);
    if (Number.isFinite(rs) && rs >= 30 && rs <= 95) o.rsiSignal = rs;
    return o;
}

/** Aplica os overrides numa CÓPIA do body (loadGlobalConfigBody pode devolver o preset compartilhado
 *  de PRESET_BODIES — nunca mutar in-place) antes de normalizeRsiMomentumConfig. */
function applyOverrides(rawBody, ov) {
    const body = JSON.parse(JSON.stringify(rawBody ?? {}));
    if (!body.entry) return body;
    if (ov.tradeInterval) body.entry.interval = ov.tradeInterval;
    if (ov.rsiSignal != null) body.entry.rsiThreshold = ov.rsiSignal;
    const sr = body.entry.supportResistance;
    if (sr && typeof sr === 'object') {
        if (ov.srInterval) sr.interval = ov.srInterval;
        if (ov.srCandleCount != null) sr.candleCount = ov.srCandleCount;
    }
    return body;
}

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

async function compute({ scope = 'geral', symbol = null, overrides = {} } = {}) {
    const rawBody = scope === 'exclusivo'
        ? await loadCuratedConfigBody(sbReq, DEFAULT_USER_ID, symbol)
        : await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID);
    const body = normalizeRsiMomentumConfig(applyOverrides(rawBody, overrides));
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
        scope: scope === 'exclusivo' ? 'exclusivo' : 'geral',
        curatedSymbol: scope === 'exclusivo' ? String(symbol ?? '').toUpperCase() : null,
        overrides,
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
    const scope = req.query.scope === 'exclusivo' ? 'exclusivo' : 'geral';
    const symbol = scope === 'exclusivo' ? String(req.query.symbol ?? '').trim().toUpperCase() : null;
    if (scope === 'exclusivo' && !symbol) {
        return res.status(400).json({ error: 'symbol obrigatório quando scope=exclusivo' });
    }
    const overrides = parseOverrides(req.query);
    const sig = JSON.stringify({ symbol, ...overrides });
    const slot = slots[scope];
    const now = Date.now();

    if (slot.payload && slot.key === sig && now - slot.at < TTL_MS && req.query.fresh !== '1') {
        return res.json({ ...slot.payload, cache: { hit: true, ageMs: now - slot.at, slot: scope } });
    }
    try {
        if (!slot.computing || slot.computingKey !== sig) {
            slot.computingKey = sig;
            slot.computing = compute({ scope, symbol, overrides })
                .finally(() => { if (slot.computingKey === sig) { slot.computing = null; slot.computingKey = null; } });
        }
        const payload = await slot.computing;
        // Grava payload + assinatura juntos: leitura futura desse `sig` sempre casa com o resultado certo.
        slot.at = Date.now();
        slot.payload = payload;
        slot.key = sig;
        res.json({ ...payload, cache: { hit: false, ageMs: 0, slot: scope } });
    } catch (err) {
        console.error('[rsi-momentum-watchlist]', err.message);
        const code = /obrigatório|não é um bot exclusivo/.test(err.message) ? 400 : 500;
        res.status(code).json({ error: err.message });
    }
});

module.exports = router;
