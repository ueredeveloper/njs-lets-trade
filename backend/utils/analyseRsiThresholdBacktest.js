'use strict';

const { RSI, ADX, MACD } = require('technicalindicators');
const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { closedCandlesOnly, intervalMs } = require('../bot/ma-cross/strategyEngine');
const { bollingerCycleOccurrences } = require('./indicatorGrowthEngines');
const { averageWithoutOutliers } = require('./removeOutliersIQR');
const getTickers = require('../binance/cachedTicker24hr');

const RSI_PERIOD = 14;
const DEFAULT_CANDLE_COUNT = 1000;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const BB_MIN_CANDLES_PADDING = 5;
// ADX/MACD: períodos fixos, sem seletor próprio — só o intervalo é configurável (mesmo padrão
// "1 detalhe configurável por filtro" dos demais). 14 (ADX) e 12/26/9 (MACD) são os valores
// padrão de mercado, os mesmos usados na literatura consultada (Wilder pro ADX, Appel pro MACD).
const ADX_PERIOD = 14;
const MACD_FAST_PERIOD = 12;
const MACD_SLOW_PERIOD = 26;
const MACD_SIGNAL_PERIOD = 9;
// Warmup mínimo de cada indicador (candles perdidos até o 1º valor válido da série) — usado só
// pra dimensionar o fetch (computeOwnIntervalFetchLimit), com folga generosa.
const ADX_WARMUP_BARS = ADX_PERIOD * 2 + 10;
const MACD_WARMUP_BARS = MACD_SLOW_PERIOD + MACD_SIGNAL_PERIOD + 10;
// Mesmo teto de retenção do cache de candles de 1m (ver backend/utils/candleRetentionLimits.js)
// — não faz sentido pedir mais 1m do que o resto do sistema mantém aquecido. Sinais mais
// antigos que essa janela (~50h) caem no fallback de resolução pelo candle do intervalo
// principal (ver resolveFromSignal / needsCoarseFallback abaixo).
const MAX_ONE_MINUTE_CANDLES = 3000;

/**
 * A partir do preço/instante do sinal, resolve o preenchimento do pullback (se houver) e o
 * resultado do bracket alvo/stop — "OCO" (One-Cancels-the-Other), mesma mecânica de saída do
 * bot Bollinger Bands (ver backend/bot/bollinger-bands/strategyEngine.js, exit.restingBracket):
 * assim que a posição entra, arma alvo E stop simultaneamente; o que for tocado primeiro
 * encerra a operação. `scanCandles` deve conter só candles com openTime > signalCloseMs.
 */
function resolveFromSignal(scanCandles, signalPrice, { pullbackPct, targetPct, stopLossPct, stopPriceOverride }) {
    let filled = pullbackPct === 0;
    let entryTime = null;
    let entryPrice = signalPrice;
    let startScanIdx = 0;

    if (pullbackPct !== 0) {
        const limitPrice = signalPrice * (1 + pullbackPct / 100);
        filled = false;
        for (let j = 0; j < scanCandles.length; j++) {
            if (parseFloat(scanCandles[j].low) <= limitPrice) {
                filled = true;
                entryTime = scanCandles[j].openTime;
                entryPrice = limitPrice;
                startScanIdx = j + 1;
                break;
            }
        }
        if (!filled) return { filled: false };
    }

    const targetPrice = entryPrice * (1 + targetPct / 100);
    // Stop pelo candle 4h anterior (ver resolvePrevCandleStopPrice): preço absoluto, não %. Só
    // usa o override se fizer sentido pra uma compra (abaixo do preço de entrada) — sem isso, um
    // candle 4h anterior cujo fundo já ficou acima da entrada geraria um "stop" que dispara na
    // hora. Sem override válido, cai de volta pro stop fixo (stopLossPct), como sempre.
    const stopPrice = Number.isFinite(stopPriceOverride) && stopPriceOverride > 0 && stopPriceOverride < entryPrice
        ? stopPriceOverride
        : entryPrice * (1 - stopLossPct / 100);

    let outcome = 'open';
    let exitTime = null;
    let exitPrice = null;

    for (let j = startScanIdx; j < scanCandles.length; j++) {
        const low = parseFloat(scanCandles[j].low);
        const high = parseFloat(scanCandles[j].high);

        // Ordem intra-candle desconhecida (só temos OHLC) — no empate assume o pior caso
        // (stop primeiro), mesmo critério conservador de sempre.
        if (low <= stopPrice) {
            outcome = 'stop';
            exitTime = scanCandles[j].openTime;
            exitPrice = stopPrice;
            break;
        }
        if (high >= targetPrice) {
            outcome = 'target';
            exitTime = scanCandles[j].openTime;
            exitPrice = targetPrice;
            break;
        }
    }

    if (outcome === 'open') {
        exitPrice = scanCandles.length
            ? parseFloat(scanCandles[scanCandles.length - 1].close)
            : entryPrice;
    }

    return { filled: true, entryTime, entryPrice, targetPrice, stopPrice, outcome, exitTime, exitPrice };
}

/** Maior índice i tal que candles[i].openTime <= timeMs (busca binária — candles vem ordenado
 *  ascendente de getCandles/getGateCandles). -1 se nenhum candle é anterior/igual a timeMs.
 *  Reaproveitado por todos os filtros/stops que usam um candle de um intervalo PRÓPRIO
 *  (D-1/stop 4h/ADX/MACD) pra achar o candle relevante no instante de cada sinal. */
function findCandleIndexAtOrBefore(dailyCandles, timeMs) {
    let lo = 0, hi = dailyCandles.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dailyCandles[mid].openTime <= timeMs) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return best;
}

/** Candles necessários num intervalo PRÓPRIO (ownInterval) pra cobrir a janela do intervalo
 *  principal (mainLimit candles) + warmup do indicador — mesma ideia de pdcDayLimit/pcsFourHLimit,
 *  generalizada. Usado pelos filtros ADX/MACD (cada um no seu próprio intervalo escolhido). */
function computeOwnIntervalFetchLimit(mainInterval, mainLimit, ownInterval, warmupBars, maxLimit = 3000) {
    const mainMs = mainInterval === '1m' ? 60_000 : intervalMs(mainInterval);
    const ownMs = intervalMs(ownInterval) ?? mainMs;
    const spanBars = Math.ceil((mainLimit * mainMs) / ownMs);
    return Math.min(maxLimit, Math.max(warmupBars + 20, spanBars + warmupBars + 20));
}

/**
 * Valor de uma série de indicador (ADX, MACD…) calculada num intervalo PRÓPRIO, no candle mais
 * recente já fechado ATÉ o instante do sinal (não o candle ANTERIOR a ele — diferente da nuvem
 * D-1/stop 4h, aqui queremos a leitura VIGENTE do indicador no momento da compra, pra confirmar
 * força/tendência ali mesmo). `pick(seriesEntry)` extrai o número desejado (ex.: `.adx`,
 * `.histogram`). null se não houver candle/warmup suficiente ainda.
 */
function resolveOwnIntervalValueAt(ownCandles, ownSeries, ownOffset, timeMs, pick) {
    if (!ownSeries.length) return null;
    const idx = findCandleIndexAtOrBefore(ownCandles, timeMs);
    const seriesIdx = idx - ownOffset;
    if (seriesIdx < 0 || seriesIdx >= ownSeries.length) return null;
    const value = pick(ownSeries[seriesIdx]);
    return Number.isFinite(value) ? value : null;
}

/**
 * Nuvem D-1 válida no instante do sinal: candle diário NATIVO imediatamente anterior ao dia do
 * sinal (mesma regra do indicador do gráfico — não é o dia "civil" do sinal, é o candle anterior
 * a ele). null se não houver candle diário suficiente antes do sinal (início da amostra).
 */
function resolvePrevDayCloud(dailyCandles, signalTimeMs) {
    const curIdx = findCandleIndexAtOrBefore(dailyCandles, signalTimeMs);
    if (curIdx < 1) return null;
    const prev = dailyCandles[curIdx - 1];
    const open = parseFloat(prev.open);
    const close = parseFloat(prev.close);
    if (!(open > 0) || !(close > 0)) return null;
    return { lower: Math.min(open, close), upper: Math.max(open, close) };
}

/**
 * Preço do sinal precisa estar DENTRO da nuvem D-1, na faixa [lower, lower + maxPct% × altura] —
 * não importa se o dia anterior fechou em alta ou baixa (ver JSDoc de analyseRsiThresholdBacktest,
 * options.prevDayCloud). Sem nuvem de referência disponível (início da amostra), não bloqueia.
 */
function checkPrevDayCloudFilter(dailyCandles, signalTimeMs, price, maxPct) {
    const cloud = resolvePrevDayCloud(dailyCandles, signalTimeMs);
    if (!cloud) return true;
    const { lower, upper } = cloud;
    if (upper <= lower) return true; // nuvem "achatada" (abertura == fechamento) — sem restrição possível
    const limit = lower + (maxPct / 100) * (upper - lower);
    return price >= lower && price <= limit;
}

/**
 * Stop pelo candle de 4h ANTERIOR ao instante do sinal (mesmo critério de "candle anterior" do
 * findCandleIndexAtOrBefore acima, só que em 4h em vez de 1d): se aquele candle fechou em alta, o
 * stop é a abertura dele; se fechou em baixa, o stop é o fechamento. Nos dois casos isso é
 * exatamente Math.min(open, close) — o "fundo do corpo" do candle, não o pavio (low). null se
 * não houver candle de 4h suficiente antes do sinal (início da amostra).
 */
function resolvePrevCandleStopPrice(fourHCandles, signalTimeMs) {
    const curIdx = findCandleIndexAtOrBefore(fourHCandles, signalTimeMs);
    if (curIdx < 1) return null;
    const prev = fourHCandles[curIdx - 1];
    const open = parseFloat(prev.open);
    const close = parseFloat(prev.close);
    if (!(open > 0) || !(close > 0)) return null;
    return close >= open ? open : close;
}

function buildOccurrence(signalCandle, signalPrice, signalRsi, resolved, positionSizeUsd) {
    if (!resolved.filled) {
        return {
            signalDate: new Date(signalCandle.openTime).toISOString(),
            signalPrice,
            signalRsi,
            filled: false,
            entryDate: null,
            entryPrice: null,
            targetPrice: null,
            stopPrice: null,
            outcome: 'not_filled',
            exitDate: null,
            exitPrice: null,
            pnlPct: null,
            pnlUsd: null,
        };
    }

    const { entryTime, entryPrice, targetPrice, stopPrice, outcome, exitTime, exitPrice } = resolved;
    const pnlPct = parseFloat((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2));
    const pnlUsd = parseFloat((positionSizeUsd * (pnlPct / 100)).toFixed(2));

    return {
        signalDate: new Date(signalCandle.openTime).toISOString(),
        signalPrice,
        signalRsi,
        filled: true,
        entryDate: new Date(entryTime ?? signalCandle.openTime).toISOString(),
        entryPrice,
        targetPrice,
        stopPrice,
        outcome,
        exitDate: exitTime != null ? new Date(exitTime).toISOString() : null,
        exitPrice,
        pnlPct,
        pnlUsd,
    };
}

/**
 * Backtest de momentum por limiar de RSI: entra COMPRADO quando o RSI cruza para cima de
 * `rsiThreshold` (ex.: 70 — o oposto do ciclo clássico de sobrevenda/sobrecompra de
 * analyseRsiOversoldRecovery.js). O SINAL é detectado no `interval` escolhido (ex.: 15m), mas a
 * partir dele o pullback e o bracket alvo/stop são avaliados minuto a minuto (candles de 1m) —
 * mesma granularidade com que o bot Bollinger Bands realmente preenche ordem limite e resolve o
 * OCO (ver resolveFromSignal acima), em vez de só nos fechamentos do candle de 15m. Sinais mais
 * antigos que a janela de 1m disponível (ver MAX_ONE_MINUTE_CANDLES) caem de volta pra resolução
 * no candle do `interval` principal.
 *
 * Cada sinal é avaliado de forma independente (não é uma posição sequencial exclusiva) — mostra
 * o resultado hipotético de CADA cruzamento, mesmo que vários ocorram antes do anterior
 * "fechar", pois o objetivo é medir a taxa de acerto do sinal, não simular uma carteira com uma
 * posição por vez.
 *
 * @param {string} symbol
 * @param {string} interval                    Intervalo do RSI/sinal de entrada (ex.: '15m').
 * @param {object} [options]
 * @param {number} [options.rsiThreshold=70]   RSI cruza para cima deste valor = sinal de entrada.
 * @param {number} [options.pullbackPct=0]     0 = compra no close do candle do sinal. Negativo
 *   (ex.: -2) = só entra se o preço cair esse % abaixo do preço do sinal depois dele (ordem
 *   limite, avaliada minuto a minuto); se nunca cair o suficiente, fica "não preenchido".
 * @param {number} [options.targetPct=5]       Alvo de lucro (%) a partir do preço de entrada.
 * @param {number} [options.stopLossPct=5]     Stop-loss (%) a partir do preço de entrada.
 * @param {number} [options.positionSizeUsd=40] Aporte hipotético (US$) por sinal preenchido.
 * @param {number} [options.candleCount]       Candles buscados no intervalo principal.
 * @param {number} [options.lookbackHours=0]   Restringe os SINAIS às últimas N horas (ex.: 6, 7,
 *   8 — "moedas que atingiram RSI X nas últimas N horas"). 0/undefined = sem restrição, considera
 *   todo o histórico buscado (candleCount). Não afeta o cálculo da largura de banda, que já tem
 *   sua própria janela (bandWidth.lookback).
 * @param {string|null} [options.source]       'gate' ou null (Binance).
 * @param {object} [options.priorRsiFilter]    Mesmo filtro "não é repique" do bot ao vivo (ver
 *   entry.priorRsiFilter em backend/bot/rsi-momentum/strategyEngine.js) — os `count` valores de
 *   RSI anteriores ao cruzamento precisam estar <= threshold. Default bate com o preset estático
 *   (backend/bot/rsi-momentum/strategyPresets.js): o chamador deve passar a config GLOBAL real
 *   (rsi_momentum_global_config) pra estatística ficar fiel ao que o bot realmente exige.
 * @param {boolean} [options.priorRsiFilter.enabled=true]
 * @param {number}  [options.priorRsiFilter.count=3]
 * @param {object} [options.bandWidth]         Filtro opcional de largura de banda (Bollinger).
 * @param {boolean} [options.bandWidth.enabled=false]
 * @param {string}  [options.bandWidth.interval='5m']
 * @param {number}  [options.bandWidth.period=20]
 * @param {number}  [options.bandWidth.stdDev=2]
 * @param {number}  [options.bandWidth.lookback=300]  Candles usados p/ calcular a largura média.
 * @param {number}  [options.bandWidth.minPct=2]      Largura média mínima (%) exigida.
 * @param {object} [options.prevDayCloud]      Filtro opcional pela nuvem D-1 (mesmo indicador do
 *   gráfico — banda entre abertura/fechamento do candle diário NATIVO anterior ao dia do sinal,
 *   ver buildPrevDayCloudSegments em frontend-react/src/components/CandlestickChart.jsx). Exige
 *   que o preço do sinal esteja DENTRO da nuvem (entre lower e upper), na faixa
 *   [lower, lower + maxPct% × (upper-lower)] — não importa se o dia anterior fechou em alta ou
 *   baixa. maxPct=100 (padrão) exige só estar dentro da nuvem inteira; valores menores restringem
 *   à parte de baixo dela (ex.: 70% = só a faixa entre o fundo e 70% da altura da nuvem).
 * @param {boolean} [options.prevDayCloud.enabled=false]
 * @param {number}  [options.prevDayCloud.maxPct=100]
 * @param {number}  [options.minVolumeUsdt=0]  Filtro opcional de volume 24h (mesmo campo do bot
 *   ao vivo, config.volume.minVolumeUsdt — ver marketScanner.js). 0 = desligado. Usa o mesmo
 *   cache de /ticker/24hr da Binance (cachedTicker24hr.js) — sem efeito quando source='gate'
 *   (sem dado de volume 24h da Gate.io integrado aqui). Se o símbolo não atingir o mínimo,
 *   NENHUM sinal entra na simulação (mesmo comportamento "bloqueia o símbolo inteiro" do
 *   bandWidth).
 * @param {boolean} [options.excludeOpenExits=false]  Remove da amostra (tabela E agregados —
 *   P&L, taxa de acerto, contagens) os sinais cujo outcome é "open" (ainda não bateram alvo nem
 *   stop até agora — resultado não realizado/pendente). Com winRatePct já ignorando "open" por
 *   padrão, esse filtro serve pra também limpar a tabela e o P&L médio dessas posições ainda em
 *   aberto.
 * @param {boolean} [options.prevCandleStop=false]  Stop pelo candle de 4h ANTERIOR ao sinal, em
 *   vez do stop fixo (stopLossPct) — ver resolvePrevCandleStopPrice. Candle anterior em alta:
 *   stop = abertura dele. Candle anterior em baixa: stop = fechamento dele (nos dois casos, o
 *   "fundo do corpo" do candle — Math.min(open, close)). O alvo (targetPct) continua em % fixo —
 *   só o stop muda de mecânica. Sempre 4h, fixo (sem intervalo configurável). Sinal sem candle
 *   de 4h suficiente antes dele (início da amostra), ou cujo stop calculado ficaria ACIMA do
 *   preço de entrada (inválido pra uma compra), cai de volta pro stop fixo automaticamente.
 * @param {object} [options.adxFilter]  Filtro de força de tendência (ADX de Wilder, período fixo
 *   14) — só permite o sinal se o ADX, no intervalo escolhido, estiver NA OU ACIMA do mínimo
 *   exigido no instante do sinal. Mercado em range (ADX baixo) costuma gerar cruzamentos de RSI
 *   fracos que revertem contra a posição; exigir ADX alto filtra pra sinais que ocorrem dentro de
 *   uma tendência real. Sem valor de ADX disponível ainda (warmup), NÃO bloqueia (fail-open).
 * @param {boolean} [options.adxFilter.enabled=false]
 * @param {string}  [options.adxFilter.interval='1h']
 * @param {number}  [options.adxFilter.minAdx=25]
 * @param {object} [options.macdFilter]  Confirmação de momentum por MACD (12/26/9 padrão) — só
 *   permite o sinal se o histograma do MACD (MACD − linha de sinal), no intervalo escolhido,
 *   estiver POSITIVO no instante do sinal (mesmo que MACD > linha de sinal). Segunda confirmação
 *   independente do RSI, pontual (no candle do sinal) — reduz repiques onde o RSI cruzou mas o
 *   momentum de fundo ainda não virou. Sem valor de MACD disponível ainda (warmup), NÃO bloqueia.
 * @param {boolean} [options.macdFilter.enabled=false]
 * @param {string}  [options.macdFilter.interval='1h']
 */
async function analyseRsiThresholdBacktest(symbol, interval, options = {}) {
    const {
        rsiThreshold   = 70,
        pullbackPct    = 0,
        targetPct      = 5,
        stopLossPct    = 5,
        positionSizeUsd = 40,
        candleCount,
        lookbackHours   = 0,
        source          = null,
        priorRsiFilter  = null,
        bandWidth       = null,
        prevDayCloud    = null,
        minVolumeUsdt   = 0,
        excludeOpenExits = false,
        prevCandleStop  = false,
        adxFilter       = null,
        macdFilter      = null,
    } = options;

    const pcsEnabled = !!prevCandleStop;
    const adxEnabled = !!adxFilter?.enabled;
    const adxInterval = adxFilter?.interval ?? '1h';
    const adxMinAdx  = Math.max(1, Number(adxFilter?.minAdx ?? 25));
    const macdEnabled = !!macdFilter?.enabled;
    const macdInterval = macdFilter?.interval ?? '1h';

    const priorRsiCount = priorRsiFilter?.enabled === false
        ? 0
        : Math.max(1, Math.round(Number(priorRsiFilter?.count ?? 3)));

    const signalCutoffMs = lookbackHours > 0 ? Date.now() - lookbackHours * 60 * 60 * 1000 : 0;

    const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
    const mainLimit = candleCount ?? DEFAULT_CANDLE_COUNT;

    const bwEnabled = !!bandWidth?.enabled;
    const bwInterval = bandWidth?.interval ?? '5m';
    const bwPeriod   = bandWidth?.period ?? BB_PERIOD;
    const bwStdDev   = bandWidth?.stdDev ?? BB_STDDEV;
    const bwLookback = bandWidth?.lookback ?? 300;
    const bwMinPct   = bandWidth?.minPct ?? 2;

    const pdcEnabled = !!prevDayCloud?.enabled;
    const pdcMaxPct  = Math.max(1, Math.min(100, Number(prevDayCloud?.maxPct ?? 100)));
    // Dias cobertos pelo intervalo principal (mainLimit candles) + folga de 3 dias, pro dia mais
    // antigo da amostra também ter um "dia anterior" completo pra servir de referência — mesma
    // conta de computePrevDayCloudFetchLimit no frontend.
    const pdcDayLimit = Math.min(500, Math.max(10,
        Math.ceil((mainLimit * (interval === '1m' ? 60_000 : intervalMs(interval))) / 86_400_000) + 3,
    ));

    // Candles de 4h cobertos pela janela do intervalo principal + folga de 3 candles (o candle
    // 4h anterior ao sinal mais antigo da amostra também precisa de referência) — mesma conta do
    // pdcDayLimit acima, só que em 4h em vez de 1d.
    const pcsFourHLimit = Math.min(2000, Math.max(10,
        Math.ceil((mainLimit * (interval === '1m' ? 60_000 : intervalMs(interval))) / intervalMs('4h')) + 3,
    ));

    const volEnabled = Number(minVolumeUsdt) > 0 && source !== 'gate';

    const adxLimit = adxEnabled
        ? computeOwnIntervalFetchLimit(interval, mainLimit, adxInterval, ADX_WARMUP_BARS)
        : 0;
    const macdLimit = macdEnabled
        ? computeOwnIntervalFetchLimit(interval, mainLimit, macdInterval, MACD_WARMUP_BARS)
        : 0;

    const settled = await Promise.allSettled([
        fetchCandles(symbol, interval, mainLimit),
        bwEnabled
            ? fetchCandles(symbol, bwInterval, bwLookback + bwPeriod + BB_MIN_CANDLES_PADDING)
            : Promise.resolve(null),
        pdcEnabled
            ? fetchCandles(symbol, '1d', pdcDayLimit)
            : Promise.resolve(null),
        volEnabled ? getTickers() : Promise.resolve(null),
        pcsEnabled
            ? fetchCandles(symbol, '4h', pcsFourHLimit)
            : Promise.resolve(null),
        adxEnabled
            ? fetchCandles(symbol, adxInterval, adxLimit)
            : Promise.resolve(null),
        macdEnabled
            ? fetchCandles(symbol, macdInterval, macdLimit)
            : Promise.resolve(null),
    ]);

    const [candlesResult, bwCandlesResult, pdcCandlesResult, tickersResult, pcsCandlesResult, adxCandlesResult, macdCandlesResult] = settled;
    if (candlesResult.status === 'rejected') throw candlesResult.reason;
    const candles = candlesResult.value;

    const dailyCandles = pdcEnabled && pdcCandlesResult.status === 'fulfilled' && pdcCandlesResult.value
        ? pdcCandlesResult.value
        : [];

    const fourHCandles = pcsEnabled && pcsCandlesResult.status === 'fulfilled' && pcsCandlesResult.value
        ? pcsCandlesResult.value
        : [];

    // ADX (força de tendência) — calculado no intervalo PRÓPRIO escolhido (adxInterval), não no
    // intervalo do sinal: geralmente faz sentido olhar a tendência num timeframe maior que o do
    // gatilho de RSI (ex.: RSI em 15m, ADX em 1h).
    const adxCandles = adxEnabled && adxCandlesResult.status === 'fulfilled' && adxCandlesResult.value
        ? adxCandlesResult.value
        : [];
    let adxSeries = [];
    let adxOffset = 0;
    if (adxCandles.length) {
        const highs = adxCandles.map(c => parseFloat(c.high));
        const lows = adxCandles.map(c => parseFloat(c.low));
        const closesAdx = adxCandles.map(c => parseFloat(c.close));
        adxSeries = ADX.calculate({ high: highs, low: lows, close: closesAdx, period: ADX_PERIOD });
        adxOffset = adxCandles.length - adxSeries.length;
    }

    // MACD (confirmação de momentum) — mesma ideia, intervalo próprio (macdInterval).
    const macdCandles = macdEnabled && macdCandlesResult.status === 'fulfilled' && macdCandlesResult.value
        ? macdCandlesResult.value
        : [];
    let macdSeries = [];
    let macdOffset = 0;
    if (macdCandles.length) {
        const closesMacd = macdCandles.map(c => parseFloat(c.close));
        macdSeries = MACD.calculate({
            values: closesMacd,
            fastPeriod: MACD_FAST_PERIOD,
            slowPeriod: MACD_SLOW_PERIOD,
            signalPeriod: MACD_SIGNAL_PERIOD,
            SimpleMAOscillator: false,
            SimpleMASignal: false,
        });
        macdOffset = macdCandles.length - macdSeries.length;
    }

    // Volume 24h: mesmo campo/fonte do filtro do bot ao vivo (marketScanner.js) — falha ao
    // buscar o ticker não bloqueia o backtest (fail-open), só desativa o filtro nesta chamada.
    let volumeResult = null;
    if (volEnabled) {
        let quoteVolume = null;
        if (tickersResult.status === 'fulfilled' && Array.isArray(tickersResult.value)) {
            const t = tickersResult.value.find((x) => x.symbol === symbol);
            quoteVolume = t ? Number(t.quoteVolume) : null;
        }
        volumeResult = {
            minVolumeUsdt: Number(minVolumeUsdt),
            quoteVolume,
            passed: quoteVolume != null && quoteVolume >= Number(minVolumeUsdt),
        };
    }
    const volumeBlocksEntries = volEnabled && !volumeResult.passed;

    // Largura de banda: mesmo motor do filtro de mercado "Larg%" (ver
    // backend/services/fetchBollingerBandWidthFilter.js) — % médio de valorização de cada
    // ciclo fundo→topo, sem outliers. É uma propriedade única da moeda no período: se não
    // passar no mínimo exigido, NENHUM sinal desse símbolo entra na simulação.
    let bandWidthResult = null;
    if (bwEnabled) {
        let avgWidthPct = null;
        if (bwCandlesResult.status === 'fulfilled' && bwCandlesResult.value) {
            const closed = closedCandlesOnly(bwCandlesResult.value);
            const occurrences = bollingerCycleOccurrences(closed, { period: bwPeriod, stdDev: bwStdDev });
            if (occurrences?.length) {
                avgWidthPct = Math.round(averageWithoutOutliers(occurrences) * 100) / 100;
            }
        }
        bandWidthResult = {
            interval: bwInterval,
            period: bwPeriod,
            stdDev: bwStdDev,
            lookback: bwLookback,
            minPct: bwMinPct,
            avgWidthPct,
            passed: avgWidthPct != null && avgWidthPct >= bwMinPct,
        };
    }

    const bandWidthBlocksEntries = bwEnabled && !bandWidthResult.passed;

    const closes = candles.map(c => parseFloat(c.close));
    const rsiValues = RSI.calculate({ values: closes, period: RSI_PERIOD });
    const offset = RSI_PERIOD;

    // Fase 1 — detecta os cruzamentos de RSI no candle do `interval` principal (o "pensamento"
    // continua em 15m/etc.), sem resolver ainda pullback/saída.
    const rawSignals = [];
    const minI = Math.max(1, priorRsiCount);
    if (!bandWidthBlocksEntries && !volumeBlocksEntries) {
        for (let i = minI; i < rsiValues.length; i++) {
            if (rsiValues[i - 1] >= rsiThreshold || rsiValues[i] < rsiThreshold) continue;
            // Mesmo filtro de "não é repique de volatilidade" do bot ao vivo (ver
            // evaluateEntrySignal em backend/bot/rsi-momentum/strategyEngine.js, entry.priorRsiFilter):
            // os `priorRsiCount` valores de RSI anteriores ao cruzamento também precisam estar
            // <= threshold (rsiValues[i-1] já garantido pela checagem do cruzamento acima).
            let priorRsiBlocked = false;
            for (let k = 2; k <= priorRsiCount; k++) {
                if (rsiValues[i - k] > rsiThreshold) { priorRsiBlocked = true; break; }
            }
            if (priorRsiBlocked) continue;

            const idx = i + offset;
            const signalCandle = candles[idx];
            if (signalCandle.openTime < signalCutoffMs) continue;

            const signalPrice = parseFloat(signalCandle.close);
            if (pdcEnabled && !checkPrevDayCloudFilter(dailyCandles, signalCandle.openTime, signalPrice, pdcMaxPct)) continue;

            // ADX: só passa com tendência confirmada (>= mínimo) no instante do sinal. Sem valor
            // disponível ainda (warmup do indicador), não bloqueia.
            if (adxEnabled) {
                const adxValue = resolveOwnIntervalValueAt(adxCandles, adxSeries, adxOffset, signalCandle.openTime, (e) => e.adx);
                if (adxValue != null && adxValue < adxMinAdx) continue;
            }

            // MACD: só passa com histograma positivo (MACD > linha de sinal) no instante do
            // sinal. Sem valor disponível ainda (warmup), não bloqueia.
            if (macdEnabled) {
                const macdHist = resolveOwnIntervalValueAt(macdCandles, macdSeries, macdOffset, signalCandle.openTime, (e) => e.histogram);
                if (macdHist != null && macdHist <= 0) continue;
            }

            const stopPriceOverride = pcsEnabled
                ? resolvePrevCandleStopPrice(fourHCandles, signalCandle.openTime)
                : null;

            rawSignals.push({
                signalCandle,
                signalPrice,
                signalRsi: parseFloat(rsiValues[i].toFixed(2)),
                idx,
                stopPriceOverride,
            });
        }
    }

    // Fase 2 — busca candles de 1m cobrindo do sinal mais antigo até agora (uma única vez,
    // reaproveitada por todos os sinais desta moeda), pra resolver pullback + OCO minuto a
    // minuto como no bot real. Intervalo já em 1m: os próprios candles principais já servem.
    let oneMinCandles = null;
    if (rawSignals.length > 0 && interval !== '1m') {
        const ivMs = intervalMs(interval);
        const earliestCloseMs = Math.min(...rawSignals.map((s) => s.signalCandle.openTime + ivMs));
        const neededMinutes = Math.ceil((Date.now() - earliestCloseMs) / 60000) + 2;
        const limit1m = Math.max(5, Math.min(neededMinutes, MAX_ONE_MINUTE_CANDLES));
        try {
            oneMinCandles = await fetchCandles(symbol, '1m', limit1m);
        } catch {
            oneMinCandles = null;
        }
    }

    const occurrences = [];
    for (const { signalCandle, signalPrice, signalRsi, idx, stopPriceOverride } of rawSignals) {
        const ivMs = interval === '1m' ? 60_000 : intervalMs(interval);
        const signalCloseMs = signalCandle.openTime + ivMs;

        let scanCandles = null;
        if (interval === '1m') {
            scanCandles = candles.slice(idx + 1);
        } else if (oneMinCandles?.length && oneMinCandles[0].openTime <= signalCloseMs) {
            scanCandles = oneMinCandles.filter((c) => c.openTime > signalCloseMs);
        }

        // Fallback: sinal mais antigo que a janela de 1m disponível (ou 1m indisponível) —
        // resolve pelo candle do intervalo principal, como antes.
        if (!scanCandles) {
            scanCandles = candles.slice(idx + 1);
        }

        const resolved = resolveFromSignal(scanCandles, signalPrice, { pullbackPct, targetPct, stopLossPct, stopPriceOverride });
        occurrences.push(buildOccurrence(signalCandle, signalPrice, signalRsi, resolved, positionSizeUsd));
    }

    // "Remover saída aberta": tira da amostra (tabela E agregados) os sinais ainda não resolvidos
    // (outcome 'open', preso ao preço de agora) — sem isso, o P&L médio ficaria misturado com
    // posições ainda em aberto, cujo resultado final ainda não é conhecido.
    const finalOccurrences = excludeOpenExits ? occurrences.filter(o => o.outcome !== 'open') : occurrences;

    const filledOccurrences = finalOccurrences.filter(o => o.filled);
    const totalTarget = filledOccurrences.filter(o => o.outcome === 'target').length;
    const totalStop = filledOccurrences.filter(o => o.outcome === 'stop').length;
    const totalOpen = filledOccurrences.filter(o => o.outcome === 'open').length;
    const totalNotFilled = finalOccurrences.length - filledOccurrences.length;
    const closedCount = totalTarget + totalStop;
    const winRatePct = closedCount > 0 ? parseFloat(((totalTarget / closedCount) * 100).toFixed(1)) : 0;
    const totalInvestedUsd = parseFloat((filledOccurrences.length * positionSizeUsd).toFixed(2));
    const totalPnlUsd = parseFloat(filledOccurrences.reduce((s, o) => s + o.pnlUsd, 0).toFixed(2));
    const avgPnlPct = filledOccurrences.length > 0
        ? parseFloat((filledOccurrences.reduce((s, o) => s + o.pnlPct, 0) / filledOccurrences.length).toFixed(2))
        : 0;

    return {
        symbol,
        interval,
        rsiPeriod: RSI_PERIOD,
        rsiThreshold,
        priorRsiCount,
        pullbackPct,
        targetPct,
        stopLossPct,
        positionSizeUsd,
        lookbackHours,
        totalCandles: candles.length,
        candleSpanMs: candles.length > 1 ? candles[candles.length - 1].openTime - candles[0].openTime : 0,
        totalSignals: finalOccurrences.length,
        totalFilled: filledOccurrences.length,
        totalTarget,
        totalStop,
        totalOpen,
        totalNotFilled,
        winRatePct,
        totalInvestedUsd,
        totalPnlUsd,
        avgPnlPct,
        bandWidth: bandWidthResult,
        prevDayCloud: pdcEnabled ? { maxPct: pdcMaxPct } : null,
        volume: volumeResult,
        excludeOpenExits,
        prevCandleStop: pcsEnabled,
        adxFilter: adxEnabled ? { interval: adxInterval, minAdx: adxMinAdx } : null,
        macdFilter: macdEnabled ? { interval: macdInterval } : null,
        occurrences: finalOccurrences,
    };
}

module.exports = analyseRsiThresholdBacktest;
