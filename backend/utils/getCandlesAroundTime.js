'use strict';

const fetchKlines = require('../binance/fetchKlines');
const { fetchFromGate } = require('../gate/getGateCandles');
const convertIntervalToMiliseconds = require('./convert-interval-to-miliseconds');

// Mesmo teto de candles buscados numa chamada só do resto do projeto (ver
// candleRetentionLimits.js) — protege contra uma janela [fromMs,toMs] absurdamente longa.
const MAX_CANDLES = 3000;

/**
 * Busca candles ANCORADOS num período específico [fromMs, toMs] (ex.: entrada→saída de um trade
 * do backtest), com `padCandles` de folga pra cada lado — pra poder arrastar o gráfico e ver o
 * que aconteceu antes/depois do trade sem precisar buscar de novo.
 *
 * Diferente de getCandles/getGateCandles (cache rolante em disco, sempre "os últimos N candles
 * até AGORA" — ver candleRetentionLimits.js): esta busca é direta na corretora, sem cache, e
 * funciona pra QUALQUER trade histórico, mesmo um que já saiu da janela de retenção do cache ou
 * aconteceu há muito tempo — o cache rolante nunca teria esses candles guardados, e pedir "os
 * últimos N até agora" simplesmente não alcança de volta até lá quando o trade é antigo.
 *
 * O teto de MAX_CANDLES protege contra uma janela [fromMs,toMs] absurdamente longa (ex.: trade
 * que durou meses num intervalo de 1m) — corta a FOLGA (`padCandles`) primeiro, mantendo o
 * período do próprio trade inteiro visível o quanto der antes de cortar dele também.
 *
 * @param {string} symbol    Símbolo Binance (ex.: 'BTCUSDT')
 * @param {string} interval  Ex.: '15m', '1h'
 * @param {string|null} source 'gate' busca na Gate.io; qualquer outro valor (ou null) = Binance
 * @param {number} fromMs    Início do período (ms) — ex.: entrada do trade
 * @param {number} toMs      Fim do período (ms) — ex.: saída do trade (ou "agora" se ainda aberto)
 * @param {number} [padCandles=100] Candles de folga pra cada lado, além do período em si
 */
async function getCandlesAroundTime(symbol, interval, source, fromMs, toMs, padCandles = 100) {
    const intervalMs = await convertIntervalToMiliseconds(interval);
    const spanCandles = Math.max(1, Math.ceil((Math.max(toMs, fromMs) - fromMs) / intervalMs));
    let pad = Math.max(0, Math.round(Number(padCandles) || 0));
    let limit = spanCandles + 2 * pad;
    if (limit > MAX_CANDLES) {
        pad = Math.max(0, Math.floor((MAX_CANDLES - spanCandles) / 2));
        limit = Math.min(MAX_CANDLES, spanCandles + 2 * pad);
    }
    const endTime = toMs + pad * intervalMs;

    const candles = source === 'gate'
        ? await fetchFromGate(symbol, interval, limit, Math.floor(endTime / 1000))
        : await fetchKlines(symbol, interval, limit, endTime);

    return candles.map(({ openTime, open, high, low, close, volume }) =>
        ({ openTime, open, high, low, close, volume }));
}

module.exports = { getCandlesAroundTime };
