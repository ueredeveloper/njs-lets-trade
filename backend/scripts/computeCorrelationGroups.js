'use strict';

// Calcula grupos de moedas correlacionadas (candles diários, correlação de Pearson dos
// log-retornos + agrupamento hierárquico average-linkage) e grava o resultado em
// backend/data/correlation-groups-cache.json — lido por backend/utils/correlationGroups.js
// pro filtro "avoidCorrelatedEntries" do backtest "todas as moedas" (Estatísticas).
//
// É um snapshot ESTÁTICO: correlação muda com o tempo, então vale re-rodar este script de vez
// em quando (não há cron automático ainda — rodar manualmente: `node backend/scripts/computeCorrelationGroups.js`).
//
// Uso: node backend/scripts/computeCorrelationGroups.js [--top=200] [--threshold=0.55] [--interval=1d] [--limit=120]

const path = require('path');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const getTickers = require('../binance/cachedTicker24hr');
const fetchKlines = require('../binance/fetchKlines');
const atomicWriteFile = require('../utils/atomicWriteFile');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'correlation-groups-cache.json');
const CONCURRENCY = 10;

function parseArg(name, def) {
    const m = process.argv.find((a) => a.startsWith(`--${name}=`));
    return m ? m.split('=')[1] : def;
}

const TOP_N = parseInt(parseArg('top', '200'), 10);
const THRESHOLD = parseFloat(parseArg('threshold', '0.55'));
const INTERVAL = parseArg('interval', '1d');
const LIMIT = parseInt(parseArg('limit', '120'), 10);

async function runWithConcurrency(items, worker, concurrency) {
    const results = new Array(items.length);
    let idx = 0;
    async function next() {
        while (idx < items.length) {
            const cur = idx++;
            results[cur] = await worker(items[cur]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
    return results;
}

/** log-retorno por candle, indexado por openTime — pairwise deletion na correlação lida com
 *  moedas com histórico mais curto (listagem recente) sem exigir alinhamento perfeito. */
async function fetchReturns(symbol) {
    try {
        const klines = await fetchKlines(symbol, INTERVAL, LIMIT);
        if (klines.length < 30) return null;
        const map = new Map();
        let prevClose = null;
        for (const k of klines) {
            const close = parseFloat(k.close);
            if (prevClose != null) {
                const r = Math.log(close / prevClose);
                if (Number.isFinite(r)) map.set(k.openTime, r);
            }
            prevClose = close;
        }
        return map;
    } catch {
        return null;
    }
}

function pearsonPairwise(retA, retB) {
    let sum = 0, sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0, n = 0;
    for (const [t, a] of retA) {
        const b = retB.get(t);
        if (b === undefined) continue;
        sumA += a; sumB += b; sumAA += a * a; sumBB += b * b; sumAB += a * b; n++;
    }
    if (n < 20) return null;
    const meanA = sumA / n, meanB = sumB / n;
    const covar = sumAB / n - meanA * meanB;
    const varA = sumAA / n - meanA * meanA;
    const varB = sumBB / n - meanB * meanB;
    if (varA <= 0 || varB <= 0) return null;
    return covar / Math.sqrt(varA * varB);
}

/** Agrupamento hierárquico average-linkage com atualização Lance-Williams (O(n²) por merge em
 *  vez de recalcular a distância média membro-a-membro a cada passo) — necessário pra rodar em
 *  ~top N (pode passar de 150-200) moedas em tempo razoável. distância = 1 - correlação (par sem
 *  correlação calculável = distância 1, ou seja, "sem relação"). Para no primeiro merge cujo
 *  distância excede maxDist — os clusters ativos nesse ponto SÃO o corte final, sem precisar
 *  reconstruir nada depois. */
function clusterAverageLinkage(symbols, corrMatrix, maxDist) {
    let clusters = symbols.map((s) => ({ members: [s] }));
    const D = corrMatrix.map((row) => row.map((c) => (c == null ? 1 : 1 - c)));
    const sizes = symbols.map(() => 1);
    const active = new Set(clusters.map((_, i) => i));

    while (active.size > 1) {
        let bestDist = Infinity, bi = -1, bj = -1;
        const activeArr = [...active];
        for (let x = 0; x < activeArr.length; x++) {
            for (let y = x + 1; y < activeArr.length; y++) {
                const i = activeArr[x], j = activeArr[y];
                if (D[i][j] < bestDist) { bestDist = D[i][j]; bi = i; bj = j; }
            }
        }
        if (bestDist > maxDist) break;

        const sizeI = sizes[bi], sizeJ = sizes[bj];
        for (const k of active) {
            if (k === bi || k === bj) continue;
            const dik = D[Math.min(bi, k)][Math.max(bi, k)];
            const djk = D[Math.min(bj, k)][Math.max(bj, k)];
            D[Math.min(bi, k)][Math.max(bi, k)] = (sizeI * dik + sizeJ * djk) / (sizeI + sizeJ);
        }
        clusters[bi] = { members: [...clusters[bi].members, ...clusters[bj].members] };
        sizes[bi] += sizeJ;
        active.delete(bj);
    }
    return [...active].map((i) => clusters[i].members);
}

async function main() {
    console.log(`[correlationGroups] top=${TOP_N} threshold=${THRESHOLD} interval=${INTERVAL} limit=${LIMIT}`);

    const { list: allSymbols } = await getActiveUsdtPairs();
    let symbols = allSymbols;
    try {
        const tickers = await getTickers();
        const volMap = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume) || 0]));
        symbols = [...allSymbols].sort((a, b) => (volMap.get(b) ?? 0) - (volMap.get(a) ?? 0)).slice(0, TOP_N);
    } catch (err) {
        console.warn('[correlationGroups] sem dado de volume, usando ordem padrão:', err.message);
        symbols = allSymbols.slice(0, TOP_N);
    }

    console.log(`[correlationGroups] buscando candles de ${symbols.length} moedas...`);
    const returnsArr = await runWithConcurrency(symbols, fetchReturns, CONCURRENCY);
    const valid = [];
    const validReturns = [];
    symbols.forEach((s, i) => {
        if (returnsArr[i]) { valid.push(s); validReturns.push(returnsArr[i]); }
    });
    console.log(`[correlationGroups] ${valid.length}/${symbols.length} moedas com histórico suficiente`);

    const n = valid.length;
    const corrMatrix = Array.from({ length: n }, () => new Array(n).fill(null));
    for (let i = 0; i < n; i++) {
        corrMatrix[i][i] = 1;
        for (let j = i + 1; j < n; j++) {
            const c = pearsonPairwise(validReturns[i], validReturns[j]);
            corrMatrix[i][j] = c;
            corrMatrix[j][i] = c;
        }
    }

    console.log('[correlationGroups] clusterizando...');
    const clusters = clusterAverageLinkage(valid, corrMatrix, 1 - THRESHOLD);

    function avgIntra(members) {
        if (members.length < 2) return null;
        const idxs = members.map((s) => valid.indexOf(s));
        let sum = 0, cnt = 0;
        for (let x = 0; x < idxs.length; x++) {
            for (let y = x + 1; y < idxs.length; y++) {
                const c = corrMatrix[idxs[x]][idxs[y]];
                if (c != null) { sum += c; cnt++; }
            }
        }
        return cnt ? sum / cnt : null;
    }

    const groups = clusters
        .filter((members) => members.length > 1)
        .map((members, i) => ({ id: i + 1, members, avgCorr: parseFloat((avgIntra(members) ?? 0).toFixed(3)) }))
        .sort((a, b) => b.members.length - a.members.length);

    const symbolGroup = {};
    groups.forEach((g) => { g.members.forEach((s) => { symbolGroup[s] = g.id; }); });

    const out = {
        computedAt: new Date().toISOString(),
        interval: INTERVAL,
        candleCount: LIMIT,
        threshold: THRESHOLD,
        symbolsAnalyzed: valid.length,
        groups,
        symbolGroup,
    };

    await atomicWriteFile(CACHE_FILE, JSON.stringify(out));
    console.log(`[correlationGroups] salvo em ${CACHE_FILE}`);
    console.log(`[correlationGroups] ${groups.length} grupo(s), ${Object.keys(symbolGroup).length} moedas agrupadas de ${valid.length} analisadas`);
    groups.forEach((g) => console.log(`  grupo ${g.id} (corr média ${g.avgCorr}): ${g.members.join(', ')}`));
}

main().catch((err) => {
    console.error('[correlationGroups] falhou:', err);
    process.exit(1);
});
