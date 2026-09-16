'use strict';

// Lê o snapshot estático de grupos de moedas correlacionadas gerado por
// backend/scripts/computeCorrelationGroups.js (backend/data/correlation-groups-cache.json).
// Usado pelo filtro "avoidCorrelatedEntries" do backtest "todas as moedas" (analyseRsiThresholdBacktestMarket.js).
//
// Fail-open: se o cache não existe ainda (script nunca rodou), toda moeda volta sem grupo
// (null) — o filtro simplesmente não bloqueia nada, em vez de quebrar o backtest.

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'correlation-groups-cache.json');

let _cache = null; // null = ainda não carregado; depois vira sempre um objeto (real ou fallback vazio)
let _warned = false;

function load() {
    if (_cache !== null) return _cache;
    try {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        _cache = JSON.parse(raw);
    } catch {
        if (!_warned) {
            console.warn('[correlationGroups] sem cache em backend/data/correlation-groups-cache.json — rode `node backend/scripts/computeCorrelationGroups.js`. Filtro de correlação fica sem efeito até lá.');
            _warned = true;
        }
        _cache = { symbolGroup: {}, groups: [], computedAt: null };
    }
    return _cache;
}

/** Grupo (número) da moeda, ou null se ela não pertence a nenhum grupo correlacionado (moeda
 *  "solta"/idiossincrática, ou cache ainda não calculado). */
function getGroupForSymbol(symbol) {
    return load().symbolGroup[symbol] ?? null;
}

function getMeta() {
    const { groups, computedAt } = load();
    return { groups, computedAt };
}

/** Força reler o arquivo do disco — usado só depois de rodar o script de recálculo enquanto o
 *  processo do backend continua no ar. */
function reload() {
    _cache = null;
    return load();
}

module.exports = { getGroupForSymbol, getMeta, reload };
