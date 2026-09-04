'use strict';

const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const analyseRsiThresholdBacktest = require('./analyseRsiThresholdBacktest');
const { countBaseVsEvolvedExits, computeCloudZoneStats, computeSupportResistanceZoneStats, computeRsi1hBreakdown, computeReinforceStats } = require('./analyseRsiThresholdBacktest');
const getTickers = require('../binance/cachedTicker24hr');
const { getGateFavoriteSymbols } = require('../gate/getGateFavoriteSymbols');
const { getAllGateCurrencies } = require('../gate/getAllGateCurrencies');
const { computeDailyEntryStats } = require('./dailyEntryStats');
const { computeAvgTradeDurationMs } = require('./tradeDurationStats');

const CONCURRENCY = 15;
const DEFAULT_MAX_ROWS = 300;

/** Faixas de volume 24h (quoteVolume USDT) pro breakdown "volume × resultado". */
const VOLUME_BUCKETS = [
    { label: '< 1M',       max: 1e6 },
    { label: '1M – 5M',    max: 5e6 },
    { label: '5M – 20M',   max: 20e6 },
    { label: '20M – 100M', max: 100e6 },
    { label: '≥ 100M',     max: Infinity },
];

/** Agrupa os trades preenchidos pela faixa de volume 24h da moeda e devolve win-rate / P&L médio
 *  / P&L total por faixa — pra ver se moeda com mais volume dá resultado melhor ou pior. */
function computeVolumeBreakdown(filledOccurrences, volumeMap) {
    const buckets = VOLUME_BUCKETS.map((b) => ({ ...b, list: [] }));
    for (const o of filledOccurrences) {
        const vol = Number(volumeMap.get(o.symbol)) || 0;
        (buckets.find((bk) => vol < bk.max) ?? buckets[buckets.length - 1]).list.push(o);
    }
    return buckets.map((b) => {
        const closed = b.list.filter((o) => o.outcome === 'target' || o.outcome === 'stop');
        const wins = closed.filter((o) => o.outcome === 'target').length;
        const stops = closed.length - wins;
        const pnlPctSum = b.list.reduce((s, o) => s + o.pnlPct, 0);
        const pnlUsdSum = b.list.reduce((s, o) => s + o.pnlUsd, 0);
        return {
            label: b.label,
            trades: b.list.length,
            wins,
            stops,
            winRatePct: closed.length ? parseFloat(((wins / closed.length) * 100).toFixed(1)) : null,
            avgPnlPct: b.list.length ? parseFloat((pnlPctSum / b.list.length).toFixed(2)) : null,
            totalPnlUsd: parseFloat(pnlUsdSum.toFixed(2)),
        };
    });
}

async function runWithConcurrency(items, worker, concurrency) {
    const results = [];
    let idx = 0;
    async function next() {
        while (idx < items.length) {
            const cur = idx++;
            results[cur] = await worker(items[cur]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
    return results;
}

/**
 * Roda analyseRsiThresholdBacktest (ver esse arquivo) em TODOS os pares USDT ativos da Binance,
 * em vez de um símbolo só — mesmos parâmetros de entrada/saída/filtro de largura de banda
 * aplicados a cada moeda. Cada ocorrência retornada carrega o campo `symbol` (de qual par veio)
 * — usado pela coluna "Par" da tabela e pelo clique que abre a moeda certa no gráfico.
 *
 * Falhas pontuais por símbolo (par sem candles suficientes, erro de rede pontual etc.) são
 * ignoradas silenciosamente — o resultado reflete os pares que puderam ser calculados.
 *
 * @param {object} options            Mesmas opções de analyseRsiThresholdBacktest, MENOS `symbol`.
 * @param {number} [options.maxRows=300] Máximo de ocorrências devolvidas na tabela (a mais
 *   recente primeiro) — os agregados (totais, P&L, taxa de acerto) sempre consideram TODAS as
 *   ocorrências encontradas, não só as retornadas.
 * @param {number} [options.minVolumeUsdt=0] Filtro de volume 24h (mesmo campo do bot ao vivo) —
 *   filtra a LISTA de símbolos ANTES de rodar o backtest em cada um (mais barato que deixar cada
 *   chamada individual se autobloquear), em vez de ser repassado a analyseRsiThresholdBacktest.
 *   Aplicado ao volume 24h da Binance nos pares Binance e ao volume 24h da Gate.io nos favoritos
 *   Gate (fontes diferentes, mesmo limite em USDT).
 * @param {boolean} [options.includeGateFavorites=false] Além dos pares USDT da Binance, roda
 *   também o backtest nos símbolos marcados como favoritos da Gate.io (tabela `favorites_gate` —
 *   mesma lista "Favoritos|Gate" do frontend), cada um com `source: 'gate'`. Símbolos que já
 *   existem na Binance NÃO são duplicados (a versão Binance prevalece). O filtro `minVolumeUsdt`
 *   também vale pra eles, aferido pelo volume 24h da própria Gate.io.
 */
async function analyseRsiThresholdBacktestMarket(options = {}) {
    const { interval, maxRows = DEFAULT_MAX_ROWS, minVolumeUsdt = 0, includeGateFavorites = false, ...perSymbolOptions } = options;

    const { list: allSymbols } = await getActiveUsdtPairs();

    let symbols = allSymbols;
    let symbolsBlockedByVolume = 0;
    // Volume 24h de cada moeda (quoteVolume USDT) — usado tanto pro filtro minVolumeUsdt quanto
    // pro breakdown "volume × resultado" no fim. Cache de /ticker/24hr; fail-open.
    let volumeMap = new Map();
    if (perSymbolOptions.source !== 'gate') {
        try {
            const tickers = await getTickers();
            volumeMap = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
        } catch { /* fail-open: sem dado de volume, filtro e breakdown ficam vazios */ }
    }
    if (Number(minVolumeUsdt) > 0 && volumeMap.size > 0) {
        const filtered = allSymbols.filter((sym) => (volumeMap.get(sym) ?? 0) >= Number(minVolumeUsdt));
        symbolsBlockedByVolume = allSymbols.length - filtered.length;
        symbols = filtered;
    }

    // Cada item da varredura carrega a corretora de origem. Binance = source do options (null por
    // padrão); favoritos Gate = 'gate' fixo.
    const workItems = symbols.map((symbol) => ({ symbol, source: perSymbolOptions.source ?? null }));

    // ── Favoritos Gate.io ────────────────────────────────────────────────────────────────────
    // Só os símbolos que o usuário marcou como favorito da Gate (não o mercado Gate inteiro).
    // Filtro de volume pelo volume 24h da PRÓPRIA Gate. Símbolo que também existe na Binance não
    // entra de novo aqui (já está em workItems como par Binance).
    let gateFavoritesTotal = 0;
    let gateFavoritesBlockedByVolume = 0;
    if (includeGateFavorites && perSymbolOptions.source !== 'gate') {
        try {
            const binanceSet = new Set(allSymbols);
            const favs = (await getGateFavoriteSymbols()).filter((sym) => !binanceSet.has(sym));
            gateFavoritesTotal = favs.length;
            let gateVol = new Map();
            try {
                const gc = await getAllGateCurrencies();
                gateVol = new Map(gc.map((c) => [c.symbol, Number(c.volume) || 0]));
            } catch { /* fail-open: sem volume Gate, não filtra e o breakdown ignora */ }
            let gateSymbols = favs;
            if (Number(minVolumeUsdt) > 0 && gateVol.size > 0) {
                gateSymbols = favs.filter((sym) => (gateVol.get(sym) ?? 0) >= Number(minVolumeUsdt));
                gateFavoritesBlockedByVolume = favs.length - gateSymbols.length;
            }
            for (const sym of gateSymbols) {
                if (gateVol.has(sym)) volumeMap.set(sym, gateVol.get(sym));
                workItems.push({ symbol: sym, source: 'gate' });
            }
        } catch (err) {
            console.warn('[rsi-threshold-backtest-market] favoritos Gate ignorados:', err.message);
        }
    }

    const perSymbolResults = await runWithConcurrency(workItems, async ({ symbol, source }) => {
        try {
            const result = await analyseRsiThresholdBacktest(symbol, interval, { ...perSymbolOptions, source });
            return { symbol, source, result };
        } catch {
            return null;
        }
    }, CONCURRENCY);

    const valid = perSymbolResults.filter(Boolean);

    const allOccurrences = [];
    let symbolsBlockedByBandWidth = 0;

    for (const { symbol, source, result } of valid) {
        if (result.bandWidth && !result.bandWidth.passed) symbolsBlockedByBandWidth++;
        const volumeUsd = volumeMap.has(symbol) ? Number(volumeMap.get(symbol)) || 0 : null;
        for (const occ of result.occurrences) {
            allOccurrences.push({ symbol, source: source ?? 'binance', volumeUsd, ...occ });
        }
    }

    allOccurrences.sort((a, b) => new Date(b.signalDate) - new Date(a.signalDate));

    const filledOccurrences = allOccurrences.filter((o) => o.filled);
    const totalTarget = filledOccurrences.filter((o) => o.outcome === 'target').length;
    const totalStop = filledOccurrences.filter((o) => o.outcome === 'stop').length;
    const totalOpen = filledOccurrences.filter((o) => o.outcome === 'open').length;
    const totalNotFilled = allOccurrences.length - filledOccurrences.length;
    const closedCount = totalTarget + totalStop;
    const winRatePct = closedCount > 0 ? parseFloat(((totalTarget / closedCount) * 100).toFixed(1)) : 0;
    const baseVsEvolved = countBaseVsEvolvedExits(filledOccurrences);
    const pdcOpts = perSymbolOptions.prevDayCloud;
    const cloudZoneStats = pdcOpts?.enabled ? computeCloudZoneStats(allOccurrences) : null;
    const srOpts = perSymbolOptions.supportResistance;
    const supportResistanceStats = srOpts?.enabled ? computeSupportResistanceZoneStats(allOccurrences) : null;
    const srBlockedCount = srOpts?.enabled
        ? valid.reduce((s, { result }) => s + (result.srBlockedCount || 0), 0)
        : 0;
    const rsi1hBreakdown = computeRsi1hBreakdown(allOccurrences);
    const higherRsiEnabled = !!perSymbolOptions.higherRsiFilter?.enabled;
    const higherRsiBlockedCount = higherRsiEnabled
        ? valid.reduce((s, { result }) => s + (result.higherRsiBlockedCount || 0), 0)
        : 0;
    const rsi5mEnabled = !!perSymbolOptions.rsi5mFilter?.enabled;
    const rsi5mBlockedCount = rsi5mEnabled
        ? valid.reduce((s, { result }) => s + (result.rsi5mBlockedCount || 0), 0)
        : 0;
    const nhEnabled = !!perSymbolOptions.newHighFilter?.enabled;
    const newHighBlockedCount = nhEnabled
        ? valid.reduce((s, { result }) => s + (result.newHighBlockedCount || 0), 0)
        : 0;
    const volumeBreakdown = volumeMap.size > 0 ? computeVolumeBreakdown(filledOccurrences, volumeMap) : null;
    const positionSizeUsd = perSymbolOptions.positionSizeUsd ?? 40;
    const totalInvestedUsd = parseFloat(
        filledOccurrences.reduce((s, o) => s + (o.investedUsd ?? positionSizeUsd), 0).toFixed(2),
    );
    const rfEnabled = !!perSymbolOptions.reinforceOnStop?.enabled;
    const totalPnlUsd = parseFloat(filledOccurrences.reduce((s, o) => s + o.pnlUsd, 0).toFixed(2));
    const avgPnlPct = filledOccurrences.length > 0
        ? parseFloat((filledOccurrences.reduce((s, o) => s + o.pnlPct, 0) / filledOccurrences.length).toFixed(2))
        : 0;

    return {
        interval,
        refRsiInterval: valid[0]?.result?.refRsiInterval ?? '1h',
        rsiThreshold: perSymbolOptions.rsiThreshold ?? 70,
        priorRsiCount: perSymbolOptions.priorRsiFilter?.enabled === false
            ? 0
            : Math.max(1, Math.round(Number(perSymbolOptions.priorRsiFilter?.count ?? 3))),
        pullbackPct: perSymbolOptions.pullbackPct ?? 0,
        targetPct: perSymbolOptions.targetPct ?? 5,
        stopLossPct: perSymbolOptions.stopLossPct ?? 5,
        positionSizeUsd,
        lookbackHours: perSymbolOptions.lookbackHours ?? 0,
        bandWidthEnabled: !!perSymbolOptions.bandWidth?.enabled,
        prevDayCloud: pdcOpts?.enabled ? {
            maxPct: Math.max(1, Math.min(100, Number(pdcOpts.maxPct ?? 100))),
            interval: pdcOpts.interval ?? '4h',
            candleCount: Math.max(1, Math.min(10, Math.round(Number(pdcOpts.candleCount ?? 3)))),
            useHighLow: pdcOpts.useHighLow !== false,
        } : null,
        cloudZoneStats,
        supportResistance: srOpts?.enabled ? {
            interval: srOpts.interval ?? '4h',
            candleCount: Math.max(20, Math.min(1000, Math.round(Number(srOpts.candleCount ?? 200)))),
            entrySupportRank: Math.max(1, Math.min(3, Math.round(Number(srOpts.entrySupportRank ?? 1)))),
            exitResistanceRank: Math.max(1, Math.min(3, Math.round(Number(srOpts.exitResistanceRank ?? 1)))),
            entryMaxPct: srOpts.entryMaxPct === 'adapt' ? 'adapt' : Math.max(0.1, Math.min(100, Number(srOpts.entryMaxPct ?? 10))),
            entryMaxPctMode: srOpts.entryMaxPct === 'adapt' ? 'adapt' : 'fixed',
        } : null,
        supportResistanceStats,
        srBlockedCount,
        rsi1hBreakdown,
        minVolumeUsdt: Number(minVolumeUsdt) > 0 ? Number(minVolumeUsdt) : 0,
        excludeOpenExits: !!perSymbolOptions.excludeOpenExits,
        prevCandleStop: !!perSymbolOptions.prevCandleStop,
        adxFilterEnabled: !!perSymbolOptions.adxFilter?.enabled,
        macdFilterEnabled: !!perSymbolOptions.macdFilter?.enabled,
        higherRsiFilter: higherRsiEnabled
            ? { interval: '1h', minRsi: Math.max(1, Math.min(99, Number(perSymbolOptions.higherRsiFilter.minRsi ?? 50))) }
            : null,
        higherRsiBlockedCount,
        rsi5mFilter: rsi5mEnabled
            ? { interval: '5m', threshold: Math.max(50, Math.min(95, Number(perSymbolOptions.rsi5mFilter.threshold ?? 70))) }
            : null,
        rsi5mBlockedCount,
        newHighFilter: nhEnabled
            ? {
                lookback: Math.max(3, Math.min(300, Math.round(Number(perSymbolOptions.newHighFilter.lookback ?? 20)))),
                marginPct: Math.max(0, Math.min(20, Number(perSymbolOptions.newHighFilter.marginPct ?? 2))),
            }
            : null,
        newHighBlockedCount,
        trailingStop: perSymbolOptions.trailingStop?.enabled ? { ...perSymbolOptions.trailingStop } : null,
        targetMode: (perSymbolOptions.targetMode === 'fixed' || perSymbolOptions.targetMode === 'continuous' || perSymbolOptions.targetMode === 'off')
            ? perSymbolOptions.targetMode
            : (perSymbolOptions.trailingTarget?.enabled ? 'continuous' : 'fixed'),
        trailingTarget: perSymbolOptions.targetMode === 'continuous' ? { ...perSymbolOptions.trailingTarget } : null,
        hardTakeProfit: perSymbolOptions.hardTakeProfit?.enabled
            ? { pct: Math.max(1, Math.min(200, Number(perSymbolOptions.hardTakeProfit.pct ?? 15))) }
            : null,
        reinforceOnStop: rfEnabled ? {
            mode: perSymbolOptions.reinforceOnStop.mode === 'rearm' ? 'rearm' : 'ladder',
            addDropPct: Math.max(2, Math.min(30, Number(perSymbolOptions.reinforceOnStop.addDropPct ?? 10))),
            exitRisePct: Math.max(2, Math.min(50, Number(perSymbolOptions.reinforceOnStop.exitRisePct ?? 15))),
            rearmStopPct: Math.max(0.5, Math.min(30, Number(perSymbolOptions.reinforceOnStop.rearmStopPct ?? 10))),
            rearmTargetPct: Math.max(0.5, Math.min(50, Number(perSymbolOptions.reinforceOnStop.rearmTargetPct ?? 10))),
            buyUsd: Math.max(5, Math.min(100_000, Number(perSymbolOptions.reinforceOnStop.buyUsd ?? positionSizeUsd))),
        } : null,
        reinforceStats: rfEnabled ? computeReinforceStats(filledOccurrences) : null,
        dailyEntryStats: computeDailyEntryStats(filledOccurrences, positionSizeUsd, perSymbolOptions.entriesDayRange ?? null),
        tradeDuration: computeAvgTradeDurationMs(filledOccurrences),
        symbolsTotal: allSymbols.length,
        symbolsBlockedByVolume,
        symbolsScanned: valid.length,
        symbolsBlockedByBandWidth,
        includeGateFavorites: !!includeGateFavorites,
        gateFavoritesTotal,
        gateFavoritesScanned: valid.filter((v) => v.source === 'gate').length,
        gateFavoritesBlockedByVolume,
        totalSignals: allOccurrences.length,
        totalFilled: filledOccurrences.length,
        totalTarget,
        totalStop,
        totalOpen,
        totalNotFilled,
        stopBaseCount: baseVsEvolved.stopBase,
        stopEvolvedCount: baseVsEvolved.stopEvolved,
        targetBaseCount: baseVsEvolved.targetBase,
        targetEvolvedCount: baseVsEvolved.targetEvolved,
        volumeBreakdown,
        winRatePct,
        totalInvestedUsd,
        totalPnlUsd,
        avgPnlPct,
        occurrences: allOccurrences.slice(0, maxRows),
        occurrencesTruncated: allOccurrences.length > maxRows,
    };
}

module.exports = analyseRsiThresholdBacktestMarket;
