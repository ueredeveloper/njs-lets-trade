'use strict';

/**
 * GET /services/rsi-momentum-signal-proximity
 *
 * Proximidade do SINAL de cada moeda do favorito "RSI" (linhas rsi_multi_bot_state do RSI
 * Momentum — scanner + bots exclusivos), cada uma no intervalo/limiar do PRÓPRIO bot
 * (resolveStrategy(row) — 1m, 15m, 1h…). Alimenta o seletor "Sinal" da lista RSI na tabela de
 * moedas, que ordena da mais perto de disparar pra mais longe.
 *
 * "Perto do sinal" = RSI(14) ATUAL do intervalo do bot (`rsiLive`, com o candle em formação) e a
 * distância em pontos até o limiar (`gap` = limiar − rsiLive; ≤ 0 = cruzaria se o candle fechasse
 * agora). Informativo: `targetPrice` = fechamento que o candle em formação precisaria ter pro RSI
 * bater o limiar (inversa do RSI de Wilder, mesma série do bot) e `distPct` = distância % até ele.
 *
 * Moeda aguardando recompra no reforço (rules_state.rearm/reinforce.awaitingReentry) usa o gatilho
 * de REENTRADA (reentryRsi.interval / rsiThreshold) em vez do de entrada — é esse sinal que ela espera.
 *
 * Devolve { at, rows: [{ symbol, exchange, phase, mode, interval, threshold, rsi, rsiLive, gap,
 * status, targetPrice, price, distPct, error }] }. status: 'below' (RSI fechado abaixo do limiar —
 * dá pra cruzar), 'above' (já acima — precisa cair antes de um cruzamento novo), 'bought' (em
 * trade, sem sinal a esperar), 'nodata'. Cache em memória de 15s.
 */

const router = require('express').Router();
const { sbReq } = require('../bot/shared/supabaseRest');
const { buildAdapter } = require('../bot/shared/buildAdapter');
const { closedCandlesOnly, getRequiredSpecs, RSI_PERIOD } = require('../bot/rsi-momentum/strategyEngine');
const { resolveStrategy } = require('../bot/rsi-momentum/tradeConfigSchema');

const TTL_MS = 15_000;
const CONCURRENCY = 8;
const MIN_RSI_CANDLES = RSI_PERIOD * 3 + 30;

let cache = { at: 0, payload: null, computing: null };

/** avgGain/avgLoss de Wilder (mesma suavização do RSI do technicalindicators) no fim da série. */
function wilderAverages(closes, period = RSI_PERIOD) {
    if (closes.length < period + 1) return null;
    let ag = 0;
    let al = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) ag += d; else al -= d;
    }
    ag /= period;
    al /= period;
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        ag = (ag * (period - 1) + Math.max(d, 0)) / period;
        al = (al * (period - 1) + Math.max(-d, 0)) / period;
    }
    return { ag, al };
}

const rsiFrom = (ag, al) => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));

/**
 * Fechamento do próximo candle que leva o RSI(14) exatamente a `threshold`, dado o estado de
 * Wilder (ag/al) depois do último candle fechado `lastClose`. null se impossível (sem perdas).
 */
function priceForRsi({ ag, al }, lastClose, threshold, period = RSI_PERIOD) {
    const k = period - 1;
    const r = threshold / (100 - threshold);
    const rsiFlat = rsiFrom((ag * k) / period, (al * k) / period); // próximo candle sem variação
    let d;
    if (rsiFlat < threshold) {
        // precisa subir: (k·ag + d) / (k·al) = r
        if (al === 0) return null;
        d = r * k * al - k * ag;
    } else {
        // mesmo caindo ainda bate: k·ag / (k·al − d) = r
        d = k * al - (k * ag) / r;
    }
    const price = lastClose + d;
    return price > 0 ? price : null;
}

function readingMode(row, config) {
    const rs = row.rules_state && typeof row.rules_state === 'object' ? row.rules_state : {};
    const awaiting = !!(rs.rearm?.awaitingReentry || rs.reinforce?.awaitingReentry);
    const rr = config.exit?.reinforceOnStop?.reentryRsi;
    if (awaiting) {
        return {
            mode: 'reentry',
            interval: rr?.interval || config.entry.interval,
            threshold: Math.max(1, Math.min(99, Number(rr?.rsiThreshold ?? config.entry.rsiThreshold))),
        };
    }
    return { mode: 'entry', interval: config.entry.interval, threshold: Number(config.entry.rsiThreshold) };
}

async function evaluateRow(row) {
    const base = { symbol: row.symbol, exchange: row.exchange ?? 'binance', phase: row.phase ?? 'WATCHING' };
    const strategy = resolveStrategy(row);
    if (!strategy) return { ...base, status: 'nodata', error: 'sem config' };
    const { config } = strategy;
    const { mode, interval, threshold } = readingMode(row, config);

    if (row.phase === 'BOUGHT' && mode !== 'reentry') {
        return { ...base, mode, interval, threshold, status: 'bought' };
    }

    // Mesma janela de candles que o bot usa nesse intervalo (o RSI de Wilder depende do histórico).
    const spec = getRequiredSpecs(config).find(s => s.interval === interval);
    const limit = Math.max(MIN_RSI_CANDLES, spec?.limit ?? 0);
    const adapter = buildAdapter(base.exchange, row.symbol);
    const raw = await adapter.fetchCandles(limit, interval);
    const closed = closedCandlesOnly(raw ?? []);
    const avgs = wilderAverages(closed.map(c => parseFloat(c.close)));
    if (!avgs || !raw?.length) return { ...base, mode, interval, threshold, status: 'nodata' };

    const lastClose = parseFloat(closed[closed.length - 1].close);
    const forming = raw[raw.length - 1];
    const price = closed[closed.length - 1] === forming ? lastClose : parseFloat(forming.close);
    const rsi = rsiFrom(avgs.ag, avgs.al);
    const k = RSI_PERIOD - 1;
    const dLive = price - lastClose;
    const rsiLive = rsiFrom(
        (avgs.ag * k + Math.max(dLive, 0)) / RSI_PERIOD,
        (avgs.al * k + Math.max(-dLive, 0)) / RSI_PERIOD,
    );
    const round = (v, n = 2) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);

    // Cruzamento exige o RSI FECHADO abaixo do limiar (prev < limiar) — acima dele não há sinal novo.
    if (rsi >= threshold) {
        return { ...base, mode, interval, threshold, status: 'above', rsi: round(rsi), rsiLive: round(rsiLive), gap: round(threshold - rsiLive), price };
    }
    const targetPrice = priceForRsi(avgs, lastClose, threshold);
    const distPct = targetPrice != null && price > 0 ? ((targetPrice - price) / price) * 100 : null;
    return {
        ...base, mode, interval, threshold, status: 'below',
        rsi: round(rsi), rsiLive: round(rsiLive), gap: round(threshold - rsiLive), price,
        targetPrice: targetPrice != null ? Number(targetPrice.toPrecision(8)) : null,
        distPct: round(distPct, 3),
    };
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            try {
                out[i] = await fn(items[i]);
            } catch (err) {
                out[i] = { symbol: items[i].symbol, exchange: items[i].exchange ?? 'binance', phase: items[i].phase, status: 'nodata', error: err.message };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

async function compute() {
    const rows = await sbReq('GET', 'rsi_multi_bot_state', null, '?strategy_id=eq.rsi-momentum&select=*') ?? [];
    const result = await mapLimit(rows, CONCURRENCY, evaluateRow);
    return { at: new Date().toISOString(), rows: result };
}

router.get('/rsi-momentum-signal-proximity', async (req, res) => {
    try {
        const fresh = req.query.fresh === '1';
        if (!fresh && cache.payload && Date.now() - cache.at < TTL_MS) return res.json(cache.payload);
        if (!cache.computing) {
            cache.computing = compute()
                .then((payload) => { cache = { at: Date.now(), payload, computing: null }; return payload; })
                .catch((err) => { cache.computing = null; throw err; });
        }
        res.json(await cache.computing);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.priceForRsi = priceForRsi;
module.exports.wilderAverages = wilderAverages;
