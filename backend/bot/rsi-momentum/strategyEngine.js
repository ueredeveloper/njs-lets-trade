'use strict';

const RSI = require('technicalindicators').RSI;
const { closedCandlesOnly, intervalMs } = require('../ma-cross/strategyEngine');
const { computeStopLossFloor } = require('../shared/stopLossFloor');
const { bollingerCycleOccurrences } = require('../../utils/indicatorGrowthEngines');
const { averageWithoutOutliers } = require('../../utils/removeOutliersIQR');

const RSI_PERIOD = 14;
// Pullback e expiração da ordem limite de entrada são avaliados minuto a minuto, SEMPRE em
// candles de 1m — independente do entry.interval do sinal (15m, 1h etc.). Uma ordem limite
// resting na corretora já preenche em tempo real por conta própria; o que muda aqui é de
// quantos em quantos "candles fechados" contamos o prazo de expiração (checkEntryLimitExpired)
// e a granularidade mínima que o bot considera pra notar/expirar o pedido.
const PULLBACK_INTERVAL = '1m';
const BB_MIN_CANDLES_PADDING = 5;

function computeRsiSeries(closedCandles) {
    const closes = closedCandles.map(c => parseFloat(c.close));
    return RSI.calculate({ values: closes, period: RSI_PERIOD });
}

function getRequiredSpecs(config) {
    const entry = config.entry;
    const cooldown = Math.max(0, Math.round(Number(entry.reentryCooldownCandles ?? 0)));
    const limit = RSI_PERIOD * 3 + cooldown + 30;
    const specs = new Map([[entry.interval, limit]]);

    const add = (iv, lim) => specs.set(iv, Math.max(specs.get(iv) ?? 0, lim));

    if (entry.pullback?.enabled) {
        const waitCandles = Math.max(0, Math.round(Number(entry.limitWaitCandles ?? 0)));
        add(PULLBACK_INTERVAL, waitCandles + 10);
    }

    const bw = entry.bandWidth;
    if (bw?.enabled) {
        add(bw.interval, bw.lookback + bw.period + BB_MIN_CANDLES_PADDING);
    }

    return [...specs.entries()].map(([interval, lim]) => ({ interval, limit: lim }));
}

/**
 * Filtro opcional de largura de banda (mesmo motor do filtro de mercado "Larg%" — ver
 * backend/services/fetchBollingerBandWidthFilter.js e o backtest analyseRsiThresholdBacktest.js):
 * % médio de valorização de cada ciclo fundo→topo BB(period,stdDev), sem outliers. É uma
 * propriedade da moeda no período, não do candle do momento — não muda a cada tick, mas é
 * barato o bastante pra recalcular sempre (poucos candles fechados). Desligado → sempre libera.
 */
function checkBandWidthFilter(config, cMap) {
    const bw = config.entry?.bandWidth;
    if (!bw?.enabled) return { allowed: true };

    const closed = closedCandlesOnly(cMap[bw.interval] ?? []);
    const occurrences = bollingerCycleOccurrences(closed, { period: bw.period, stdDev: bw.stdDev });
    if (!occurrences?.length) {
        return { allowed: false, reason: 'BANDWIDTH_NO_DATA' };
    }

    const avgWidthPct = Math.round(averageWithoutOutliers(occurrences) * 100) / 100;
    if (avgWidthPct < bw.minPct) {
        return { allowed: false, reason: 'BANDWIDTH_TOO_LOW', avgWidthPct, minPct: bw.minPct };
    }
    return { allowed: true, avgWidthPct, minPct: bw.minPct };
}

/**
 * Sinal de entrada: RSI(14) do entry.interval cruza para CIMA de entry.rsiThreshold no último
 * candle FECHADO — mesma detecção do backtest (ver analyseRsiThresholdBacktest.js). Sem
 * pullback (padrão), a entrada é a mercado no preço do fechamento (limitPrice: null). Com
 * pullback, `limitPrice` é o preço-limite (signalPrice × (1 − belowPct/100)) — o chamador arma
 * uma ordem GTC nesse preço e espera reteste minuto a minuto (ver checkEntryLimitExpired).
 */
function evaluateEntrySignal(config, cMap) {
    const entry = config.entry;
    if (entry.enabled === false) return { allowed: false, reason: 'ENTRY_OFF' };

    const iv = entry.interval;
    const closed = closedCandlesOnly(cMap[iv] ?? []);
    if (closed.length < RSI_PERIOD + 2) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

    const rsiValues = computeRsiSeries(closed);
    if (rsiValues.length < 2) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

    const last = rsiValues[rsiValues.length - 1];
    const prev = rsiValues[rsiValues.length - 2];
    const threshold = entry.rsiThreshold;

    if (!(prev < threshold && last >= threshold)) {
        return { allowed: false, reason: 'RSI_NOT_CROSSING', rsi: last, threshold };
    }

    const bandWidthCheck = checkBandWidthFilter(config, cMap);
    if (!bandWidthCheck.allowed) {
        return { allowed: false, reason: bandWidthCheck.reason, rsi: last, threshold, bandWidth: bandWidthCheck };
    }

    const signalCandle = closed[closed.length - 1];
    const signalPrice = parseFloat(signalCandle.close);
    const signalOpenTime = Number(signalCandle.openTime);
    const pullbackPct = entry.pullback?.enabled ? Math.max(0.01, entry.pullback.belowPct) : 0;
    const limitPrice = pullbackPct > 0 ? signalPrice * (1 - pullbackPct / 100) : null;

    const entryDesc = pullbackPct > 0
        ? `RSI(${RSI_PERIOD}) ${iv} cruzou ${threshold} (${last.toFixed(2)}) — pullback -${pullbackPct}%`
        : `RSI(${RSI_PERIOD}) ${iv} cruzou ${threshold} (${last.toFixed(2)})`;

    return {
        allowed: true,
        close: signalPrice,
        limitPrice,
        rsi: last,
        threshold,
        bandWidth: bandWidthCheck,
        signalOpenTime,
        signalPrice,
        entryDesc,
    };
}

/**
 * Ordem limite resting (armada no sinal): expirou depois de entry.limitWaitCandles candles de
 * 1 MINUTO fechados com openTime >= signalOpenTime? Diferente do bollinger-bands (que conta no
 * candle do entry.interval) — aqui a contagem é sempre em 1m, por isso getRequiredSpecs busca
 * um cMap['1m'] à parte quando o pullback está ligado.
 */
function checkEntryLimitExpired(config, cMap, entryLimit) {
    const need = Math.max(1, Math.round(Number(config.entry?.limitWaitCandles ?? 20)));
    const sinceMs = Number(entryLimit?.signalOpenTime)
        || (entryLimit?.placedAt ? new Date(entryLimit.placedAt).getTime() : NaN);
    if (!Number.isFinite(sinceMs)) {
        return { expired: false, need, have: 0, remain: need, interval: PULLBACK_INTERVAL };
    }
    const closed = closedCandlesOnly(cMap[PULLBACK_INTERVAL] ?? []);
    const have = closed.filter(c => Number(c.openTime) >= sinceMs).length;
    const remain = Math.max(0, need - have);
    return { expired: remain <= 0, need, have, remain, interval: PULLBACK_INTERVAL };
}

/**
 * Cooldown pós-venda (qualquer motivo — alvo, stop, manual) em candles do entry.interval.
 * Diferente do bollinger-bands (que só aplica após STOP_LOSS, ver checkReentryCooldown em
 * backend/bot/bollinger-bands/strategyEngine.js): no RSI Momentum um take-profit rápido pode
 * disparar um novo cruzamento de RSI poucos minutos depois (RSI ainda alto) e reentrar sem
 * pausa, então a moeda fica sempre `reentryCooldownCandles` candles em standby após qualquer
 * saída, não só após stop-loss.
 */
function checkReentryCooldown(config, cMap, lastExitTime, lastExitReason) {
    const need = Math.max(0, Math.round(Number(config.entry?.reentryCooldownCandles ?? 0)));
    if (need <= 0 || !lastExitTime) {
        return { waiting: false, need, have: 0, remain: 0 };
    }
    const exitMs = new Date(lastExitTime).getTime();
    if (!Number.isFinite(exitMs)) {
        return { waiting: false, need, have: 0, remain: 0 };
    }

    const iv = config.entry.interval;
    const closed = closedCandlesOnly(cMap[iv] ?? []);
    const have = closed.filter(c => Number(c.openTime) >= exitMs).length;
    const remain = Math.max(0, need - have);
    return {
        waiting: remain > 0,
        need,
        have,
        remain,
        interval: iv,
        reason: remain > 0 ? 'REENTRY_COOLDOWN' : null,
    };
}

/**
 * Alvo/stop FIXOS a partir do preço de entrada — entryPrice*(1+targetPct%) /
 * entryPrice*(1-maxLossPct%). Sem trailing, sem ancorar em EMA/banda (diferente do
 * bollinger-bands): não há "nível" nenhum que se mova a cada candle novo pra perseguir, então
 * a bracket colocada na corretora nunca precisa ser recriada por deriva.
 */
function computeBracketPrices(config, entryPrice) {
    if (!(entryPrice > 0)) return { targetPrice: null, stopPrice: null };
    const targetPct = Math.max(0.1, Number(config.exit?.restingBracket?.targetPct ?? 5));
    const targetPrice = entryPrice * (1 + targetPct / 100);
    const stopPrice = config.stopLoss?.enabled
        ? computeStopLossFloor(entryPrice, entryPrice, { ...config.stopLoss, trailing: false })
        : null;
    return { targetPrice, stopPrice };
}

/** Saída via candle — fallback usado só quando não há bracket resting (desligada ou falhou ao
 *  colocar): máxima do candle em formação alcança o alvo, ou mínima rompe o stop. No empate
 *  (mesmo candle) assume o pior caso (stop primeiro), mesmo critério do backtest. */
function evaluateExit(config, cMap, entryPrice) {
    const iv = config.entry.interval;
    const raw = cMap[iv] ?? [];
    if (!raw.length) return { exit: false };

    const live = raw[raw.length - 1];
    const close = parseFloat(live.close);
    const high = parseFloat(live.high ?? live.close);
    const low = parseFloat(live.low ?? live.close);

    const { targetPrice, stopPrice } = computeBracketPrices(config, entryPrice);

    if (stopPrice != null && low <= stopPrice) {
        return {
            exit: true, reason: 'STOP_LOSS', close,
            dropPct: entryPrice ? ((close - entryPrice) / entryPrice) * 100 : null,
            stopFloor: stopPrice,
        };
    }
    if (targetPrice != null && high >= targetPrice) {
        return {
            exit: true, reason: 'RSI_TARGET', close,
            targetLevelValue: targetPrice,
            exitDesc: `Alvo fixo +${config.exit.restingBracket.targetPct}% de lucro`,
        };
    }
    return { exit: false, close };
}

module.exports = {
    RSI_PERIOD,
    PULLBACK_INTERVAL,
    intervalMs,
    closedCandlesOnly,
    getRequiredSpecs,
    checkBandWidthFilter,
    evaluateEntrySignal,
    evaluateExit,
    checkEntryLimitExpired,
    checkReentryCooldown,
    computeBracketPrices,
    computeStopLossFloor,
};
