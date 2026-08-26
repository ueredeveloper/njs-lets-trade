'use strict';

// Dia civil em BRT (America/Sao_Paulo, UTC-3) — mesmo fuso usado pra apresentar horários ao
// usuário (ver CLAUDE.md). Simplesmente desloca o instante 3h pra trás antes de truncar em
// "YYYY-MM-DD" (o Brasil não observa horário de verão desde 2019, então o offset fixo -3 é
// sempre correto).
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function toBrtDayKey(isoOrMs) {
    const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
    if (!Number.isFinite(ms)) return null;
    return new Date(ms - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Quantas ENTRADAS (sinais preenchidos) caem no mesmo dia civil (BRT) — pensado pra dimensionar
 * o caixa em USDT necessário por dia: se em média/no pior dia entram N moedas ao mesmo tempo com
 * `positionSizeUsd` cada, o usuário precisa ter N × positionSizeUsd disponível naquele dia. Conta
 * TODAS as entradas preenchidas recebidas (não filtra por símbolo) — no modo "Todas as moedas"
 * isso naturalmente mistura moedas diferentes que entraram no mesmo dia; no modo 1 símbolo, conta
 * reentradas do mesmo par no mesmo dia.
 *
 * `multiEntryDaysPct` (>=2 entradas, sem teto) sozinho é pouco informativo — 2 e 10 entradas/dia
 * contam igual. `entriesRange` deixa o usuário escolher um teto (ex.: "2 a 3", "2 a 5") pra medir
 * especificamente a frequência de dias DENTRO dessa faixa, além do pico real (maxEntriesPerDay,
 * que já não muda) — ver StatisticsPanel.jsx (RSI_MOM_ENTRIES_RANGE_MAX_OPTIONS).
 *
 * @param {Array<{entryDate?: string, signalDate?: string}>} filledOccurrences  Só ocorrências
 *   com `filled: true` (sem entrada não tem "dia de entrada").
 * @param {number} positionSizeUsd  Mesmo aporte hipotético usado no restante do backtest.
 * @param {object} [entriesRange]  Faixa opcional pro card extra de frequência.
 * @param {number} [entriesRange.min=2]
 * @param {number|null} [entriesRange.max=null]  null = sem teto (mesmo que multiEntryDaysPct).
 */
function computeDailyEntryStats(filledOccurrences, positionSizeUsd, entriesRange = null) {
    const perDay = new Map();
    for (const o of filledOccurrences) {
        const dayKey = toBrtDayKey(o.entryDate ?? o.signalDate);
        if (!dayKey) continue;
        perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
    }

    const counts = [...perDay.values()];
    const daysWithEntries = counts.length;
    if (daysWithEntries === 0) {
        return {
            daysWithEntries: 0,
            maxEntriesPerDay: 0,
            avgEntriesPerDay: 0,
            multiEntryDaysPct: 0,
            suggestedDailyCapitalUsd: 0,
            entriesRange: null,
            entriesRangeDaysPct: 0,
        };
    }

    const totalEntries = counts.reduce((s, c) => s + c, 0);
    const maxEntriesPerDay = Math.max(...counts);
    const avgEntriesPerDay = parseFloat((totalEntries / daysWithEntries).toFixed(2));
    const multiEntryDays = counts.filter((c) => c >= 2).length;
    const multiEntryDaysPct = parseFloat(((multiEntryDays / daysWithEntries) * 100).toFixed(1));
    const suggestedDailyCapitalUsd = parseFloat((maxEntriesPerDay * positionSizeUsd).toFixed(2));

    const rangeMin = Math.max(1, Math.round(Number(entriesRange?.min ?? 2)));
    const rangeMax = entriesRange?.max != null ? Math.max(rangeMin, Math.round(Number(entriesRange.max))) : null;
    const rangeDays = counts.filter((c) => c >= rangeMin && (rangeMax == null || c <= rangeMax)).length;
    const entriesRangeDaysPct = parseFloat(((rangeDays / daysWithEntries) * 100).toFixed(1));

    return {
        daysWithEntries,
        maxEntriesPerDay,
        avgEntriesPerDay,
        multiEntryDaysPct,
        suggestedDailyCapitalUsd,
        entriesRange: { min: rangeMin, max: rangeMax },
        entriesRangeDaysPct,
    };
}

module.exports = { computeDailyEntryStats, toBrtDayKey };
