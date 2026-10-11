'use strict';

// Tolerância da regra "abaixo da linha" do filtro BB inf. (entry.bbLowerFilter.belowLineTolPct /
// options.bbLowerFilter.belowLineTolPct). Compartilhado entre o backtest (Estatísticas) e o bot
// ao vivo (checkBbLowerFilter) pra regra ser idêntica nos dois lados.
const BB_BELOW_LINE_TOL_OPTIONS = [0, 1, 2, 3];
// Padrão 1%: config antiga sem o campo passa a tolerar 1% acima da linha. 0 explícito = estrito.
const DEFAULT_BB_BELOW_LINE_TOL_PCT = 1;

function normalizeBbBelowLineTolPct(raw) {
    if (raw == null || raw === '') return DEFAULT_BB_BELOW_LINE_TOL_PCT;
    const n = Number(raw);
    return BB_BELOW_LINE_TOL_OPTIONS.includes(n) ? n : DEFAULT_BB_BELOW_LINE_TOL_PCT;
}

/** true = preço NÃO passa na regra belowLine. Sem tolerância: precisa estar estritamente abaixo
 *  da linha (price >= line bloqueia). Com tolerância X%: aceita até line × (1 + X/100). */
function isAboveBbLineWithTolerance(price, lineValue, tolPct) {
    const tol = normalizeBbBelowLineTolPct(tolPct);
    return tol > 0 ? price > lineValue * (1 + tol / 100) : price >= lineValue;
}

module.exports = { BB_BELOW_LINE_TOL_OPTIONS, DEFAULT_BB_BELOW_LINE_TOL_PCT, normalizeBbBelowLineTolPct, isAboveBbLineWithTolerance };
