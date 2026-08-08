'use strict';

/**
 * Schema Bollinger Bands — a estratégia mais simples do painel:
 *   1. A mínima do candle toca a banda inferior BB(period,stdDev) do intervalo escolhido
 *      → compra (ordem limite no preço da banda, ou pullback.belowPct% abaixo dela).
 *   2. Vende quando a máxima do candle toca a banda superior — via bracket TP/SL resting
 *      já colocada na corretora logo após a compra (Binance: OCO real; Gate.io: emulado),
 *      recriada quando o alvo/stop desviar exit.restingBracket.driftPct% do preço em que
 *      foi colocada (as bandas se movem a cada candle novo) — mesma mecânica do vwap-bands.
 * Sem escada, sem filtros extra (EMA/VWAP slope, tendência HTF etc.) — só as bandas do
 * próprio candle no intervalo escolhido.
 */

const ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const BB_PERIODS = [10, 20, 30];
const BB_STD_DEVS = [1, 2, 3];
const EMA_FILTER_PERIODS = [9, 21, 50, 200];

const BOLLINGER_BANDS_DEFAULTS = {
  kind: 'bollinger_bands',
  label: 'Bollinger Bands',

  entry: {
    enabled: true,
    interval: '4h',
    period: 20,
    stdDev: 2,
    /** Desligado por padrão — compra assim que a mínima do candle toca a banda inferior.
     *  Ligado: exige que o preço desça belowPct% ABAIXO da banda inferior antes de comprar
     *  (entrada mais "no fundo", ao custo de poder não disparar num repique raso). */
    pullback: { enabled: false, belowPct: 2 },
    /** Filtro de tendência (mesma ideia do maFilters adaptativo do ma-cross — ver
     *  MA_CROSS_DEFAULTS.maFilters em backend/bot/ma-cross/tradeConfigSchema.js): só compra
     *  se o preço estiver acima da EMA(period) do intervalo escolhido, com uma folga
     *  "adaptação inferior" de maxDipPct% abaixo da EMA ainda contando como "acima" (evita
     *  rejeitar por um toque raso, sem exigir estar estritamente acima). Ligado por padrão;
     *  interval segue o mesmo intervalo da banda de Bollinger (entry.interval) quando não
     *  informado — ver normalizeEmaFilter. */
    emaFilter: { enabled: true, period: 50, interval: '4h', maxDipPct: 2 },
  },

  exit: {
    /** Ordem TP/SL resting já na corretora, colocada logo após a compra confirmar (Binance:
     *  OCO real; Gate.io: emulado com 2 ordens de gatilho por preço). Alvo = banda superior
     *  ao vivo, stop = piso percentual (stopLoss.maxLossPct). Recriada quando o alvo ou o
     *  stop desviarem driftPct% do valor em que foi colocada — mesma mecânica do
     *  backend/bot/vwap-bands/vwap-bands-bot.js. */
    restingBracket: { enabled: true, driftPct: 3 },
  },

  /** Percentual/trailing — editável pelo usuário, com teto (normalizeStopLoss trava em 30%).
   *  mode: 'fixed' (padrão, como sempre foi) usa maxLossPct/trailing abaixo; mode: 'ema' troca
   *  o piso por uma linha de EMA que se move a cada verificação (ver computeStopPrice em
   *  strategyEngine.js) — stop = EMA(ema.period, ema.interval) * (1 − ema.belowPct/100). Sem
   *  trailing/peak nesse modo: o piso segue a EMA pra cima E pra baixo a cada tick. */
  stopLoss: {
    enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5,
    mode: 'fixed',
    // interval nasce igual ao entry.interval quando não informado — ver normalizeStopLoss.
    ema: { period: 50, interval: '4h', belowPct: 2 },
  },

  polling: { pollMs: 60_000, fastPollMs: 30_000 },

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
    emaFilter: normalizeEmaFilter(src.emaFilter, interval),
  };
}

function normalizeExit(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.exit;
  const rb = block?.restingBracket ?? {};
  return {
    restingBracket: {
      enabled: rb.enabled !== false,
      driftPct: Math.max(0.5, Number(rb.driftPct ?? d.restingBracket.driftPct)),
    },
  };
}

const STOP_LOSS_MODES = ['fixed', 'ema'];

function normalizeStopLossEma(block, entryInterval) {
  const d = BOLLINGER_BANDS_DEFAULTS.stopLoss.ema;
  const src = block ?? {};
  return {
    period: normalizeEmaPeriod(src.period, d.period),
    interval: normalizeInterval(src.interval, entryInterval ?? d.interval),
    belowPct: Math.max(0, Math.min(20, Number(src.belowPct ?? d.belowPct))),
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
  };
}

function toEngineConfig(normalized) {
  const c = normalized ?? normalizeBollingerBandsConfig();
  return {
    ...c,
    minVolumeUsdt: c.volume.minVolumeUsdt,
    pollMs: c.polling.pollMs,
    fastPollMs: c.polling.fastPollMs,
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
  BOLLINGER_BANDS_DEFAULTS,
  normalizeBollingerBandsConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toFormState,
};
