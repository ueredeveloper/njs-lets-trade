'use strict';

/**
 * Scanner de mercado do RSI Momentum: diferente dos outros bots (bollinger-bands, ma-cross —
 * o usuário favorita a moeda manualmente antes do bot vigiar), aqui NENHUMA moeda é favoritada
 * de antemão. O scanner varre TODOS os pares USDT ativos da Binance periodicamente, calcula o
 * mesmo sinal de RSI Momentum (ver strategyEngine.js#evaluateEntrySignal) com uma config GLOBAL
 * única (não há form por moeda ainda), e quando uma moeda dispara o sinal, delega pro chamador
 * (`onSignal`) criar o favorito + iniciar a sessão dedicada daquela moeda — a partir daí ela
 * segue o ciclo normal (pending/comprada/falha) igual a qualquer outro bot.
 *
 * Moedas já rastreadas (`loadTrackedSymbols`) são puladas no scan — sem isso, uma moeda que já
 * está pending/comprada/com falha registrada seria reavaliada e potencialmente re-sinalizada
 * a cada ciclo.
 */

const { getActiveUsdtPairs } = require('../../binance/getActiveUsdtPairs');
const { fetchBinanceCandles } = require('../prices');
const { getRequiredSpecs, evaluateEntrySignal } = require('./strategyEngine');

const SCAN_CONCURRENCY = 15;

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

/**
 * Uma varredura completa do mercado. `loadTrackedSymbols()` deve devolver um Set/array com os
 * símbolos que JÁ têm favorito rsi-momentum (qualquer fase — pending/comprada/falha) — essas
 * são puladas. `onSignal(symbol, signal)` é chamado (sequencialmente, aguardado) pra cada
 * sinal novo encontrado.
 */
async function scanMarketOnce({ config, loadTrackedSymbols, onSignal, log }) {
    const [{ list: symbols }, trackedRaw] = await Promise.all([
        getActiveUsdtPairs(),
        loadTrackedSymbols(),
    ]);
    const tracked = new Set(trackedRaw);
    const specs = getRequiredSpecs(config);
    const candidates = symbols.filter((sym) => !tracked.has(sym));

    let signals = 0;
    await runWithConcurrency(candidates, async (symbol) => {
        let signal;
        try {
            const cMap = await fetchCandleMap(symbol, specs);
            signal = evaluateEntrySignal(config, cMap);
        } catch {
            return; // candles insuficientes/erro pontual — ignora e segue o scan
        }
        if (!signal.allowed) return;
        signals++;
        try {
            await onSignal(symbol, signal);
        } catch (err) {
            log(`⚠️  [rsi-momentum-scanner] falha ao processar sinal de ${symbol}: ${err.message}`);
        }
    }, SCAN_CONCURRENCY);

    if (signals > 0) log(`🔎 Scan de mercado RSI Momentum: ${signals} sinal(is) novo(s) de ${candidates.length} moeda(s) analisadas`);
}

function startMarketScanner({ config, loadTrackedSymbols, onSignal, log, intervalMs = 60_000 }) {
    const run = () => scanMarketOnce({ config, loadTrackedSymbols, onSignal, log }).catch((err) => {
        log(`⚠️  [rsi-momentum-scanner] ${err.message}`);
    });
    run();
    setInterval(run, intervalMs);
}

module.exports = { scanMarketOnce, startMarketScanner };
