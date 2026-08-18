'use strict';

/**
 * Schema Bollinger Bands — a estratégia mais simples do painel:
 *   1. A mínima do candle toca a banda inferior BB(period,stdDev) do intervalo escolhido
 *      → compra (ordem limite no preço da banda, ou pullback.belowPct% abaixo dela).
 *   2. Vende quando a máxima do candle toca a banda superior — via bracket TP/SL resting
 *      já colocada na corretora logo após a compra (Binance: OCO real; Gate.io: emulado),
 *      recriada quando o alvo/stop desviar exit.restingBracket.driftPct% do preço em que
 *      foi colocada (as bandas se movem a cada candle novo) — mesma mecânica do vwap-bands.
 * Sem escada — só as bandas do próprio candle no intervalo escolhido, mais o filtro opcional
 * de tendência EMA (preço acima da EMA + inclinação da linha ≥ minSlopePct).
 */

const ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const BB_PERIODS = [10, 20, 30];
const BB_STD_DEVS = [1, 2, 3];
const EMA_FILTER_PERIODS = [9, 21, 50, 200];

const BOLLINGER_BANDS_DEFAULTS = {
  kind: 'bollinger_bands',
  label: 'Bollinger Bands',

  entry: {
    /** false = pausa só NOVAS entradas (evaluateEntrySignal retorna ENTRY_OFF) — posição já
     *  comprada continua sendo gerenciada/vendida normalmente (bracket TP/SL, cruzamento PERM
     *  etc.). Botão "Pausar entradas" no painel (BollingerBandsFavoriteModal/CurrencyTable). */
    enabled: true,
    interval: '4h',
    period: 20,
    stdDev: 2,
    /** Desligado por padrão — compra assim que a mínima do candle toca a banda inferior.
     *  Ligado: exige que o preço desça belowPct% ABAIXO da banda inferior antes de comprar
     *  (entrada mais "no fundo", ao custo de poder não disparar num repique raso). */
    pullback: { enabled: false, belowPct: 2 },
    /** Após armar ordem limite GTC no toque da banda, mantém no book por até N candles
     *  do intervalo da BB aguardando reteste (ex.: toque 05:34 → fill em 05:35). Ignorado
     *  quando instantFill está ligado. */
    limitWaitCandles: 5,
    /** Desligado por padrão — compra por ordem limite GTC no preço da banda, esperando
     *  reteste (limitWaitCandles). Ligado: ignora a ordem limite/reteste e compra a
     *  mercado assim que o sinal é confirmado (evaluateEntrySignal.allowed) — evita perder
     *  o movimento quando o preço toca a banda e sobe sem retestar, ao custo de uma entrada
     *  pior (preço do momento, não o da banda) e mais suscetível a toques falsos. */
    instantFill: false,
    /** Após STOP_LOSS, espera N candles fechados do intervalo da BB antes de nova compra
     *  (evita reentrar no mesmo dump). Saída no alvo (banda superior) não espera.
     *  0 = sem espera por candle. */
    reentryCooldownCandles: 3,
    /** Filtro de tendência: (1) só compra se o preço estiver acima da EMA(period) do
     *  intervalo escolhido, com folga "adaptação inferior" de maxDipPct% abaixo da EMA
     *  ainda contando como "acima" (evita rejeitar por um toque raso); (2) a própria linha
     *  da EMA precisa estar em alta — variação % vs. slopeLookback candles anteriores
     *  ≥ minSlopePct (padrão 10 candles / ≥ 0%: bloqueia se a EMA estiver caindo). Ligado
     *  por padrão; interval segue o mesmo intervalo da banda de Bollinger (entry.interval)
     *  quando não informado — ver normalizeEmaFilter. */
    emaFilter: {
      enabled: true, period: 50, interval: '4h', maxDipPct: 2,
      slopeLookback: 10, minSlopePct: 0,
    },
    /** Filtro de tendência da linha mediana (média) da própria Bollinger: média das
     *  variações candle-a-candle dos últimos `lookback` valores fechados da linha média
     *  precisa ser ≥ 0 (mediana não em queda) pra liberar a compra. Checado no sinal
     *  (evaluateEntrySignal) e de novo a cada tick enquanto a ordem limite de entrada
     *  aguarda fill — cancela a ordem se a mediana virar pra baixo antes do preenchimento.
     *  Ligado por padrão. */
    medianTrendFilter: { enabled: true, lookback: 10 },
    /** Filtro PERM (nuvem de inclinação EMA9×EMA21 — ver backend/utils/emaPersistCloud.js e o
     *  indicador "Perman." do gráfico): nuvem VERDE sempre libera a compra — inclusive o verde
     *  "antecipado" com a EMA9 ainda abaixo da EMA21 (fallFlat/turnUp, já estabilizando/virando),
     *  desde que as demais regras de entrada do bot também sejam atendidas (ver
     *  isEntryBullishState/isGreenState em backend/utils/emaPersistCloud.js). `interval` é
     *  INDEPENDENTE do intervalo da banda de Bollinger (entry.interval) — o usuário pode operar
     *  BB em 15m e checar o PERM em 4h, por exemplo. Padrão fixo '1h', não nasce igual ao
     *  entry.interval (diferente do emaFilter). Cascata quando o intervalo mais alto está sem
     *  estado disponível no momento (candle ausente/estado nulo/ainda não fechou): interval →
     *  metade → um quarto (ex.: 4h → 2h → 1h — mesma fórmula de getEmaPersistCloudConfirmInterval
     *  no frontend). Ligado por padrão.
     *  `exitOnCrossDown`: com a posição já comprada, se a EMA9 CRUZAR pra BAIXO da EMA21 depois
     *  da compra (não só "estar abaixo" — rastreia se já esteve acima em algum tick desde a
     *  compra antes de contar como cruzamento; cobre também o caso de entrada no verde
     *  antecipado, que só passa a vigiar depois de confirmar o lado de cima uma vez) vende a
     *  mercado na hora — cancela a bracket TP/SL resting antes, se houver — em vez de esperar o
     *  alvo/stop de preço. Ligado por padrão. Ver checkPermCrossExit em strategyEngine.js. */
    permFilter: { enabled: true, interval: '1h', exitOnCrossDown: true },
  },

  exit: {
    /** Ordem TP/SL resting já na corretora, colocada logo após a compra confirmar (Binance:
     *  OCO real; Gate.io: emulado com 2 ordens de gatilho por preço). Stop = piso percentual
     *  (stopLoss.maxLossPct) ou EMA/banda conforme stopLoss.mode. Alvo (TP) conforme
     *  targetMode: 'band' (padrão) = banda superior ao vivo, recriada quando o alvo ou o
     *  stop desviarem driftPct% do valor em que foi colocada — mesma mecânica do
     *  backend/bot/vwap-bands/vwap-bands-bot.js; 'fixed' = targetPct% de lucro fixo sobre o
     *  preço de compra, constante — não depende do bot recalcular, então a posição continua
     *  protegida na corretora mesmo se o bot cair. */
    restingBracket: { enabled: true, driftPct: 3, targetMode: 'band', targetPct: 3 },
  },

  /** Percentual/trailing — editável pelo usuário, com teto (normalizeStopLoss trava em 30%).
   *  mode: 'fixed' (padrão) usa maxLossPct/trailing; mode: 'ema' usa
   *  stop = EMA(ema.period, ema.interval) * (1 − ema.belowPct/100), caindo no piso %
   *  (maxLossPct) quando essa linha fica ≥ preço de compra (não protege long — ver
   *  computeStopPrice); mode: 'band' usa stop = banda inferior BB(entry.period,entry.stdDev)
   *  ao vivo * (1 − band.belowPct/100), mesma queda pro piso % se a banda ficar ≥ preço
   *  de compra. */
  stopLoss: {
    enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5,
    mode: 'fixed',
    // interval nasce igual ao entry.interval quando não informado — ver normalizeStopLoss.
    ema: { period: 50, interval: '4h', belowPct: 2 },
    band: { belowPct: 5 },
  },

  /** BB(4h/1h) não precisa da granularidade de 1m do vwap-bands — pollMs mais espaçado
   *  evita competir com o frontend pelas mesmas chamadas de candles na corretora (mesmo
   *  padrão do swing-bot/amap-bot: 5min parado, 1min com posição aberta). */
  polling: { pollMs: 5 * 60_000, fastPollMs: 60_000 },

  /** Desliga o cooldown em horas do tradeExecution compartilhado (DEFAULT 4h) — o
   *  bollinger usa entry.reentryCooldownCandles (só após STOP_LOSS) no intervalo da BB. */
  entryCooldownHours: 0,

  /** Só informativo (aviso no formulário) — nunca bloqueia compra/venda. */
  volume: { minVolumeUsdt: 1_000_000 },
};

function normalizeInterval(iv, fb) {
  return ALL_INTERVALS.includes(iv) ? iv : fb;
}

function normalizePeriod(p, fb) {
  const n = Number(p);
  return BB_PERIODS.includes(n) ? n : fb;
}

function normalizeStdDev(s, fb) {
  const n = Number(s);
  return BB_STD_DEVS.includes(n) ? n : fb;
}

function normalizePullback(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.entry.pullback;
  const src = block ?? {};
  return {
    enabled: src.enabled === true,
    belowPct: Math.max(0.1, Math.min(20, Number(src.belowPct ?? d.belowPct))),
  };
}

function normalizeEmaPeriod(p, fb) {
  const n = Number(p);
  return EMA_FILTER_PERIODS.includes(n) ? n : fb;
}

/** entryInterval = intervalo já normalizado da banda de Bollinger (entry.interval) — usado
 *  como fallback do intervalo da EMA quando não vier explícito, pra nascer "no mesmo
 *  intervalo da banda de Bollinger" por padrão. */
function normalizeEmaFilter(block, entryInterval) {
  const d = BOLLINGER_BANDS_DEFAULTS.entry.emaFilter;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    period: normalizeEmaPeriod(src.period, d.period),
    interval: normalizeInterval(src.interval, entryInterval ?? d.interval),
    maxDipPct: Math.max(0, Math.min(20, Number(src.maxDipPct ?? d.maxDipPct))),
    slopeLookback: Math.max(0, Math.min(48, Math.round(Number(src.slopeLookback ?? d.slopeLookback)))),
    minSlopePct: Math.max(-10, Math.min(5, Number(src.minSlopePct ?? d.minSlopePct))),
  };
}

function normalizeMedianTrendFilter(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.entry.medianTrendFilter;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    lookback: Math.max(2, Math.min(50, Math.round(Number(src.lookback ?? d.lookback)))),
  };
}

/** Diferente de normalizeEmaFilter: NÃO cai pro intervalo da banda de Bollinger quando não
 *  informado — o PERM é intencionalmente independente (padrão fixo '1h', ver defaults). */
function normalizePermFilter(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.entry.permFilter;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    interval: normalizeInterval(src.interval, d.interval),
    exitOnCrossDown: src.exitOnCrossDown !== false,
  };
}

function normalizeEntry(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.entry;
  const src = block ?? {};
  const interval = normalizeInterval(src.interval, d.interval);
  return {
    enabled: src.enabled !== false,
    interval,
    period: normalizePeriod(src.period, d.period),
    stdDev: normalizeStdDev(src.stdDev, d.stdDev),
    pullback: normalizePullback(src.pullback),
    limitWaitCandles: Math.max(1, Math.min(100, Math.round(Number(
      src.limitWaitCandles ?? d.limitWaitCandles,
    )))),
    instantFill: src.instantFill === true,
    reentryCooldownCandles: Math.max(0, Math.min(100, Math.round(Number(
      src.reentryCooldownCandles ?? d.reentryCooldownCandles,
    )))),
    emaFilter: normalizeEmaFilter(src.emaFilter, interval),
    medianTrendFilter: normalizeMedianTrendFilter(src.medianTrendFilter),
    permFilter: normalizePermFilter(src.permFilter),
  };
}

const RESTING_BRACKET_TARGET_MODES = ['band', 'fixed'];

function normalizeExit(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.exit;
  const rb = block?.restingBracket ?? {};
  return {
    restingBracket: {
      enabled: rb.enabled !== false,
      driftPct: Math.max(0.5, Number(rb.driftPct ?? d.restingBracket.driftPct)),
      targetMode: RESTING_BRACKET_TARGET_MODES.includes(rb.targetMode) ? rb.targetMode : d.restingBracket.targetMode,
      targetPct: Math.max(0.1, Math.min(100, Number(rb.targetPct ?? d.restingBracket.targetPct))),
    },
  };
}

const STOP_LOSS_MODES = ['fixed', 'ema', 'band'];

function normalizeStopLossEma(block, entryInterval) {
  const d = BOLLINGER_BANDS_DEFAULTS.stopLoss.ema;
  const src = block ?? {};
  return {
    period: normalizeEmaPeriod(src.period, d.period),
    interval: normalizeInterval(src.interval, entryInterval ?? d.interval),
    belowPct: Math.max(0, Math.min(20, Number(src.belowPct ?? d.belowPct))),
  };
}

function normalizeStopLossBand(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.stopLoss.band;
  const src = block ?? {};
  return {
    belowPct: Math.max(0, Math.min(50, Number(src.belowPct ?? d.belowPct))),
  };
}

/** entryInterval = intervalo já normalizado da banda de Bollinger — mesmo fallback usado por
 *  normalizeEmaFilter, pra stopLoss.ema.interval nascer no mesmo intervalo da entrada. */
function normalizeStopLoss(block, entryInterval) {
  const d = BOLLINGER_BANDS_DEFAULTS.stopLoss;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    maxLossPct: Math.max(0.5, Math.min(30, Number(src.maxLossPct ?? d.maxLossPct))),
    trailing: src.trailing !== false,
    trailStepPct: Math.max(0.5, Number(src.trailStepPct ?? src.maxLossPct ?? d.trailStepPct)),
    mode: STOP_LOSS_MODES.includes(src.mode) ? src.mode : d.mode,
    ema: normalizeStopLossEma(src.ema, entryInterval),
    band: normalizeStopLossBand(src.band),
  };
}

function normalizeBollingerBandsConfig(body = {}) {
  const d = BOLLINGER_BANDS_DEFAULTS;
  const entry = normalizeEntry(body.entry);
  return {
    label: body.label ?? d.label,
    kind: 'bollinger_bands',
    entry,
    exit: normalizeExit(body.exit),
    stopLoss: normalizeStopLoss(body.stopLoss, entry.interval),
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
  const c = normalized ?? normalizeBollingerBandsConfig();
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
  if (tc?.kind === 'bollinger_bands') return toEngineConfig(normalizeBollingerBandsConfig(tc));
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

/** Forma "plana" usada pelo formulário do painel — mesmo shape de normalizeBollingerBandsConfig. */
function toFormState(body) {
  return normalizeBollingerBandsConfig(body);
}

module.exports = {
  ALL_INTERVALS,
  BB_PERIODS,
  BB_STD_DEVS,
  EMA_FILTER_PERIODS,
  STOP_LOSS_MODES,
  RESTING_BRACKET_TARGET_MODES,
  BOLLINGER_BANDS_DEFAULTS,
  normalizeBollingerBandsConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toFormState,
};
