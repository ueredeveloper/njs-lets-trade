'use strict';

/**
 * Registra em rsi_momentum_near_misses toda moeda em que o RSI já CRUZOU o limiar de entrada
 * mas foi barrada por outro filtro — ver strategyEngine.js#evaluateEntrySignal e
 * supabase/add-rsi-momentum-near-misses-table.sql (motivação completa). NÃO registra
 * RSI_NOT_CROSSING/ENTRY_OFF/INSUFFICIENT_DATA (maioria do mercado a cada ciclo, sem cruzamento
 * — não é "quase comprou").
 *
 * Dedupe em memória (processo do bot): a mesma moeda pode ficar presa no mesmo motivo por várias
 * varreduras seguidas (SCAN_INTERVAL_MS = 5min) — só grava de novo se o motivo mudou desde o
 * último registro OU já passou COOLDOWN_MS. Falha de rede/Supabase não derruba o scan (loga e
 * segue, igual ao resto do scanner).
 */

const { sbReq } = require('../shared/supabaseRest');
const { evaluateEntryReadiness } = require('./strategyEngine');

const COOLDOWN_MS = 30 * 60_000;
const SKIP_REASONS = new Set(['RSI_NOT_CROSSING', 'ENTRY_OFF', 'INSUFFICIENT_DATA']);

// reason → campo do `signal` (evaluateEntrySignal) que carrega o detalhe daquele check.
const DETAIL_FIELD = {
    RSI_VOLATILE_NEAR_THRESHOLD: null, // usa priorWindow diretamente (não é um sub-objeto {allowed,reason})
    SPIKE_TOO_LARGE: 'spikeGuard',
    BANDWIDTH_TOO_LOW: 'bandWidth',
    BANDWIDTH_NO_DATA: 'bandWidth',
    RSI5M_TOO_LOW: 'rsi5m',
    RSI5M_NO_DATA: 'rsi5m',
    MACD_HISTOGRAM_NEGATIVE: 'macd',
    HIGHER_RSI_TOO_LOW: 'higherRsi',
    EMA_CROSS_BEARISH: 'emaCross',
    SR_NO_DISCOUNT: 'sr',
    SR_NO_DATA: 'sr',
};

const lastLogged = new Map(); // symbol -> { reason, at }

function shouldLog(symbol, reason) {
    const prev = lastLogged.get(symbol);
    if (!prev) return true;
    if (prev.reason !== reason) return true;
    return Date.now() - prev.at >= COOLDOWN_MS;
}

function buildDetail(signal) {
    if (signal.reason === 'RSI_VOLATILE_NEAR_THRESHOLD') {
        return signal.priorWindow ? { priorWindow: signal.priorWindow } : {};
    }
    const field = DETAIL_FIELD[signal.reason];
    return field && signal[field] ? signal[field] : {};
}

/**
 * `config`/`cMap` são os mesmos usados pelo scanner nesse ciclo pra essa moeda — reaproveitados
 * (sem novo fetch de candles) pra rodar evaluateEntryReadiness (retrato completo, SEM curto-
 * circuito, de todos os filtros) e guardar junto do motivo que efetivamente bloqueou.
 */
async function logNearMissIfNeeded({ symbol, exchange = 'binance', config, cMap, signal, log = console.log }) {
    if (!signal || signal.allowed !== false) return;
    if (SKIP_REASONS.has(signal.reason)) return;
    if (!shouldLog(symbol, signal.reason)) return;

    let readiness = null;
    try {
        readiness = evaluateEntryReadiness(config, cMap);
    } catch {
        // segue sem o retrato completo — melhor gravar parcial que perder o registro
    }

    const row = {
        symbol,
        exchange,
        interval: config?.entry?.interval ?? null,
        rsi: signal.rsi ?? null,
        threshold: signal.threshold ?? null,
        reason: signal.reason,
        detail: buildDetail(signal),
        blockers: readiness?.blockers ?? null,
        filters_ok: readiness?.filtersOk ?? null,
        filters_total: readiness?.filtersTotal ?? null,
        readiness: readiness ?? null,
    };

    // Marca ANTES do POST: uma falha de rede não deve fazer o próximo ciclo (5min depois)
    // tentar gravar de novo o mesmo motivo já visto agora.
    lastLogged.set(symbol, { reason: signal.reason, at: Date.now() });
    try {
        await sbReq('POST', 'rsi_momentum_near_misses', row);
    } catch (err) {
        log(`⚠️  [rsi-momentum-near-miss] falha ao gravar ${symbol}: ${err.message}`);
    }
}

module.exports = { logNearMissIfNeeded };
