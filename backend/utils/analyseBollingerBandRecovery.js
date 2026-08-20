'use strict';

const BollingerBands = require('technicalindicators').BollingerBands;
const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { getMedianTrendThreshold } = require('./bollingerMedianTrendConfig');
const { permStateSeries, lastClosedPermStateAt, isEntryBullishState } = require('./emaPersistCloud');
const { averageWithoutOutliers } = require('./removeOutliersIQR');

const BB_PERIOD = 20;
const BB_STD_DEV = 2;
// Mesmo padrão da coluna "Larg" (fetchBollingerBandWidthFilter.js — lookback: 300), pra
// "Valor. média" bater com "Larg" quando nenhum parâmetro custom é passado.
const DEFAULT_CANDLE_COUNT = 300;

const PERM_INTERVAL_MS = { '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000 };
/** Teto de candles buscados por nível do filtro PERM (ver PERM_LEVELS/buildPermSeries abaixo) —
 *  entradas mais antigas que esse histórico ficam sem estado disponível (tratadas como
 *  bloqueadas quando o nível está habilitado, mesmo critério do bot quando falta dado). */
const PERM_MAX_CANDLES = 5000;
/** Cada chave de `options.permFilter` (ver analyseBollingerBandRecovery) e o intervalo real que
 *  ela liga — mesmos 3 níveis fixos do seletor da aba Estatísticas (não é a cascata dinâmica do
 *  bot ao vivo/gráfico; aqui os 3 são independentes e todos os habilitados precisam concordar). */
const PERM_LEVELS = [
  { key: 'h1', interval: '1h' },
  { key: 'm30', interval: '30m' },
  { key: 'm15', interval: '15m' },
];

/**
 * Analisa ciclos de fundo→topo na Bollinger Bands de uma moeda.
 *
 * Varre a série de candles procurando ciclos completos:
 *   mínima (pavio) toca/cruza a banda inferior  → entrada (fundo, menor mínima da zona)
 *   máxima (pavio) toca/cruza a banda superior  → saída (topo)
 * Detecta o toque pelo pavio (high/low) — igual ao que se vê visualmente no gráfico —
 * mas registra entryPrice/exitPrice como o close do candle do toque (preço de referência
 * realista, já que o pavio extremo não é necessariamente executável).
 * Para cada ciclo registra preço de entrada, preço de saída e valorização (%).
 *
 * @param {string} symbol              - Símbolo da moeda. Ex: 'BTCUSDT'
 * @param {object} [options]
 * @param {string} [options.interval='4h']  Intervalo dos candles.
 * @param {number} [options.period=20]      Período da Bollinger Bands.
 * @param {number} [options.stdDev=2]       Desvio padrão das bandas.
 * @param {string|null} [options.source=null] 'gate' ou null (Binance).
 * @param {number} [options.pullbackPct=0] Exige que o preço caia esse tanto % ABAIXO da banda
 *   inferior (não só toque nela) antes de contar a entrada — simula uma ordem limite de compra
 *   nesse preço (mesmo `entry.pullback.belowPct` do bot, ver strategyEngine.js). 0 = desligado,
 *   entra assim que a banda é tocada (comportamento padrão, preço de entrada = close do fundo).
 * @param {number} [options.candleCount=1000] Quantidade de candles buscados para a análise.
 * @param {number} [options.lookback=0] Restringe a busca de ciclos aos últimos N candles
 *   fechados (mesmo parâmetro `lookback` da coluna "Larg" — fetchBollingerBandWidthFilter.js)
 *   — o restante de `candleCount` continua sendo buscado só para aquecer a média móvel da BB,
 *   sem perder precisão do período logo no início da janela. 0 = desligado, usa todo o
 *   `candleCount` buscado (comportamento padrão, igual antes deste parâmetro existir).
 *
 * @returns {Promise<object>}
 *  - symbol / interval / period / stdDev
 *  - totalCandles / totalBbPeriods
 *  - totalOccurrences      : ciclos completos encontrados (fundo + topo)
 *  - avgAppreciationPercent: valorização média (%) entre fundo e topo
 *  - occurrences[]         : detalhes de cada ciclo
 *  - openOccurrence        : ciclo em aberto (fundo já tocado, topo ainda não)
 */
function buildBbSeries(candles, period, stdDev) {
    if (!candles || candles.length < period + 1) return null;
    const closes = candles.map(c => parseFloat(c.close));
    const bb = BollingerBands.calculate({ period, values: closes, stdDev });
    const offset = period - 1;
    return bb.map((b, i) => ({
        openTime: parseInt(candles[i + offset].openTime),
        lower: b.lower,
        middle: b.middle,
        upper: b.upper,
    }));
}

/**
 * Tendência % da linha mediana (média) da BB nos `lookback` candles fechados imediatamente
 * ANTERIORES ao índice `i` (o candle do toque em si fica de fora — mesma janela usada pelo bot
 * em checkMedianTrendFilter/backend/bot/bollinger-bands/strategyEngine.js, que compara contra o
 * último candle já fechado antes do sinal). Retorna null se não houver histórico suficiente.
 */
function medianTrendAvgDiffPct(bbSeries, i, lookback) {
    const start = i - lookback - 1;
    if (start < 0) return null;
    const middles = bbSeries.slice(start, i).map(b => b.middle);
    if (middles.length < lookback + 1) return null;
    const diffPcts = [];
    for (let k = 1; k < middles.length; k++) {
        if (!(middles[k - 1] > 0)) continue;
        diffPcts.push(((middles[k] - middles[k - 1]) / middles[k - 1]) * 100);
    }
    if (!diffPcts.length) return null;
    return diffPcts.reduce((a, b) => a + b, 0) / diffPcts.length;
}

/**
 * Busca candles + calcula a série de estados PERM (EMA9×EMA21, ver backend/utils/emaPersistCloud.js)
 * pra cada nível habilitado em `permFilter` (ex.: `{ h1: true, m30: true, m15: false }`) —
 * intervalo PRÓPRIO, independente do intervalo/período da Bollinger Band sendo analisada (mesma
 * ideia do permFilter do bot ao vivo). `primaryCandles` só serve pra dimensionar quantos candles
 * de cada nível são necessários pra cobrir o período todo da análise (ver PERM_MAX_CANDLES).
 * Retorna um Map<key, {states, intervalMs}> só com os níveis habilitados.
 */
async function buildPermSeriesByLevel(fetchCandles, symbol, permFilter, primaryCandles, primaryIntervalMs) {
    const enabled = PERM_LEVELS.filter(l => permFilter?.[l.key]);
    if (!enabled.length || !primaryCandles?.length) return new Map();

    const spanMs = primaryCandles[primaryCandles.length - 1].openTime - primaryCandles[0].openTime + primaryIntervalMs;
    const out = new Map();
    await Promise.all(enabled.map(async ({ key, interval: iv }) => {
        const ms = PERM_INTERVAL_MS[iv];
        const count = Math.min(PERM_MAX_CANDLES, Math.max(100, Math.ceil(spanMs / ms) + 50));
        const candles = await fetchCandles(symbol, iv, count);
        out.set(key, { states: permStateSeries(candles), intervalMs: ms });
    }));
    return out;
}

/** true só se TODOS os níveis habilitados em `permByLevel` estiverem com nuvem verde (bullish)
 *  já fechada em `atTime` — sem look-ahead (ver lastClosedPermStateAt). Sem nenhum nível
 *  habilitado (`permByLevel` vazio), não filtra nada (comportamento igual a "não usar PERM"). */
function isPermBullishAt(permByLevel, atTime) {
    if (!permByLevel.size) return true;
    for (const { states, intervalMs } of permByLevel.values()) {
        const state = lastClosedPermStateAt(states, intervalMs, atTime);
        if (!state || !isEntryBullishState(state.state)) return false;
    }
    return true;
}

async function analyseBollingerBandRecovery(symbol, options = {}) {
    const {
        interval = '4h',
        period   = BB_PERIOD,
        stdDev   = BB_STD_DEV,
        source   = null,
        medianTrendFilter   = false,
        medianTrendLookback = 10,
        pullbackPct = 0,
        candleCount = DEFAULT_CANDLE_COUNT,
        lookback = 0,
        permFilter = null,
    } = options;
    const pullback = Math.max(0, parseFloat(pullbackPct) || 0);
    const limit = parseInt(candleCount) || DEFAULT_CANDLE_COUNT;
    const lookbackCandles = Math.max(0, parseInt(lookback) || 0);

    const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
    const candles = await fetchCandles(symbol, interval, limit);

    const bbSeries = buildBbSeries(candles, period, stdDev);
    if (!bbSeries) throw new Error(`Candles insuficientes para BB(${period}) em ${interval}`);

    const primaryIntervalMs = candles.length > 1
        ? candles[1].openTime - candles[0].openTime
        : PERM_INTERVAL_MS[interval] ?? 3_600_000;
    const permByLevel = await buildPermSeriesByLevel(fetchCandles, symbol, permFilter, candles, primaryIntervalMs);

    const offset = period - 1;

    // Máquina de estados sequencial:
    //   SEEK_ENTRY → aguarda a mínima (pavio) tocar/cruzar a banda inferior → registra fundo
    //   SEEK_EXIT  → aguarda a máxima (pavio) tocar/cruzar a banda superior → registra topo, volta ao início
    const occurrences = [];
    let state = 'SEEK_ENTRY';
    let minLowIdx = null;
    let pullbackEntryPrice = null; // preço exato do limite de pullback (só usado quando pullback > 0)

    // Com lookback > 0, só começa a procurar ENTRADAS nos últimos `lookback` candles fechados —
    // a média móvel da BB continua aquecida com o histórico completo buscado (candleCount),
    // só a janela de busca de ciclos é que fica restrita (mesmo efeito de reduzir candleCount
    // pra `lookback`, mas sem perder precisão do período logo no início da janela).
    const searchStartIdx = lookbackCandles > 0 ? Math.max(0, bbSeries.length - lookbackCandles) : 0;

    for (let i = searchStartIdx; i < bbSeries.length; i++) {
        const candle = candles[i + offset];
        const low = parseFloat(candle.low);
        const high = parseFloat(candle.high);

        // Com pullback, exige que o preço rompa esse tanto % abaixo da banda (não só toque nela)
        // — mesmo threshold que o bot arma como ordem limite (strategyEngine.js#evaluateEntrySignal).
        const entryThreshold = bbSeries[i].lower * (1 - pullback / 100);

        if (state === 'SEEK_ENTRY' && low <= entryThreshold) {
            if (medianTrendFilter) {
                const avgDiffPct = medianTrendAvgDiffPct(bbSeries, i, medianTrendLookback);
                // Sem histórico suficiente ou mediana em queda/subindo devagar demais → mesmo critério do bot: bloqueia a entrada.
                if (avgDiffPct === null || avgDiffPct < getMedianTrendThreshold()) continue;
            }
            // Filtro PERM (ver buildPermSeriesByLevel acima): TODOS os níveis habilitados
            // (1h/30m/15m) precisam estar com a nuvem verde já fechada nesse instante — sem
            // nenhum habilitado, não bloqueia nada.
            if (!isPermBullishAt(permByLevel, Number(candle.openTime))) continue;
            minLowIdx = i;
            // Sem pullback, a entrada usa o close do fundo real (rastreado abaixo em SEEK_EXIT) —
            // com pullback, o preço de entrada já é conhecido: o próprio limite que teria enchido.
            pullbackEntryPrice = pullback > 0 ? entryThreshold : null;
            state = 'SEEK_EXIT';
            continue;
        }

        if (state === 'SEEK_EXIT') {
            if (pullback === 0 && low < parseFloat(candles[minLowIdx + offset].low)) {
                minLowIdx = i;
            }

            if (high >= bbSeries[i].upper) {
                const entryCandle = candles[minLowIdx + offset];
                const entryPrice = pullback > 0 ? pullbackEntryPrice : parseFloat(entryCandle.close);
                const exitPrice = parseFloat(candle.close);

                occurrences.push({
                    startDate: new Date(entryCandle.openTime).toISOString(),
                    entryPrice,
                    endDate: new Date(candle.openTime).toISOString(),
                    exitPrice,
                    appreciationPercent: parseFloat(
                        (((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2)
                    ),
                });

                minLowIdx = null;
                pullbackEntryPrice = null;
                state = 'SEEK_ENTRY';
            }
        }
    }

    // Ciclo aberto: a mínima tocou a banda inferior mas a máxima ainda não alcançou a superior.
    let openOccurrence = null;
    if (state === 'SEEK_EXIT' && minLowIdx !== null) {
        const lowestCandle = candles[minLowIdx + offset];
        const lastCandle = candles[candles.length - 1];
        const entryPrice = pullback > 0 ? pullbackEntryPrice : parseFloat(lowestCandle.close);
        const currentPrice = parseFloat(lastCandle.close);

        openOccurrence = {
            isOpen: true,
            startDate: new Date(lowestCandle.openTime).toISOString(),
            entryPrice,
            endDate: null,
            exitPrice: null,
            appreciationPercent: parseFloat(
                (((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2)
            ),
        };
    }

    const total = occurrences.length;
    // Mesmo método de média da coluna "Larg" (fetchBollingerBandWidthFilter.js /
    // indicatorGrowthEngines.js): descarta outliers (IQR) antes de tirar a média, pra que os
    // dois números fiquem comparáveis sob os mesmos parâmetros de ciclo.
    const avgAppreciationPercent = total > 0
        ? parseFloat(averageWithoutOutliers(occurrences.map(o => o.appreciationPercent)).toFixed(2))
        : 0;
    const avgCycleDurationMs = total > 0
        ? Math.round(occurrences.reduce((s, o) => s + (new Date(o.endDate).getTime() - new Date(o.startDate).getTime()), 0) / total)
        : 0;

    return {
        symbol,
        interval,
        period,
        stdDev,
        medianTrendFilter,
        medianTrendLookback,
        pullbackPct: pullback,
        lookback: lookbackCandles,
        permFilter: permByLevel.size ? Object.fromEntries(PERM_LEVELS.filter(l => permFilter?.[l.key]).map(l => [l.key, true])) : null,
        totalCandles: candles.length,
        totalBbPeriods: bbSeries.length,
        totalOccurrences: total,
        avgAppreciationPercent,
        avgCycleDurationMs,
        occurrences,
        openOccurrence,
    };
}

module.exports = analyseBollingerBandRecovery;
