'use strict';

/**
 * Backfill de rsi_momentum_missed_signals a partir das ordens LIMIT BUY CANCELADAS sem execução
 * na Binance — os pullbacks que expiraram ANTES do bot passar a gravar a tabela
 * (missedSignalLogger.js). Idempotente (índice único symbol+signal_time+reason → 409 = pula).
 *
 *   node backend/bot/rsi-momentum/backfill-missed-signals.js [dias=14] [--curated | --symbols=A,B]
 *
 * Moedas CURADAS (bot exclusivo — rsi_multi_bot_state.curated) usam o trade_config DELAS
 * (intervalo/pullback próprios, ex. 1m e 1%) em vez da config global. `--curated` varre só elas
 * (segundos em vez de minutos); `--symbols=` restringe a uma lista.
 *
 * Reconstrói o sinal: a limite é armada em signalClose × (1 − pullback.belowPct%) — então
 * signalPrice ≈ limite / (1 − belowPct%) e o candle do sinal é o candle FECHADO de entry.interval
 * (antes da ordem) cujo close mais se aproxima desse preço. Varre TODOS os pares USDT (allOrders
 * não tem consulta por conta inteira) — ~2 min por causa do limite de peso da Binance.
 * Limitação: não distingue limite do RSI Momentum de uma limite manual feita direto na Binance.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { binanceRequest, syncBinanceClock } = require('../../binance/tradeClient');
const { sbReq } = require('../shared/supabaseRest');
const { loadGlobalConfigBody } = require('./strategyPresets');
const { normalizeRsiMomentumConfig } = require('./tradeConfigSchema');

const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';
const IV_MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '4h': 14400e3 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function klines(symbol, interval, startTime, endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
    return (await fetch(url)).json();
}

async function main() {
    const days = Number(process.argv[2]) || 14;
    const since = Date.now() - days * 86_400_000;
    const onlyCurated = process.argv.includes('--curated');
    const symbolsArg = process.argv.find(a => a.startsWith('--symbols='));
    const cfg = normalizeRsiMomentumConfig(await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID));
    const globalParams = { interval: cfg.entry.interval, belowPct: Number(cfg.entry.pullback?.belowPct ?? 3) };

    // Bot exclusivo: intervalo/pullback do trade_config da própria linha.
    const curatedRows = await sbReq('GET', 'rsi_multi_bot_state', null,
        '?select=symbol,exchange,trade_config&curated=eq.true');
    const paramsBySymbol = new Map();
    for (const row of curatedRows) {
        if ((row.exchange ?? 'binance') !== 'binance') continue; // allOrders só existe na Binance
        const c = normalizeRsiMomentumConfig(row.trade_config ?? {});
        paramsBySymbol.set(row.symbol, { interval: c.entry.interval, belowPct: Number(c.entry.pullback?.belowPct ?? 3) });
    }
    const paramsFor = sym => paramsBySymbol.get(sym) ?? globalParams;

    await syncBinanceClock();
    let symbols;
    if (symbolsArg) {
        symbols = symbolsArg.slice('--symbols='.length).split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
    } else if (onlyCurated) {
        symbols = [...paramsBySymbol.keys()];
    } else {
        const info = await (await fetch('https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT')).json();
        symbols = info.symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING').map(s => s.symbol);
    }
    const curatedDesc = [...paramsBySymbol].map(([sym, p]) => `${sym} ${p.interval}/${p.belowPct}%`).join(', ');
    console.log(`Varrendo ${symbols.length} pares USDT, ${days} dias — global ${globalParams.interval}/pullback ${globalParams.belowPct}%`
        + (curatedDesc ? `; exclusivos: ${curatedDesc}` : '') + '…');

    const orders = [];
    for (let i = 0; i < symbols.length; i++) {
        try {
            const list = await binanceRequest('GET', '/api/v3/allOrders', { symbol: symbols[i], limit: 100 });
            for (const o of list) {
                if (o.time >= since && o.side === 'BUY' && o.type === 'LIMIT'
                    && o.status === 'CANCELED' && Number(o.executedQty) === 0) orders.push(o);
            }
        } catch (err) {
            console.warn(`  ${symbols[i]}: ${err.message}`);
        }
        if (i % 40 === 39) await sleep(9000); // allOrders pesa 20 — fica abaixo de 6000/min
    }
    console.log(`${orders.length} limite(s) cancelada(s) sem execução.`);

    let inserted = 0;
    for (const o of orders.sort((a, b) => a.time - b.time)) {
        const { interval, belowPct } = paramsFor(o.symbol);
        const ivMs = IV_MS[interval] ?? 900e3;
        const limit = Number(o.price);
        const expectedClose = limit / (1 - belowPct / 100);
        const candles = await klines(o.symbol, interval, o.time - 4 * ivMs, o.time);
        const closed = candles.filter(c => c[0] + ivMs <= o.time);
        if (!closed.length) continue;
        const best = closed.reduce((a, c) =>
            Math.abs(Number(c[4]) - expectedClose) < Math.abs(Number(a[4]) - expectedClose) ? c : a);
        const signalMs = best[0];
        const win = await klines(o.symbol, '1m', signalMs, o.updateTime);
        const lows = win.map(c => Number(c[3])).filter(Number.isFinite);
        const minLow = lows.length ? Math.min(...lows) : null;
        try {
            await sbReq('POST', 'rsi_momentum_missed_signals', {
                symbol: o.symbol, exchange: 'binance', interval, reason: 'PULLBACK_EXPIRED',
                signal_time: new Date(signalMs).toISOString(),
                signal_price: Number(best[4]), limit_price: limit,
                order_placed_at: new Date(o.time).toISOString(),
                min_low: minLow,
                miss_pct: minLow != null ? Number((((minLow / limit) - 1) * 100).toFixed(3)) : null,
                detail: { backfill: true, curated: paramsBySymbol.has(o.symbol), orderId: o.orderId, cancelledAt: new Date(o.updateTime).toISOString() },
            });
            inserted++;
            console.log(`  + ${o.symbol} sinal ${new Date(signalMs - 3 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} BRT`);
        } catch (err) {
            if (/\b409\b|duplicate key/i.test(err.message)) continue;
            throw err;
        }
    }
    console.log(`Inseridos: ${inserted}.`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
