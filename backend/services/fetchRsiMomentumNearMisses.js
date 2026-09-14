'use strict';

/**
 * GET /services/rsi-momentum-near-misses
 *
 * Lista as moedas que o RSI Momentum quase comprou — RSI já cruzou o limiar de entrada mas foi
 * barrado por outro filtro (bandWidth, rsi5m, MACD, RSI 1h, EMA cross, S/R, spikeGuard,
 * anti-repique). Gravado pelo scanner (ver backend/bot/rsi-momentum/nearMissLogger.js) a cada
 * varredura em que isso acontece. Alimenta o formulário "Momentum RSI · Quase-compra" em
 * Analisar Indicadores (separador de período: hoje / 3 dias / 7 dias / 30 dias / tudo).
 *
 * Query: `period` (hoje|3d|7d|30d|tudo, default 7d), `reason` (opcional, filtra por 1 motivo).
 * Devolve 1 linha por SÍMBOLO (a mais recente do período) + contagem de ocorrências no período,
 * pra virar filtro de moedas na tabela — o histórico completo por linha fica em `rows`.
 */

const router = require('express').Router();
const { sbReq } = require('../bot/shared/supabaseRest');
const { loadGlobalConfigBody } = require('../bot/rsi-momentum/strategyPresets');
const { normalizeRsiMomentumConfig } = require('../bot/rsi-momentum/tradeConfigSchema');

const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';
const PERIODS = new Set(['hoje', '3d', '7d', '30d', 'tudo']);
const PERIOD_MS = { '3d': 3 * 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };
const BRT_OFFSET_MS = 3 * 60 * 60_000;
const MAX_ROWS = 3000;

/** `entry.interval` (15m por padrão, prefixo do nome do filtro — representa o TRADE em si) +
 *  `entry.bandWidth` (interval/period/stdDev, 5m por padrão — usado pelo frontend SÓ pra
 *  recalcular a coluna "Larg%" no intervalo/parâmetros REAIS que o bot checa, já que esse
 *  sub-filtro roda num intervalo diferente do trade) da config GLOBAL ativa agora. Fail-open pro
 *  default do schema se a config não carregar. */
async function currentEntryConfig() {
    let body;
    try {
        body = normalizeRsiMomentumConfig(await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID));
    } catch {
        body = normalizeRsiMomentumConfig({});
    }
    return { interval: body.entry.interval, bandWidth: body.entry.bandWidth };
}

/** Início do dia em BRT (America/Sao_Paulo, UTC-3), devolvido como instante UTC. */
function startOfTodayBrt() {
    const nowBrt = new Date(Date.now() - BRT_OFFSET_MS);
    const startBrt = Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate(), 0, 0, 0);
    return new Date(startBrt + BRT_OFFSET_MS);
}

function sinceForPeriod(period) {
    if (period === 'tudo') return null;
    if (period === 'hoje') return startOfTodayBrt();
    return new Date(Date.now() - PERIOD_MS[period]);
}

router.get('/rsi-momentum-near-misses', async (req, res) => {
    const period = PERIODS.has(req.query.period) ? req.query.period : '7d';
    const reason = req.query.reason ? String(req.query.reason) : null;
    const since = sinceForPeriod(period);

    let query = `?select=symbol,exchange,interval,detected_at,rsi,threshold,reason,blockers,filters_ok,filters_total&order=detected_at.desc&limit=${MAX_ROWS}`;
    if (since) query += `&detected_at=gte.${encodeURIComponent(since.toISOString())}`;
    if (reason) query += `&reason=eq.${encodeURIComponent(reason)}`;

    try {
        const [rows, entryConfig] = await Promise.all([
            sbReq('GET', 'rsi_momentum_near_misses', null, query),
            currentEntryConfig(),
        ]);

        const reasonCounts = {};
        const bySymbol = new Map();
        for (const row of rows) {
            reasonCounts[row.reason] = (reasonCounts[row.reason] ?? 0) + 1;
            const cur = bySymbol.get(row.symbol);
            if (!cur) {
                bySymbol.set(row.symbol, {
                    symbol: row.symbol,
                    exchange: row.exchange,
                    interval: row.interval,
                    lastDetectedAt: row.detected_at,
                    lastReason: row.reason,
                    lastRsi: row.rsi,
                    lastThreshold: row.threshold,
                    lastBlockers: row.blockers,
                    occurrences: 1,
                });
            } else {
                cur.occurrences += 1;
            }
        }

        const coins = [...bySymbol.values()].sort((a, b) => b.lastDetectedAt.localeCompare(a.lastDetectedAt));
        res.json({
            period,
            since: since ? since.toISOString() : null,
            reason,
            total: rows.length,
            symbolsTotal: coins.length,
            reasonCounts,
            coins,
            // Config ATUAL (não a de quando cada linha foi detectada) — ver comentário em
            // currentEntryConfig acima. entryInterval prefixa o nome do filtro (intervalo do
            // TRADE); bandWidth alimenta só a coluna "Larg%" (intervalo/período/desvio REAIS do
            // sub-filtro de largura de banda, que roda num intervalo diferente do trade).
            entryInterval: entryConfig.interval,
            bandWidth: {
                interval: entryConfig.bandWidth.interval,
                period: entryConfig.bandWidth.period,
                stdDev: entryConfig.bandWidth.stdDev,
                lookback: entryConfig.bandWidth.lookback,
            },
        });
    } catch (err) {
        console.error('[rsi-momentum-near-misses]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
