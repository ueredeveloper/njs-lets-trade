'use strict';

/**
 * Schema RSI Momentum: entra COMPRADO quando o RSI(14) do `entry.interval` cruza para cima de
 * `entry.rsiThreshold` (padrão 69 — sobrecompra, aposta de continuação, não reversão) — mesmo
 * motor de sinal do backtest (ver backend/utils/analyseRsiThresholdBacktest.js). Pullback
 * opcional (ordem limite `belowPct`% abaixo do preço do sinal) é avaliado minuto a minuto
 * (candles de 1m), independente do `entry.interval` do sinal — não espera o próximo candle de
 * 15m/1h fechar pra notar o preenchimento. Saída via bracket TP/SL FIXO (Binance: OCO real;
 * Gate.io: emulado) a partir do preço de entrada — sem trailing, sem ancorar em EMA/banda:
 * alvo = entryPrice*(1+targetPct%), stop = entryPrice*(1-maxLossPct%), constantes até o fill
 * (não precisa recriar por deriva, ao contrário do bollinger-bands/vwap-bands).
 */

const ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const BB_PERIODS = [10, 20, 30];
const BB_STD_DEVS = [1, 2, 3];

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
    /** Ligado por padrão — arma ordem limite GTC em signalPrice*(1-belowPct/100) e espera até
     *  limitWaitCandles candles de 1 MINUTO por reteste — ver checkEntryLimitExpired em
     *  strategyEngine.js. Preenchimento e expiração são checados minuto a minuto
     *  (polling.pollMs), não no candle do entry.interval. Desligar volta a comprar a mercado
     *  assim que o RSI confirma o cruzamento (candle fechado). */
    pullback: { enabled: true, belowPct: 0.5 },
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
    /** Desligado por padrão (novo, ainda sem validação com trades reais — mesma cautela do
     *  rsi5mFilter). Exige que o preço do sinal esteja DENTRO da nuvem D-1 (banda entre
     *  abertura/fechamento do candle DIÁRIO nativo anterior ao dia do sinal — mesmo indicador do
     *  gráfico e do backtest, ver checkPrevDayCloudFilter em strategyEngine.js), na faixa
     *  [lower, lower + maxPct% × altura]. maxPct=100 (padrão) só exige estar dentro da nuvem
     *  inteira; valores menores restringem à parte de baixo dela. Sempre intervalo 1d, fixo. */
    prevDayCloud: { enabled: false, maxPct: 100 },
  },

  exit: {
    /** Ordem TP/SL resting na corretora, colocada logo após a compra confirmar (Binance: OCO
     *  real; Gate.io: emulado). Alvo e stop são FIXOS (% sobre o preço de entrada) — nunca
     *  recalculados/recriados por deriva, ao contrário do bollinger-bands (banda se move a
     *  cada candle; aqui não há "banda" nenhuma pra perseguir). */
    restingBracket: { enabled: true, targetPct: 5 },
  },

  /** Só modo percentual fixo — sem trailing/EMA/banda (o backtest de referência também usa
   *  stop fixo a partir do preço de entrada). */
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
    enabled: src.enabled !== false,
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
    enabled: src.enabled === true,
    maxPct: Math.max(1, Math.min(100, Number(src.maxPct ?? d.maxPct))),
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
  };
}

function normalizeExit(block) {
  const d = RSI_MOMENTUM_DEFAULTS.exit;
  const rb = block?.restingBracket ?? {};
  return {
    restingBracket: {
      enabled: rb.enabled !== false,
      targetPct: Math.max(0.1, Math.min(100, Number(rb.targetPct ?? d.restingBracket.targetPct))),
    },
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
