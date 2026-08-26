'use strict';

/**
 * Duração das operações que de fato FECHARAM (outcome 'target' ou 'stop', com entrada E saída
 * conhecidas) — do instante da entrada até o instante da saída. Ignora 'open' (ainda não saiu,
 * sem exitDate) e 'not_filled' (nunca entrou) — não faz sentido medir "quanto durou" uma posição
 * que não tem fim (ou nem começo).
 *
 * @param {Array<{filled?: boolean, entryDate?: string, exitDate?: string}>} filledOccurrences
 */
function computeAvgTradeDurationMs(filledOccurrences) {
    const durations = [];
    for (const o of filledOccurrences) {
        if (!o.filled || !o.entryDate || !o.exitDate) continue;
        const entryMs = new Date(o.entryDate).getTime();
        const exitMs = new Date(o.exitDate).getTime();
        if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs < entryMs) continue;
        durations.push(exitMs - entryMs);
    }

    if (!durations.length) {
        return { count: 0, avgDurationMs: 0, minDurationMs: 0, maxDurationMs: 0 };
    }

    const avgDurationMs = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
    return {
        count: durations.length,
        avgDurationMs,
        minDurationMs: Math.min(...durations),
        maxDurationMs: Math.max(...durations),
    };
}

module.exports = { computeAvgTradeDurationMs };
