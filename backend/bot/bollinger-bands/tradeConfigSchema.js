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
  },

  exit: {
    /** Ordem TP/SL resting já na corretora, colocada logo após a compra confirmar (Binance:
     *  OCO real; Gate.io: emulado com 2 ordens de gatilho por preço). Alvo = banda superior
     *  ao vivo, stop = piso percentual (stopLoss.maxLossPct). Recriada quando o alvo ou o
     *  stop desviarem driftPct% do valor em que foi colocada — mesma mecânica do
     *  backend/bot/vwap-bands/vwap-bands-bot.js. */
    restingBracket: { enabled: true, driftPct: 3 },
  },

  /** Percentual/trailing — editável pelo usuário, com teto (normalizeStopLoss trava em 30%). */
  stopLoss: { enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5 },

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

function normalizeEntry(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.entry;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    interval: normalizeInterval(src.interval, d.interval),
    period: normalizePeriod(src.period, d.period),
    stdDev: normalizeStdDev(src.stdDev, d.stdDev),
    pullback: normalizePullback(src.pullback),
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

function normalizeStopLoss(block) {
  const d = BOLLINGER_BANDS_DEFAULTS.stopLoss;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    maxLossPct: Math.max(0.5, Math.min(30, Number(src.maxLossPct ?? d.maxLossPct))),
    trailing: src.trailing !== false,
    trailStepPct: Math.max(0.5, Number(src.trailStepPct ?? src.maxLossPct ?? d.trailStepPct)),
  };
}

function normalizeBollingerBandsConfig(body = {}) {
  const d = BOLLINGER_BANDS_DEFAULTS;
  return {
    label: body.label ?? d.label,
    kind: 'bollinger_bands',
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
  BOLLINGER_BANDS_DEFAULTS,
  normalizeBollingerBandsConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toFormState,
};
