'use strict';

/**
 * Registra em rsi_momentum_missed_signals todo SINAL CONFIRMADO do RSI Momentum que NÃO virou
 * compra — diferente do nearMissLogger (RSI cruzou mas um filtro barrou antes do sinal). Casos:
 *   - PULLBACK_EXPIRED   limite GTC armada (preço do sinal − pullback.belowPct%) expirou sem fill
 *   - LIMIT_CLOSED       a limite sumiu da corretora sem fill (cancelada por fora / rejeitada)
 *   - SIGNAL_LOST        scanner sinalizou, mas a sessão não confirmou no 1º tick
 *   - ENTRY_FAILED       corretora recusou a compra (saldo, filtro de lote…) — markFailed
 *
 * Motivação: retireAutoFavorite APAGA a linha de rsi_multi_bot_state quando o pullback expira, e
 * com ela o entry_signal_time — o único rastro ficava na lista de ordens canceladas da Binance
 * (auditoria 05/10/2026: 27 limites canceladas × 2 preenchidas em 14 dias). Esta tabela alimenta
 * o favorito "Sinais sem entrada" (botão SSE na tabela de moedas), que abre o gráfico com a seta
 * amarela no candle do sinal.
 *
 * Best-effort: falha de rede/Supabase só loga — nunca derruba o tick.
 * SQL: supabase/add-rsi-momentum-missed-signals-table.sql
 */

const { sbReq } = require('../shared/supabaseRest');

const PULLBACK_INTERVAL = '1m';

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Menor mínima dos candles de 1m desde o sinal — "quanto faltou" pra limite preencher. */
function minLowSince(cMap, sinceMs) {
    if (!Number.isFinite(sinceMs)) return null;
    const lows = (cMap?.[PULLBACK_INTERVAL] ?? [])
        .filter(c => Number(c.openTime) >= sinceMs)
        .map(c => Number(c.low))
        .filter(Number.isFinite);
    return lows.length ? Math.min(...lows) : null;
}

async function logMissedSignal({
    symbol, exchange = 'binance', interval, reason, signalOpenTime, signalPrice,
    limitPrice = null, orderPlacedAt = null, rsi = null, threshold = null, cMap = null,
    detail = {}, log = console.log,
}) {
    const signalMs = num(signalOpenTime);
    if (!symbol || !signalMs) return; // sem candle do sinal não há onde desenhar a seta
    const minLow = minLowSince(cMap, signalMs);
    const missPct = minLow != null && num(limitPrice)
        ? Number((((minLow / Number(limitPrice)) - 1) * 100).toFixed(3))
        : null;
    try {
        await sbReq('POST', 'rsi_momentum_missed_signals', {
            symbol,
            exchange,
            interval: interval ?? null,
            reason,
            signal_time: new Date(signalMs).toISOString(),
            signal_price: num(signalPrice),
            limit_price: num(limitPrice),
            order_placed_at: orderPlacedAt ?? null,
            min_low: minLow,
            miss_pct: missPct,
            rsi: num(rsi) != null ? Number(Number(rsi).toFixed(2)) : null,
            threshold: num(threshold),
            detail,
        });
    } catch (err) {
        if (/\b409\b/.test(err.message)) return; // mesmo sinal já gravado (índice único)
        log(`⚠️  Falha ao registrar sinal sem entrada (${symbol}): ${err.message}`);
    }
}

module.exports = { logMissedSignal, minLowSince };
