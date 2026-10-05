'use strict';

/**
 * GET /services/rsi-momentum-missed-signals
 *
 * Sinais CONFIRMADOS do RSI Momentum que não viraram compra (pullback expirou, limite sumiu,
 * sinal perdido no 1º tick, entrada recusada) — gravados por
 * backend/bot/rsi-momentum/missedSignalLogger.js. Alimenta o favorito "SSE" (Sinais sem entrada)
 * da tabela de moedas; o clique numa moeda desenha a seta amarela em cada `signal_time`.
 *
 * Bots EXCLUSIVOS (curated): além do que o bot gravou, junta os sinais que o motor de entrada
 * confirma nos candles e que não viraram ordem (`reason: 'NO_ORDER'`, ver
 * backend/bot/rsi-momentum/curatedSignalReplay.js) — cada linha traz o `interval` do bot
 * exclusivo (ex. 1m), que é o intervalo em que o gráfico abre ao clicar.
 *
 * Query: `days` (1..90, default 14), `symbol` (opcional — só os sinais daquela moeda).
 * Devolve `{ symbols: [{ symbol, exchange, interval, count, last }], rows }` — `symbols` ordenado
 * do sinal mais recente pro mais antigo.
 */

const router = require('express').Router();
const { sbReq } = require('../bot/shared/supabaseRest');
const { listCuratedMissedSignals } = require('../bot/rsi-momentum/curatedSignalReplay');

const MAX_ROWS = 2000;

router.get('/rsi-momentum-missed-signals', async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase().replace(/[^A-Z0-9_]/g, '') : null;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    let query = `?select=*&order=signal_time.desc&limit=${MAX_ROWS}&signal_time=gte.${encodeURIComponent(since)}`;
    if (symbol) query += `&symbol=eq.${symbol}`;

    try {
        const logged = await sbReq('GET', 'rsi_momentum_missed_signals', null, query);
        const replayed = await listCuratedMissedSignals({ sinceMs: Date.parse(since), symbol })
            .catch((err) => { console.warn('[missed-signals] replay curados:', err.message); return []; });
        // O que o bot gravou ganha do replay (mesmo símbolo + candle do sinal).
        const seen = new Set(logged.map(r => `${r.symbol}|${Date.parse(r.signal_time)}`));
        const rows = [...logged, ...replayed.filter(r => !seen.has(`${r.symbol}|${Date.parse(r.signal_time)}`))]
            .sort((a, b) => Date.parse(b.signal_time) - Date.parse(a.signal_time));
        const bySymbol = new Map();
        for (const row of rows) {
            const cur = bySymbol.get(row.symbol);
            if (cur) cur.count++;
            else bySymbol.set(row.symbol, { symbol: row.symbol, exchange: row.exchange, interval: row.interval, count: 1, last: row });
        }
        res.json({ symbols: [...bySymbol.values()], rows });
    } catch (err) {
        // Tabela ainda não criada (migração não rodou) → lista vazia em vez de quebrar a tela.
        if (/rsi_momentum_missed_signals/.test(err.message) && /(does not exist|42P01|PGRST205)/.test(err.message)) {
            return res.json({ symbols: [], rows: [], missingTable: true });
        }
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
