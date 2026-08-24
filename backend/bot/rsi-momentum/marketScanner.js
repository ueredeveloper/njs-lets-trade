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
    return {
        ENTRY_OFF: 'entradas pausadas na configuração',
        INSUFFICIENT_DATA: 'histórico de candles insuficiente pra calcular o RSI',
        RSI_NOT_CROSSING: `RSI não cruzou o valor ${threshold}`,
        RSI_VOLATILE_NEAR_THRESHOLD: `cruzou ${threshold}, mas algum dos ${priorCount} valores de RSI anteriores já tinha passado de ${threshold} (repique, não cruzamento limpo)`,
        BANDWIDTH_NO_DATA: 'candles insuficientes pra calcular a largura de banda',
        BANDWIDTH_TOO_LOW: `largura de banda média abaixo do mínimo exigido (${minPct}%)`,
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
    const candidates = symbols.filter((sym) => !tracked.has(sym));
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
