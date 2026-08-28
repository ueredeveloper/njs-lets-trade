'use strict';

/**
 * Monta o objeto `options.trailingStop` de analyseRsiThresholdBacktest a partir dos query params
 * dos endpoints /rsi-threshold-backtest e /rsi-threshold-backtest-market (que compartilham o mesmo
 * contrato). Sem `trailingStopEnabled=1` retorna null (stop fixo).
 *
 * Modos (ver JSDoc de options.trailingStop.mode em analyseRsiThresholdBacktest.js):
 *   'continuous' — rampa linear única (startPct/coinStepPct/stopStepPct)
 *   'twoPhase'   — 2 inclinações ancoradas na entrada (pivotPct + degraus das fases A e B)
 *   'peakTrail'  — Chandelier de % em 2 fases (pivotGainPct + wNearPct/wFarPct)
 *   'atrTrail'   — como peakTrail, fase B = atrMult × ATR% (limitada a atrMaxPct)
 *
 * @param {Record<string,string>} q  req.query
 * @param {number|null} fallbackStopLossPct  usado como startPct quando não vier explícito
 * @returns {object|null}
 */
function parseTrailingStopQuery(q, fallbackStopLossPct) {
    if (q.trailingStopEnabled !== '1') return null;

    const num = (v, dflt) => (v != null && v !== '' && Number.isFinite(parseFloat(v)) ? parseFloat(v) : dflt);
    const mode = ['continuous', 'twoPhase', 'peakTrail', 'atrTrail'].includes(q.trailingStopMode)
        ? q.trailingStopMode : 'continuous';

    return {
        enabled: true,
        mode,
        startPct:    num(q.trailingStopStartPct, fallbackStopLossPct != null ? fallbackStopLossPct : 5),
        coinStepPct: num(q.trailingStopCoinStepPct, 1),
        stopStepPct: num(q.trailingStopStopStepPct, 1),
        // twoPhase
        pivotPct:     num(q.trailingStopPivotPct, 1),
        aCoinStepPct: num(q.trailingStopACoinStepPct, 3),
        aStopStepPct: num(q.trailingStopAStopStepPct, 2.5),
        bCoinStepPct: num(q.trailingStopBCoinStepPct, 3),
        bStopStepPct: num(q.trailingStopBStopStepPct, 1),
        // peakTrail / atrTrail
        pivotGainPct: num(q.trailingStopPivotGainPct, 5),
        wNearPct:     num(q.trailingStopWNearPct, 4),
        wFarPct:      num(q.trailingStopWFarPct, 9),
        atrMult:      num(q.trailingStopAtrMult, 2),
        atrMaxPct:    num(q.trailingStopAtrMaxPct, 12),
    };
}

module.exports = { parseTrailingStopQuery };
