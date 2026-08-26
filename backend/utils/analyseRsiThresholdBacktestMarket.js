'use strict';

const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const analyseRsiThresholdBacktest = require('./analyseRsiThresholdBacktest');
const getTickers = require('../binance/cachedTicker24hr');
const { computeDailyEntryStats } = require('./dailyEntryStats');
const { computeAvgTradeDurationMs } = require('./tradeDurationStats');

const CONCURRENCY = 15;
const DEFAULT_MAX_ROWS = 300;

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
 */
async function analyseRsiThresholdBacktestMarket(options = {}) {
    const { interval, maxRows = DEFAULT_MAX_ROWS, minVolumeUsdt = 0, ...perSymbolOptions } = options;

    const { list: allSymbols } = await getActiveUsdtPairs();

    let symbols = allSymbols;
    let symbolsBlockedByVolume = 0;
    if (Number(minVolumeUsdt) > 0 && perSymbolOptions.source !== 'gate') {
        try {
            const tickers = await getTickers();
            const volumeMap = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
            const filtered = allSymbols.filter((sym) => (volumeMap.get(sym) ?? 0) >= Number(minVolumeUsdt));
            symbolsBlockedByVolume = allSymbols.length - filtered.length;
            symbols = filtered;
        } catch {
            // fail-open: falha ao buscar o ticker não bloqueia o backtest, só desativa o filtro.
        }
    }

    const perSymbolResults = await runWithConcurrency(symbols, async (symbol) => {
        try {
            const result = await analyseRsiThresholdBacktest(symbol, interval, perSymbolOptions);
            return { symbol, result };
        } catch {
            return null;
        }
    }, CONCURRENCY);

    const valid = perSymbolResults.filter(Boolean);

    const allOccurrences = [];
    let symbolsBlockedByBandWidth = 0;

    for (const { symbol, result } of valid) {
        if (result.bandWidth && !result.bandWidth.passed) symbolsBlockedByBandWidth++;
        for (const occ of result.occurrences) {
            allOccurrences.push({ symbol, ...occ });
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
    const positionSizeUsd = perSymbolOptions.positionSizeUsd ?? 40;
    const totalInvestedUsd = parseFloat((filledOccurrences.length * positionSizeUsd).toFixed(2));
    const totalPnlUsd = parseFloat(filledOccurrences.reduce((s, o) => s + o.pnlUsd, 0).toFixed(2));
    const avgPnlPct = filledOccurrences.length > 0
        ? parseFloat((filledOccurrences.reduce((s, o) => s + o.pnlPct, 0) / filledOccurrences.length).toFixed(2))
        : 0;

    return {
        interval,
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
        minVolumeUsdt: Number(minVolumeUsdt) > 0 ? Number(minVolumeUsdt) : 0,
        excludeOpenExits: !!perSymbolOptions.excludeOpenExits,
        prevCandleStop: !!perSymbolOptions.prevCandleStop,
        adxFilterEnabled: !!perSymbolOptions.adxFilter?.enabled,
        macdFilterEnabled: !!perSymbolOptions.macdFilter?.enabled,
        trailingStop: perSymbolOptions.trailingStop?.enabled ? { ...perSymbolOptions.trailingStop } : null,
        dailyEntryStats: computeDailyEntryStats(filledOccurrences, positionSizeUsd, perSymbolOptions.entriesDayRange ?? null),
        tradeDuration: computeAvgTradeDurationMs(filledOccurrences),
        symbolsTotal: allSymbols.length,
        symbolsBlockedByVolume,
        symbolsScanned: valid.length,
        symbolsBlockedByBandWidth,
        totalSignals: allOccurrences.length,
        totalFilled: filledOccurrences.length,
        totalTarget,
        totalStop,
        totalOpen,
        totalNotFilled,
        winRatePct,
        totalInvestedUsd,
        totalPnlUsd,
        avgPnlPct,
        occurrences: allOccurrences.slice(0, maxRows),
        occurrencesTruncated: allOccurrences.length > maxRows,
    };
}

module.exports = analyseRsiThresholdBacktestMarket;
