'use strict';

/**
 * Sinais dos BOTS EXCLUSIVOS (rsi_multi_bot_state.curated = true) que não viraram ordem — pro
 * favorito SSE da tabela de moedas.
 *
 * O missedSignalLogger.js só grava o que o bot VIU: se ele estava parado/sem restart depois de
 * criar o bot exclusivo, ou se o tick pulou o minuto do sinal (num entry.interval de 1m o sinal
 * só existe por ~60s), nada é gravado. Aqui o motor de entrada (evaluateEntrySignal — mesmo do
 * bot) é rodado de novo sobre os candles reais da Binance, com o trade_config DE CADA bot
 * exclusivo (intervalo/limiar/pullback próprios), e cada sinal confirmado sem compra na
 * corretora logo depois vira uma linha `reason: 'NO_ORDER'` no mesmo shape de
 * rsi_momentum_missed_signals (não é gravado no Supabase — calculado sob demanda, cache de 5 min).
 *
 * "Sem compra" = nenhum BUY nos myTrades da moeda entre o sinal e o fim da espera da limite.
 * Sinais com posição aberta (saldo líquido ≥ US$5) ou dentro do cooldown pós-venda são ignorados
 * (o bot não poderia entrar). Só Binance (myTrades/klines); bot exclusivo Gate fica de fora.
 * Limitações: confirmação adiantada (earlyConfirm) não é reproduzida — só o cruzamento no candle
 * FECHADO de entry.interval; janela limitada a REPLAY_MAX_DAYS desde a criação do favorito.
 */

const { sbReq } = require('../shared/supabaseRest');
const { binanceRequest } = require('../../binance/tradeClient');
const {
    getRequiredSpecs, evaluateEntrySignal, computeRsiSeries, intervalMs, PULLBACK_INTERVAL,
} = require('./strategyEngine');
const { toEngineConfig, normalizeRsiMomentumConfig } = require('./tradeConfigSchema');

const REPLAY_MAX_DAYS = 7;
const CACHE_TTL_MS = 5 * 60_000;
const FLAT_USD = 5; // abaixo disso o saldo é poeira — conta como "sem posição"

let cache = { key: null, at: 0, rows: [] };

async function fetchKlinesRange(symbol, interval, startMs, endMs) {
    const out = [];
    let from = startMs;
    while (from < endMs) {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&endTime=${endMs}&limit=1000`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`klines ${symbol} ${interval}: HTTP ${res.status}`);
        const batch = await res.json();
        if (!batch.length) break;
        for (const c of batch) {
            out.push({
                openTime: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
                low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
            });
        }
        from = Number(batch[batch.length - 1][0]) + 1;
        if (batch.length < 1000) break;
    }
    return out;
}

/** Fatia `limit` candles FECHADOS até T + um candle "em formação" sintético (só o open, sem dado
 *  futuro) — o motor descarta o último candle como em formação, igual ao tick ao vivo. */
function sliceAt(candles, ivMs, limit, T) {
    let hi = candles.length;
    while (hi > 0 && candles[hi - 1].openTime + ivMs > T) hi--;
    const closed = candles.slice(Math.max(0, hi - limit), hi);
    if (!closed.length) return closed;
    const p = closed[closed.length - 1].close;
    return [...closed, { openTime: closed[closed.length - 1].openTime + ivMs, open: p, high: p, low: p, close: p, volume: 0 }];
}

/** Trades próprios da moeda (mais antigos primeiro) → posição líquida e última venda em T. */
function positionAt(trades, T) {
    let qty = 0;
    let lastSellMs = null;
    let lastPrice = 0;
    for (const t of trades) {
        if (t.time >= T) break;
        qty += t.isBuyer ? t.qty : -t.qty;
        lastPrice = t.price;
        if (!t.isBuyer) lastSellMs = t.time;
    }
    return { holding: qty * lastPrice >= FLAT_USD, lastSellMs };
}

async function replayCurated(row, fromMs, toMs) {
    const symbol = row.symbol;
    const config = toEngineConfig(normalizeRsiMomentumConfig(row.trade_config ?? {}));
    const entry = config.entry;
    const iv = entry.interval;
    const ivMs = intervalMs(iv);
    const specs = getRequiredSpecs(config);

    const series = {};
    for (const { interval, limit } of specs) {
        series[interval] = await fetchKlinesRange(symbol, interval, fromMs - (limit + 2) * intervalMs(interval), toMs);
    }

    const pullbackOn = !!entry.pullback?.enabled;
    const waitMs = pullbackOn
        ? Math.max(1, Math.round(Number(entry.limitWaitCandles ?? 0))) * intervalMs(PULLBACK_INTERVAL)
        : 3 * ivMs;
    const cooldownMs = Math.max(0, Math.round(Number(entry.reentryCooldownCandles ?? 0))) * ivMs;

    let trades = [];
    try {
        const list = await binanceRequest('GET', '/api/v3/myTrades', { symbol, limit: 1000 });
        trades = list.map(t => ({ time: Number(t.time), isBuyer: !!t.isBuyer, qty: Number(t.qty), price: Number(t.price) }))
            .sort((a, b) => a.time - b.time);
    } catch (err) {
        console.warn(`[curatedSignalReplay] myTrades ${symbol}: ${err.message}`);
    }

    // Pré-filtro barato: só candles onde o RSI cruzou o limiar — o resto não tem como ser sinal.
    const entryCandles = series[iv] ?? [];
    const rsi = computeRsiSeries(entryCandles);
    const off = entryCandles.length - rsi.length;
    const threshold = entry.rsiThreshold;
    const out = [];
    for (let k = 1; k < rsi.length; k++) {
        if (!(rsi[k - 1] < threshold && rsi[k] >= threshold)) continue;
        const sig = entryCandles[k + off];
        const T = sig.openTime + ivMs; // momento em que o candle do sinal fecha
        if (sig.openTime < fromMs || T > toMs) continue;

        const cMap = {};
        for (const { interval, limit } of specs) cMap[interval] = sliceAt(series[interval], intervalMs(interval), limit, T);
        const signal = evaluateEntrySignal(config, cMap);
        if (!signal.allowed) continue;

        const pos = positionAt(trades, T);
        if (pos.holding) continue;
        if (pos.lastSellMs != null && T - pos.lastSellMs < cooldownMs) continue;
        const bought = trades.some(t => t.isBuyer && t.time >= T - ivMs && t.time <= T + waitMs);
        if (bought) continue;

        const limitPrice = signal.limitPrice ?? null;
        let minLow = null;
        if (limitPrice != null) {
            const lows = (series[PULLBACK_INTERVAL] ?? [])
                .filter(c => c.openTime >= T && c.openTime < T + waitMs).map(c => c.low);
            minLow = lows.length ? Math.min(...lows) : null;
        }
        out.push({
            symbol,
            exchange: 'binance',
            interval: iv,
            reason: 'NO_ORDER',
            signal_time: new Date(sig.openTime).toISOString(),
            signal_price: signal.close ?? sig.close,
            limit_price: limitPrice,
            order_placed_at: null,
            min_low: minLow,
            miss_pct: minLow != null && limitPrice ? Number((((minLow / limitPrice) - 1) * 100).toFixed(3)) : null,
            rsi: signal.rsi != null ? Number(Number(signal.rsi).toFixed(2)) : null,
            threshold,
            detail: { curated: true, replay: true },
        });
    }
    return out;
}

/**
 * Sinais sem ordem dos bots exclusivos Binance desde `sinceMs` (limitado a REPLAY_MAX_DAYS e à
 * criação do favorito de cada um). `symbol` opcional restringe a uma moeda. Nunca lança — erro
 * numa moeda só a deixa de fora.
 */
async function listCuratedMissedSignals({ sinceMs, symbol = null }) {
    const key = `${Math.floor(sinceMs / CACHE_TTL_MS)}|${symbol ?? ''}`;
    if (cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

    const toMs = Date.now();
    const floorMs = Math.max(sinceMs, toMs - REPLAY_MAX_DAYS * 86_400_000);
    let q = '?select=symbol,exchange,trade_config&curated=eq.true&strategy_id=eq.rsi-momentum';
    if (symbol) q += `&symbol=eq.${symbol}`;
    const rows = (await sbReq('GET', 'rsi_multi_bot_state', null, q)).filter(r => (r.exchange ?? 'binance') === 'binance');
    if (!rows.length) return [];

    const favs = await sbReq('GET', 'multitrade_favorites', null,
        `?select=symbol,created_at&strategy_id=eq.rsi-momentum&symbol=in.(${rows.map(r => r.symbol).join(',')})`)
        .catch(() => []);
    const createdBySymbol = new Map(favs.map(f => [f.symbol, Date.parse(f.created_at)]));

    const all = [];
    for (const row of rows) {
        const fromMs = Math.max(floorMs, createdBySymbol.get(row.symbol) || 0);
        try {
            all.push(...await replayCurated(row, fromMs, toMs));
        } catch (err) {
            console.warn(`[curatedSignalReplay] ${row.symbol}: ${err.message}`);
        }
    }
    cache = { key, at: Date.now(), rows: all };
    return all;
}

module.exports = { listCuratedMissedSignals, REPLAY_MAX_DAYS };
