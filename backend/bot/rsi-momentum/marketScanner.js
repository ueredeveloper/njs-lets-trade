'use strict';

/**
 * Scanner de mercado do RSI Momentum: diferente dos outros bots (bollinger-bands, ma-cross —
 * o usuário favorita a moeda manualmente antes do bot vigiar), aqui NENHUMA moeda é favoritada
 * de antemão. O scanner varre TODOS os pares USDT ativos da Binance periodicamente, calcula o
 * mesmo sinal de RSI Momentum (ver strategyEngine.js#evaluateEntrySignal) com uma config GLOBAL
 * única (editável em Configurações → RSI Momentum no painel, ver rsi_momentum_global_config),
 * e quando uma moeda dispara o sinal, delega pro chamador (`onSignal`) criar o favorito + iniciar
 * a sessão dedicada daquela moeda — a partir daí ela segue o ciclo normal (pending/comprada/falha)
 * igual a qualquer outro bot.
 *
 * Moedas já rastreadas (`loadTrackedSymbols`) são puladas no scan — sem isso, uma moeda que já
 * está pending/comprada/com falha registrada seria reavaliada e potencialmente re-sinalizada
 * a cada ciclo.
 */

const { getActiveUsdtPairs } = require('../../binance/getActiveUsdtPairs');
const { fetchBinanceCandles } = require('../prices');
const { getRequiredSpecs, evaluateEntrySignal } = require('./strategyEngine');
const { getSymbolCategories } = require('../../utils/assetCategories');
const getTickers = require('../../binance/cachedTicker24hr');

const SCAN_CONCURRENCY = 15;

/**
 * Tradução dos `reason` devolvidos por evaluateEntrySignal/checkBandWidthFilter (ver
 * strategyEngine.js) — só pra exibição nos logs do scanner, os códigos em si continuam em
 * inglês no retorno da função (não muda o motor, só o texto impresso). Recebe `config` (a
 * mesma usada nesse ciclo do scan) pra embutir os valores REAIS configurados (rsiThreshold,
 * priorRsiFilter.count, bandWidth.minPct) no texto — se o usuário mudar esses valores em
 * Configurações, o log já reflete o novo valor no próximo ciclo, sem nada hardcoded aqui.
 */
function buildReasonLabels(config) {
    const threshold = config.entry.rsiThreshold;
    const priorCount = config.entry.priorRsiFilter?.count ?? 3;
    const minPct = config.entry.bandWidth?.minPct;
    const rsi5mThreshold = config.entry.rsi5mFilter?.threshold;
    return {
        ENTRY_OFF: 'entradas pausadas na configuração',
        INSUFFICIENT_DATA: 'histórico de candles insuficiente pra calcular o RSI',
        RSI_NOT_CROSSING: `RSI não cruzou o valor ${threshold}`,
        RSI_VOLATILE_NEAR_THRESHOLD: `cruzou ${threshold}, mas algum dos ${priorCount} valores de RSI anteriores já tinha passado de ${threshold} (repique, não cruzamento limpo)`,
        BANDWIDTH_NO_DATA: 'candles insuficientes pra calcular a largura de banda',
        BANDWIDTH_TOO_LOW: `largura de banda média abaixo do mínimo exigido (${minPct}%)`,
        RSI5M_NO_DATA: 'candles 5m insuficientes pra calcular o RSI 5m',
        RSI5M_TOO_LOW: `RSI(14) do candle 5m abaixo do mínimo exigido (${rsi5mThreshold})`,
    };
}

async function fetchCandleMap(symbol, specs) {
    const entries = await Promise.all(
        specs.map(async ({ interval, limit }) => [interval, await fetchBinanceCandles(symbol, limit, interval)]),
    );
    return Object.fromEntries(entries);
}

async function runWithConcurrency(items, worker, concurrency) {
    let idx = 0;
    async function next() {
        while (idx < items.length) {
            const cur = idx++;
            await worker(items[cur]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

/** Valor curto pra identificar a moeda dentro da lista compacta do resumo por motivo (ex.:
 *  "BTCUSDT(69.80)") — versão enxuta do detalhe completo usado em fmtSignalReason (verbose). */
function shortSymbolDetail(signal) {
    if (signal.reason === 'RSI_NOT_CROSSING' || signal.reason === 'RSI_VOLATILE_NEAR_THRESHOLD') {
        return signal.rsi != null ? `(${Number(signal.rsi).toFixed(2)})` : '';
    }
    if (signal.reason === 'BANDWIDTH_TOO_LOW' && signal.bandWidth?.avgWidthPct != null) {
        return `(${signal.bandWidth.avgWidthPct}%)`;
    }
    if (signal.reason === 'RSI5M_TOO_LOW' && signal.rsi5m?.rsi5m != null) {
        return `(${Number(signal.rsi5m.rsi5m).toFixed(2)})`;
    }
    return '';
}

function fmtSignalReason(symbol, signal, reasonLabels) {
    let detail = '';
    if (signal.reason === 'RSI_NOT_CROSSING') {
        if (signal.rsi != null) detail = ` (RSI atual: ${Number(signal.rsi).toFixed(2)})`;
    } else if (signal.reason === 'RSI_VOLATILE_NEAR_THRESHOLD') {
        if (signal.priorWindow?.length) {
            detail = ` (valores anteriores: ${signal.priorWindow.map(v => Number(v).toFixed(2)).join(', ')})`;
        }
    } else if (signal.reason === 'BANDWIDTH_TOO_LOW' && signal.bandWidth?.avgWidthPct != null) {
        detail = ` (essa moeda: ${signal.bandWidth.avgWidthPct}%)`;
    } else if (signal.reason === 'RSI5M_TOO_LOW' && signal.rsi5m?.rsi5m != null) {
        detail = ` (RSI 5m atual: ${Number(signal.rsi5m.rsi5m).toFixed(2)})`;
    }
    return `   ${symbol}: ${reasonLabels[signal.reason] ?? signal.reason}${detail}`;
}

/**
 * Uma varredura completa do mercado. `loadConfig()` é chamado a CADA scan — relê a config
 * global do painel (ver rsi_momentum_global_config) pra pegar mudanças salvas em Configurações
 * sem precisar reiniciar o bot. `loadTrackedSymbols()` deve devolver um Set/array com os
 * símbolos que JÁ têm favorito rsi-momentum (qualquer fase — pending/comprada/falha) — essas
 * são puladas. `onSignal(symbol, signal)` é chamado (sequencialmente, aguardado) pra cada
 * sinal novo encontrado.
 *
 * Log de cada ciclo (pra dar visibilidade do que o scanner está decidindo, sem abrir o painel):
 * sempre imprime quantas moedas foram analisadas, os sinais encontrados e um resumo de motivos
 * de bloqueio (quantas por RSI_NOT_CROSSING, BANDWIDTH_TOO_LOW etc). Com `verbose: true`,
 * imprime além disso uma linha por moeda analisada (símbolo + motivo + RSI/limiar) — verboso
 * (varre ~400 pares a cada ciclo), útil só pra depurar/conferir regras na hora.
 */
async function scanMarketOnce({ loadConfig, loadTrackedSymbols, onSignal, log, verbose = false }) {
    const [config, { list: symbols }, trackedRaw] = await Promise.all([
        loadConfig(),
        getActiveUsdtPairs(),
        loadTrackedSymbols(),
    ]);
    const tracked = new Set(trackedRaw);
    const specs = getRequiredSpecs(config);

    // Filtro de volume 24h (config.volume.minVolumeUsdt, editável em Configurações → RSI
    // Momentum — padrão 1M USDT): pares com pouca liquidez têm spread/slippage altos demais pra
    // um bracket de alvo/stop estreito funcionar direito. Usa o mesmo cache de /ticker/24hr
    // compartilhado com a tela de volume (cachedTicker24hr.js, TTL 5min) — sem chamada extra à
    // Binance. Falha ao buscar o ticker não trava o scan: o filtro de volume só fica desativado
    // NESTE ciclo (fail-open), o resto do scan segue normal.
    const minVolumeUsdt = Number(config.volume?.minVolumeUsdt ?? 0);
    let volumeMap = null;
    if (minVolumeUsdt > 0) {
        try {
            const tickers = await getTickers();
            volumeMap = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
        } catch (err) {
            log(`⚠️  [rsi-momentum-scanner] falha ao buscar volume 24h — filtro de volume desativado neste ciclo (${err.message})`);
        }
    }

    // Stablecoin (USDCUSDT, USD1USDT, XAUTUSDT etc.) não faz sentido pra uma estratégia de
    // momentum de RSI — o preço é pareado a $1 (ou ouro/outra moeda), sem tendência real pra
    // "cruzar RSI" perseguir. Fora do scan, nunca chega a martelar candles/avaliar à toa.
    const afterBasicFilters = symbols.filter((sym) => !tracked.has(sym) && !getSymbolCategories(sym).includes('stablecoins'));
    const candidates = volumeMap
        ? afterBasicFilters.filter((sym) => (volumeMap.get(sym) ?? 0) >= minVolumeUsdt)
        : afterBasicFilters;
    const blockedByVolume = afterBasicFilters.length - candidates.length;
    const reasonLabels = buildReasonLabels(config);

    // RSI_NOT_CROSSING é disparado por praticamente toda moeda que não deu sinal (centenas por
    // ciclo) — listar símbolo não ajuda em nada, só conta. Os demais motivos são raros (poucas
    // moedas por ciclo) e o símbolo é útil pra conferir na hora, então ficam com lista.
    const reasonCounts = {};
    const reasonSymbols = {};
    const signalSymbols = [];
    let evalErrors = 0;

    await runWithConcurrency(candidates, async (symbol) => {
        let signal;
        try {
            const cMap = await fetchCandleMap(symbol, specs);
            signal = evaluateEntrySignal(config, cMap);
        } catch (err) {
            evalErrors++;
            if (verbose) log(`   ${symbol}: erro ao buscar candles/avaliar (${err.message})`);
            return; // candles insuficientes/erro pontual — ignora e segue o scan
        }
        if (!signal.allowed) {
            reasonCounts[signal.reason] = (reasonCounts[signal.reason] ?? 0) + 1;
            if (signal.reason !== 'RSI_NOT_CROSSING') {
                (reasonSymbols[signal.reason] ??= []).push(`${symbol}${shortSymbolDetail(signal)}`);
            }
            if (verbose) log(fmtSignalReason(symbol, signal, reasonLabels));
            return;
        }
        signalSymbols.push(signal.rsi != null ? `${symbol}(rsi ${Number(signal.rsi).toFixed(2)})` : symbol);
        if (verbose) log(`   ${symbol}: ✅ SINAL — ${signal.entryDesc}`);
        try {
            await onSignal(symbol, signal);
        } catch (err) {
            log(`⚠️  [rsi-momentum-scanner] falha ao processar sinal de ${symbol}: ${err.message}`);
        }
    }, SCAN_CONCURRENCY);

    log(`🔎 Scan RSI Momentum: ${candidates.length} moeda(s) analisadas`);
    if (blockedByVolume) log(`   bloqueadas — volume 24h abaixo de ${minVolumeUsdt.toLocaleString('pt-BR')} USDT: ${blockedByVolume}`);
    if (signalSymbols.length) log(`   sinais (${signalSymbols.length}): ${signalSymbols.join(', ')}`);
    if (evalErrors) log(`   erros: ${evalErrors}`);

    // Uma linha por motivo de bloqueio — símbolos até MAX_SYMBOLS_SHOWN (com "+N mais" se
    // passar disso); RSI_NOT_CROSSING só com a contagem (praticamente toda moeda cai nele).
    const MAX_SYMBOLS_SHOWN = 20;
    for (const [r, n] of Object.entries(reasonCounts)) {
        const syms = reasonSymbols[r];
        if (!syms) {
            log(`   bloqueadas — ${reasonLabels[r] ?? r}: ${n}`);
            continue;
        }
        const shown = syms.slice(0, MAX_SYMBOLS_SHOWN).join(', ');
        const rest = syms.length > MAX_SYMBOLS_SHOWN ? `, +${syms.length - MAX_SYMBOLS_SHOWN} mais` : '';
        log(`   bloqueadas — ${reasonLabels[r] ?? r} (${n}): ${shown}${rest}`);
    }
}

function startMarketScanner({ loadConfig, loadTrackedSymbols, onSignal, log, intervalMs = 60_000, verbose = false }) {
    const run = () => scanMarketOnce({ loadConfig, loadTrackedSymbols, onSignal, log, verbose }).catch((err) => {
        log(`⚠️  [rsi-momentum-scanner] ${err.message}`);
    });
    run();
    setInterval(run, intervalMs);
}

module.exports = { scanMarketOnce, startMarketScanner };
