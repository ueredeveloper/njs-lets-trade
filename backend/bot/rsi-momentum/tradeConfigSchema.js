'use strict';

/**
 * Schema RSI Momentum: entra COMPRADO quando o RSI(14) do `entry.interval` cruza para cima de
 * `entry.rsiThreshold` (padrão 69 — sobrecompra, aposta de continuação, não reversão) — mesmo
 * motor de sinal do backtest (ver backend/utils/analyseRsiThresholdBacktest.js). Pullback
 * opcional (ordem limite `belowPct`% abaixo do preço do sinal) é avaliado minuto a minuto
 * (candles de 1m), independente do `entry.interval` do sinal — não espera o próximo candle de
 * 15m/1h fechar pra notar o preenchimento. Saída via bracket TP/SL (Binance: OCO real; Gate.io:
 * emulado) a partir do preço de entrada. Alvo e stop podem ser FIXOS (alvo = entryPrice*(1+
 * targetPct%), stop = entryPrice*(1-maxLossPct%), constantes até o fill) ou CONTÍNUOS: o stop
 * contínuo (exit.trailingStop) sobe em degraus com o pico de preço, e o alvo contínuo
 * (exit.trailingTarget, só junto do stop contínuo) sobe no mesmo contador de degraus — nesses
 * casos a perna que subiu é recriada na corretora.
 */

const ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const BB_PERIODS = [10, 20, 30];
const BB_STD_DEVS = [1, 2, 3];
/** Modos do STOP contínuo (exit.trailingStop.mode) — mesmos do backtest/Estatísticas, ver
 *  trailingStopCandidate em backend/utils/analyseRsiThresholdBacktest.js e computeTrailingStopPrice
 *  em strategyEngine.js:
 *    'continuous' — rampa linear única ancorada na entrada (coinStepPct/stopStepPct).
 *    'twoPhase'   — Escada Dupla: 2 inclinações ancoradas na entrada (fase A agressiva até travar
 *                   pivotPct% de lucro, depois fase B suave).
 *    'peakTrail'  — Trilha do Topo: stop a wNearPct% abaixo do PICO enquanto o ganho < pivotGainPct%,
 *                   e a wFarPct% depois (Chandelier de % em 2 fases).
 *    'atrTrail'   — como Trilha do Topo, mas a fase B = atrMult × ATR% (ATR de Wilder 14 no
 *                   entry.interval no momento da compra, limitada a atrMaxPct%). */
const TRAILING_STOP_MODES = ['continuous', 'twoPhase', 'peakTrail', 'atrTrail'];

const RSI_MOMENTUM_DEFAULTS = {
  kind: 'rsi_momentum',
  label: 'RSI Momentum',

  entry: {
    /** false = pausa só NOVAS entradas — posição já comprada continua sendo gerenciada
     *  normalmente (bracket TP/SL, venda). */
    enabled: true,
    interval: '15m',
    rsiThreshold: 69,
    /** Ligado por padrão — confirma que o cruzamento não é só um repique de volatilidade: os
     *  `count` VALORES de RSI anteriores ao cruzamento (não candles — um valor de RSI por
     *  candle fechado do entry.interval) precisam ter ficado <= rsiThreshold. Sem isso, um RSI
     *  oscilando em torno do limiar (cruza, recua, cruza de novo) dispararia sinal a cada
     *  repique — ver evaluateEntrySignal em strategyEngine.js. */
    priorRsiFilter: { enabled: true, count: 3 },
    /** Desligado por padrão — quando ligado, arma ordem limite GTC em
     *  signalPrice*(1-belowPct/100) e espera até limitWaitCandles candles de 1 MINUTO por
     *  reteste — ver checkEntryLimitExpired em strategyEngine.js. Preenchimento e expiração são
     *  checados minuto a minuto (polling.pollMs), não no candle do entry.interval. Desligado
     *  (padrão) compra a mercado assim que o RSI confirma o cruzamento (candle fechado). */
    pullback: { enabled: false, belowPct: 0.5 },
    limitWaitCandles: 20,
    /** Ligado por padrão — confirmação ADIANTADA do cruzamento: em vez de só reavaliar o RSI de
     *  entry.interval quando esse candle fecha (podendo levar até `interval` inteiro), recalcula
     *  o mesmo RSI usando o fechamento do candle mais recente de `interval` (aqui, um intervalo
     *  mais curto, ex. 5m) já fechado DENTRO da janela do candle de entry.interval ainda em
     *  formação como preço provisório — se isso já cruza rsiThreshold, o sinal dispara ali (2-3
     *  checkpoints antes do fechamento cheio). O threshold e o RSI continuam sendo os de
     *  entry.interval — só o momento em que a confirmação é aceita adianta. Ver
     *  findEarlyConfirmCheckpoint/evaluateEntrySignal em strategyEngine.js. */
    earlyConfirm: { enabled: true, interval: '5m' },
    /** Após STOP_LOSS, espera N candles fechados do entry.interval antes de nova compra
     *  (evita reentrar no mesmo dump). Saída no alvo libera na hora. 0 = sem espera. */
    reentryCooldownCandles: 3,
    /** Filtro de largura de banda (mesmo motor do filtro de mercado "Larg%" — ver
     *  backend/utils/indicatorGrowthEngines.js#bollingerCycleOccurrences e o backtest): só
     *  libera entradas se a valorização média dos ciclos fundo→topo BB(period,stdDev) da
     *  moeda, no intervalo escolhido (pode ser diferente do entry.interval), for ≥ minPct.
     *  Ligado por padrão (mín. 2% no 5m). */
    bandWidth: {
      enabled: true, interval: '5m', period: 20, stdDev: 2, lookback: 300, minPct: 2,
    },
    /** Desligado por padrão — ainda não validado com trades reais o suficiente (ver análise em
     *  backend/bot/rsi-momentum/analyze-rsi5m-filter.js). Exige RSI(14) do candle 5m FECHADO no
     *  momento do sinal > threshold, além do cruzamento no entry.interval — tese: um RSI 5m já
     *  alto confirma que o momentum de curtíssimo prazo está junto com o sinal do entry.interval,
     *  em vez de ser só o 15m cruzando sozinho. */
    rsi5mFilter: { enabled: false, threshold: 70 },
    /** Ligado por padrão — recusa o sinal se o PRÓPRIO candle do cruzamento (abertura→fechamento)
     *  já subiu mais que maxMovePct%. Caso real que motivou o filtro: STORJUSDT 24/08/2026, candle
     *  de 15m que subiu +11% sozinho — o pullback de belowPct% (tipicamente <1%) protege só do
     *  fechamento já inflado, não do preço de antes do pump, então a compra saiu perto do topo do
     *  próprio candle do sinal. Ver checkSpikeGuardFilter em strategyEngine.js. */
    spikeGuard: { enabled: true, maxMovePct: 5 },
    /** Ligado por padrão (90%/4h×3). Exige que o preço do sinal esteja ATÉ o limite
     *  [-∞, lower + maxPct% × altura] da nuvem D-1 (banda entre abertura/fechamento do candle
     *  DIÁRIO nativo anterior ao dia do sinal — mesmo indicador do gráfico e do backtest, ver
     *  checkPrevDayCloudFilter em strategyEngine.js). maxPct=100 exigiria só estar até o topo da
     *  nuvem; 90% (padrão) restringe um pouco abaixo do topo. Preço ABAIXO da nuvem inteira
     *  também libera — desconto ainda maior que a própria nuvem; só bloqueia acima do limite
     *  (caro demais). interval: mesmo seletor do gráfico e do backtest em Estatísticas (padrão
     *  4h). candleCount: quantos candles anteriores entram no envelope da nuvem — 1 é só o
     *  candle anterior; N>1 junta os últimos N (menor/maior open+close entre eles); padrão 3.
     *  useHighLow: aumenta a nuvem usando máxima/mínima (pavios) em vez de abertura/fechamento
     *  (corpo) dos candles da janela — faixa mais larga; padrão ligado. */
    prevDayCloud: { enabled: true, maxPct: 90, interval: '4h', candleCount: 3, useHighLow: true },
    /** Ligado por padrão (1h) — confirmação de momentum por MACD (12/26/9 fixo, só o intervalo é
     *  configurável): só libera o sinal se o histograma (MACD − linha de sinal), no intervalo
     *  escolhido, estiver POSITIVO no candle fechado mais recente — mesma regra do backtest (ver
     *  checkMacdFilter em strategyEngine.js). Sem warmup suficiente ainda, libera (fail-open). */
    macdFilter: { enabled: true, interval: '1h' },
    /** Desligado por padrão — confirmação multi-timeframe pelo RSI de 1h (intervalo FIXO, o mesmo
     *  da coluna "RSI 1h" e do gráfico "Resultado por faixa de RSI 1h" em Estatísticas). Só libera
     *  o sinal se o RSI(14) do candle de 1h FECHADO mais recente estiver >= minRsi — o gatilho de
     *  entrada é de um intervalo menor (ex.: 15m), este filtro evita comprar o rompimento
     *  enquanto o timeframe maior ainda está fraco. Base: Elder Triple Screen, linha 50 do RSI,
     *  range rules de Brown/Cardwell. Sem candles de 1h suficientes ainda, libera (fail-open, como
     *  ADX/MACD). Ver checkHigherRsiFilter em strategyEngine.js. */
    higherRsiFilter: { enabled: false, minRsi: 50 },
  },

  exit: {
    /** Modo do ALVO — INDEPENDENTE do stop:
     *   'fixed'      (padrão) — alvo constante em restingBracket.targetPct% acima da entrada.
     *   'continuous' — alvo sobe em degraus com o pico de preço (contador próprio
     *                  trailingTarget.coinStepPct), base = restingBracket.targetPct.
     *   'off'        — sem alvo; a posição só sai pelo stop (na corretora o alvo é colocado
     *                  no teto permitido pela Binance, ~+100%, e na prática nunca é atingido). */
    targetMode: 'fixed',
    /** Ordem TP/SL resting na corretora (Binance: OCO real; Gate.io: emulado). targetPct = alvo
     *  em % sobre o preço de entrada — valor do alvo FIXO e base do alvo CONTÍNUO. */
    restingBracket: { enabled: true, targetPct: 5 },
    /** Degraus do ALVO contínuo (targetMode === 'continuous') — contador PRÓPRIO, independente
     *  do stop: a cada `coinStepPct`% de alta do PICO desde a entrada, o alvo sobe `stepPct`
     *  pontos percentuais acima da base (restingBracket.targetPct) — ver computeTrailingTargetPrice
     *  em strategyEngine.js. A perna do alvo é recriada na corretora quando sobe de degrau; a
     *  Binance limita a distância do alvo ao preço médio (PERCENT_PRICE_BY_SIDE), então um alvo
     *  que sobe muito acaba preso (clamp) na borda permitida — ver ocoClient.js. */
    trailingTarget: { coinStepPct: 3, stepPct: 3 },
    /** TETO DE LUCRO — venda FORÇADA em +pct%, independente do targetMode. Ligado por padrão
     *  (+15%): garante a saída em grandes altas que revertem antes do alvo contínuo preencher
     *  (o alvo contínuo persegue o pico ~5pp acima e pode nunca casar — ver EDENUSDT 28/08). Na
     *  corretora vira `min(alvo, entryPrice*(1+pct%))` na perna de alvo da bracket. Ver
     *  computeBracketPrices em strategyEngine.js. */
    hardTakeProfit: { enabled: true, pct: 15 },
    /** Desligado por padrão (stop fixo em stopLoss.maxLossPct). Ligado: STOP contínuo — sobe em
     *  degraus com o PICO de preço, sem nunca descer (monotônico). `mode` escolhe a mecânica (ver
     *  TRAILING_STOP_MODES acima e computeTrailingStopPrice em strategyEngine.js):
     *    'continuous' (padrão) — startPct/coinStepPct/stopStepPct.
     *    'twoPhase'  — pivotPct + degraus das fases A (aCoinStepPct/aStopStepPct) e B (bCoinStepPct/bStopStepPct).
     *    'peakTrail' — pivotGainPct + wNearPct/wFarPct (largura % abaixo do pico).
     *    'atrTrail'  — pivotGainPct + wNearPct (fase A) + atrMult/atrMaxPct (fase B por ATR%).
     *  startPct = distância inicial do stop (%), piso de todos os modos; cai em stopLoss.maxLossPct
     *  se não informado. */
    trailingStop: {
      enabled: true, mode: 'continuous', startPct: 5, coinStepPct: 3, stopStepPct: 2,
      pivotPct: 1, aCoinStepPct: 3, aStopStepPct: 2.5, bCoinStepPct: 3, bStopStepPct: 1,
      pivotGainPct: 5, wNearPct: 4, wFarPct: 9, atrMult: 2, atrMaxPct: 12,
    },
  },

  /** Modo percentual fixo (com trailing opcional injetado via exit.trailingStop acima, que tem
   *  a própria matemática de dois degraus — não usa o `trailing` de computeStopLossFloor). */
  stopLoss: { enabled: true, maxLossPct: 5 },

  /** pollMs curto (1min) por padrão: o pullback e a espera de fill são avaliados minuto a
   *  minuto (ver comentário de entry.pullback acima) — diferente do bollinger-bands, que só
   *  precisa acompanhar o candle do entry.interval (tipicamente 4h). fastPollMs (posição
   *  aberta) só precisa notar o fill do bracket resting — a corretora resolve o TP/SL sozinha
   *  em tempo real, independente do polling. */
  polling: { pollMs: 60_000, fastPollMs: 20_000 },

  /** Desliga o cooldown em horas do tradeExecution compartilhado (default 4h) — usa
   *  entry.reentryCooldownCandles no entry.interval após QUALQUER venda (diferente do
   *  bollinger-bands, que só aplica após STOP_LOSS — ver checkReentryCooldown em
   *  strategyEngine.js). */
  entryCooldownHours: 0,

  /** Só informativo (aviso no formulário) — nunca bloqueia compra/venda. */
  volume: { minVolumeUsdt: 1_000_000 },
};

function normalizeInterval(iv, fb) {
  return ALL_INTERVALS.includes(iv) ? iv : fb;
}

function normalizePriorRsiFilter(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.priorRsiFilter;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    count: Math.max(1, Math.min(10, Math.round(Number(src.count ?? d.count)))),
  };
}

function normalizePullback(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.pullback;
  const src = block ?? {};
  return {
    // Sem valor explícito no config salvo, cai no default (d.enabled) — não pode ser um booleano
    // fixo aqui, senão trocar o enabled do default some sem efeito pra quem nunca salvou config.
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    belowPct: Math.max(0.1, Math.min(20, Number(src.belowPct ?? d.belowPct))),
  };
}

function normalizeBandWidth(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.bandWidth;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    interval: normalizeInterval(src.interval, d.interval),
    period: BB_PERIODS.includes(Number(src.period)) ? Number(src.period) : d.period,
    stdDev: BB_STD_DEVS.includes(Number(src.stdDev)) ? Number(src.stdDev) : d.stdDev,
    lookback: Math.max(20, Math.min(1000, Math.round(Number(src.lookback ?? d.lookback)))),
    minPct: Math.max(0.1, Math.min(50, Number(src.minPct ?? d.minPct))),
  };
}

function normalizeRsi5mFilter(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.rsi5mFilter;
  const src = block ?? {};
  return {
    enabled: src.enabled === true,
    threshold: Math.max(50, Math.min(95, Number(src.threshold ?? d.threshold))),
  };
}

function normalizeEarlyConfirm(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.earlyConfirm;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    // Precisa ser mais curto que entry.interval pra fazer sentido como checkpoint — se não for
    // (config incoerente), evaluateEntrySignal (ver findEarlyConfirmCheckpoint) simplesmente não
    // encontra checkpoint e cai no comportamento original (só candle fechado), sem quebrar nada.
    interval: normalizeInterval(src.interval, d.interval),
  };
}

function normalizeSpikeGuard(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.spikeGuard;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    maxMovePct: Math.max(0.5, Math.min(50, Number(src.maxMovePct ?? d.maxMovePct))),
  };
}

function normalizePrevDayCloud(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.prevDayCloud;
  const src = block ?? {};
  return {
    // Mesmo motivo de normalizePullback acima — precisa cair no default (d.enabled), não num
    // booleano fixo, senão trocar o enabled do default não afeta quem nunca salvou config.
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    maxPct: Math.max(1, Math.min(100, Number(src.maxPct ?? d.maxPct))),
    interval: ALL_INTERVALS.includes(src.interval) ? src.interval : d.interval,
    candleCount: Math.max(1, Math.min(10, Math.round(Number(src.candleCount ?? d.candleCount)))),
    useHighLow: typeof src.useHighLow === 'boolean' ? src.useHighLow : d.useHighLow,
  };
}

function normalizeMacdFilter(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.macdFilter;
  const src = block ?? {};
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    interval: normalizeInterval(src.interval, d.interval),
  };
}

/** Filtro RSI 1h (confirmação multi-timeframe) — intervalo FIXO 1h, só `enabled` + `minRsi`
 *  (1..99). Mesmo shape do backtest (options.higherRsiFilter). */
function normalizeHigherRsiFilter(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry.higherRsiFilter;
  const src = block ?? {};
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    minRsi: Math.max(1, Math.min(99, Number(src.minRsi ?? d.minRsi))),
  };
}

function normalizeEntry(block) {
  const d = RSI_MOMENTUM_DEFAULTS.entry;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    interval: normalizeInterval(src.interval, d.interval),
    rsiThreshold: Math.max(50, Math.min(95, Number(src.rsiThreshold ?? d.rsiThreshold))),
    priorRsiFilter: normalizePriorRsiFilter(src.priorRsiFilter),
    pullback: normalizePullback(src.pullback),
    earlyConfirm: normalizeEarlyConfirm(src.earlyConfirm),
    limitWaitCandles: Math.max(1, Math.min(300, Math.round(Number(
      src.limitWaitCandles ?? d.limitWaitCandles,
    )))),
    reentryCooldownCandles: Math.max(0, Math.min(100, Math.round(Number(
      src.reentryCooldownCandles ?? d.reentryCooldownCandles,
    )))),
    bandWidth: normalizeBandWidth(src.bandWidth),
    rsi5mFilter: normalizeRsi5mFilter(src.rsi5mFilter),
    spikeGuard: normalizeSpikeGuard(src.spikeGuard),
    prevDayCloud: normalizePrevDayCloud(src.prevDayCloud),
    macdFilter: normalizeMacdFilter(src.macdFilter),
    higherRsiFilter: normalizeHigherRsiFilter(src.higherRsiFilter),
  };
}

function normalizeTrailingStop(block) {
  const d = RSI_MOMENTUM_DEFAULTS.exit.trailingStop;
  const src = block ?? {};
  const clamp = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Number(v ?? dflt)));
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    mode: TRAILING_STOP_MODES.includes(src.mode) ? src.mode : d.mode,
    startPct: clamp(src.startPct, 0.5, 50, d.startPct),
    // continuous
    coinStepPct: clamp(src.coinStepPct, 0.1, 50, d.coinStepPct),
    stopStepPct: clamp(src.stopStepPct, 0.1, 50, d.stopStepPct),
    // twoPhase (Escada Dupla) — pivotPct = lucro travado no fim da fase A (pode ser negativo)
    pivotPct: clamp(src.pivotPct, -5, 20, d.pivotPct),
    aCoinStepPct: clamp(src.aCoinStepPct, 0.1, 20, d.aCoinStepPct),
    aStopStepPct: clamp(src.aStopStepPct, 0.1, 20, d.aStopStepPct),
    bCoinStepPct: clamp(src.bCoinStepPct, 0.1, 20, d.bCoinStepPct),
    bStopStepPct: clamp(src.bStopStepPct, 0.1, 20, d.bStopStepPct),
    // peakTrail (Trilha do Topo) / atrTrail (Trilha ATR)
    pivotGainPct: clamp(src.pivotGainPct, 0.1, 50, d.pivotGainPct),
    wNearPct: clamp(src.wNearPct, 0.1, 50, d.wNearPct),
    wFarPct: clamp(src.wFarPct, 0.1, 50, d.wFarPct),
    atrMult: clamp(src.atrMult, 0.1, 10, d.atrMult),
    atrMaxPct: clamp(src.atrMaxPct, 0.5, 50, d.atrMaxPct),
  };
}

function normalizeTrailingTarget(block) {
  const d = RSI_MOMENTUM_DEFAULTS.exit.trailingTarget;
  const src = block ?? {};
  return {
    coinStepPct: Math.max(0.1, Math.min(50, Number(src.coinStepPct ?? d.coinStepPct))),
    stepPct: Math.max(0.1, Math.min(50, Number(src.stepPct ?? d.stepPct))),
  };
}

/** Teto de lucro (venda forçada) — { enabled, pct } (pct 1..200). */
function normalizeHardTakeProfit(block) {
  const d = RSI_MOMENTUM_DEFAULTS.exit.hardTakeProfit;
  const src = block ?? {};
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    pct: Math.max(1, Math.min(200, Number(src.pct ?? d.pct))),
  };
}

/** Modo do alvo — independente do stop. Sem `targetMode` salvo (config antiga), deriva do
 *  `trailingTarget.enabled` legado (true → contínuo, senão fixo). */
function normalizeTargetMode(block) {
  const m = block?.targetMode;
  if (m === 'fixed' || m === 'continuous' || m === 'off') return m;
  return block?.trailingTarget?.enabled === true ? 'continuous' : RSI_MOMENTUM_DEFAULTS.exit.targetMode;
}

function normalizeExit(block) {
  const d = RSI_MOMENTUM_DEFAULTS.exit;
  const rb = block?.restingBracket ?? {};
  return {
    targetMode: normalizeTargetMode(block),
    restingBracket: {
      enabled: rb.enabled !== false,
      targetPct: Math.max(0.1, Math.min(100, Number(rb.targetPct ?? d.restingBracket.targetPct))),
    },
    trailingTarget: normalizeTrailingTarget(block?.trailingTarget),
    trailingStop: normalizeTrailingStop(block?.trailingStop),
    hardTakeProfit: normalizeHardTakeProfit(block?.hardTakeProfit),
  };
}

function normalizeStopLoss(block) {
  const d = RSI_MOMENTUM_DEFAULTS.stopLoss;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    maxLossPct: Math.max(0.5, Math.min(30, Number(src.maxLossPct ?? d.maxLossPct))),
  };
}

function normalizeRsiMomentumConfig(body = {}) {
  const d = RSI_MOMENTUM_DEFAULTS;
  return {
    label: body.label ?? d.label,
    kind: 'rsi_momentum',
    entry: normalizeEntry(body.entry),
    exit: normalizeExit(body.exit),
    stopLoss: normalizeStopLoss(body.stopLoss),
    polling: {
      pollMs: Number(body.polling?.pollMs ?? d.polling.pollMs),
      fastPollMs: Number(body.polling?.fastPollMs ?? d.polling.fastPollMs),
    },
    volume: {
      minVolumeUsdt: Number(body.volume?.minVolumeUsdt ?? d.volume.minVolumeUsdt),
    },
    entryCooldownHours: Math.max(0, Number(body.entryCooldownHours ?? d.entryCooldownHours)),
  };
}

function toEngineConfig(normalized) {
  const c = normalized ?? normalizeRsiMomentumConfig();
  return {
    ...c,
    minVolumeUsdt: c.volume.minVolumeUsdt,
    pollMs: c.polling.pollMs,
    fastPollMs: c.polling.fastPollMs,
    entryCooldownHours: c.entryCooldownHours,
  };
}

function configFromRow(row) {
  if (!row) return null;
  let tc = row.trade_config;
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc); } catch { tc = null; }
  }
  if (tc?.kind === 'rsi_momentum') return toEngineConfig(normalizeRsiMomentumConfig(tc));
  return null;
}

function resolveStrategy(row) {
  const config = configFromRow(row);
  if (!config) return null;
  return {
    config,
    label: config.label,
    pollMs: config.pollMs,
    fastPollMs: config.fastPollMs,
  };
}

/** Forma "plana" usada pelo formulário do painel — mesmo shape de normalizeRsiMomentumConfig. */
function toFormState(body) {
  return normalizeRsiMomentumConfig(body);
}

module.exports = {
  ALL_INTERVALS,
  BB_PERIODS,
  BB_STD_DEVS,
  RSI_MOMENTUM_DEFAULTS,
  normalizeRsiMomentumConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toFormState,
};
