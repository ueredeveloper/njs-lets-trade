'use strict';

/**
 * Schema VWAP Bands — estratégia:
 *   1. Um candle fecha (close) acima da banda -1σ da VWAP de sessão, tendo fechado
 *      na/abaixo dela no candle anterior — confirma a reconquista. (O toque prévio na -2σ
 *      que caracteriza a exaustão é detectado por fora, pelo screener BB+VWAP do ma-cross —
 *      ver backend/bot/ma-cross/exhaustionScreener.js — não é verificado aqui.)
 *   2. Espera até `pullback.waitCandles` candles o preço retornar perto da -1σ
 *      (tolerância `pullback.tolerancePct`) — compra a mercado nesse retorno.
 *   3. Vende quando o preço alcança de volta a linha principal da VWAP.
 * Mesma regra se repete um degrau acima (fecha acima da linha principal → compra na
 * linha principal → vende na +1σ) — ver LADDER_SETUPS em strategyEngine.js.
 */

const ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const SESSIONS = ['daily', 'weekly'];

const VWAP_BANDS_DEFAULTS = {
  kind: 'vwap_bands',
  label: 'VWAP Bands',

  entry: {
    enabled: true,
    /** Intervalo dos candles de preço (fechamento/toque, compra/venda) — o "gráfico". */
    interval: '1h',
    /** Intervalo em que a VWAP+bandas é calculada — pode ser diferente do candle de
     *  preço (ex.: VWAP 4h com gráfico de 1h, que é como o usuário usa no painel do
     *  próprio app). Cada candle de preço usa o ponto vigente mais recente dessa série. */
    vwapInterval: '4h',
    session: 'weekly',
    /** Distância mínima (%) entre o nível de confirmação (onde compra) e o nível-alvo
     *  (onde vende) do degrau — bandas muito próximas dão pouco espaço de lucro e não
     *  compensam o risco/taxas. Degrau com distância abaixo disso é ignorado. */
    minBandDistancePct: 3,
    /** Quantos candles fechados pra trás ainda aceita uma reconquista como válida (desde
     *  que o nível tenha se mantido reconquistado desde então) — evita perder o sinal
     *  quando o bot está ocupado (ex.: já esperando o retorno de um degrau anterior) no
     *  exato candle em que a reconquista aconteceu. */
    reclaimLookbackCandles: 24,
    pullback: {
      /** Quantos candles (na unidade de entry.interval) espera o preço retornar perto da
       *  -1σ antes de cancelar. */
      waitCandles: 10,
      /** Tolerância (%) em torno da -1σ pra considerar "retornou". */
      tolerancePct: 1,
      /** Intervalo usado pra conferir o retorno candle a candle durante o PENDING — não
       *  precisa ser o mesmo de entry.interval. Esperar o candle principal (ex.: 1h)
       *  fechar pra conferir a reconquista deixa o preço passar batido pela banda dentro
       *  da própria hora; um intervalo mais rápido (15m) confere a cada 15min em vez de só
       *  na hora cheia — mesmo padrão do ema50Proximity.pollInterval do ma-cross.
       *  waitCandles continua contado na unidade de entry.interval. */
      pollInterval: '15m',
    },
  },

  exit: {
    /** Tolerância (%) pra considerar "alcançou" a linha principal da VWAP (0 = exata). */
    tolerancePct: 0,
    /** Checagem rápida de saída (mesmo padrão do exit.maCross.fastCheck do ma-cross):
     *  o alvo/stop só é conferido no candle FECHADO de entry.interval (ex.: 1h) — sem
     *  espiar o candle ainda em formação. Quando o fechamento já está perto o suficiente
     *  do alvo ou do stop (dentro de fastCheck.proximityPct), passa a conferir também os
     *  candles fechados do intervalo rápido (entry.pullback.pollInterval, ex.: 15m) a
     *  partir do fim do candle principal — assim reage ao toque sem esperar até 1h a
     *  mais quando já estava a poucos % de distância. */
    fastCheck: {
      enabled: true,
      proximityPct: 1,
    },
  },

  /**
   * mode 'ladder' (padrão): stop estrutural — usa o nível que foi TOCADO pra armar o
   * degrau (touchLevel) como piso, recalculado a cada tick a partir da VWAP ao vivo (ex.:
   * comprou no retorno à -1σ → stop na -2σ; comprou na linha principal → stop na -1σ).
   * mode 'percent': stop percentual/trailing tradicional (maxLossPct/trailing/
   * trailStepPct — mesmo mecanismo compartilhado do ma-cross).
   */
  stopLoss: {
    enabled: true,
    mode: 'ladder',
    tolerancePct: 0,
    maxLossPct: 5, trailing: true, trailStepPct: 5,
  },

  execution: {
    entryDiscount: 0.001,
  },

  polling: { pollMs: 60_000, fastPollMs: 30_000 },

  /** Só informativo (aviso no log) — nunca bloqueia compra/venda. */
  volume: { minVolumeUsdt: 1_000_000 },
};

const STOP_LOSS_MODES = ['ladder', 'percent'];

function normalizeInterval(iv, fb) {
  return ALL_INTERVALS.includes(iv) ? iv : fb;
}

function normalizeStopLoss(block) {
  const d = VWAP_BANDS_DEFAULTS.stopLoss;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    mode: STOP_LOSS_MODES.includes(src.mode) ? src.mode : d.mode,
    tolerancePct: Math.max(0, Number(src.tolerancePct ?? d.tolerancePct)),
    maxLossPct: Math.max(0.5, Number(src.maxLossPct ?? d.maxLossPct)),
    trailing: src.trailing !== false,
    trailStepPct: Math.max(0.5, Number(src.trailStepPct ?? src.maxLossPct ?? d.trailStepPct)),
  };
}

function normalizeSession(s, fb) {
  return SESSIONS.includes(s) ? s : fb;
}

function normalizeEntry(block) {
  const d = VWAP_BANDS_DEFAULTS.entry;
  const src = block ?? {};
  const pb = src.pullback ?? {};
  return {
    enabled: src.enabled !== false,
    interval: normalizeInterval(src.interval, d.interval),
    vwapInterval: normalizeInterval(src.vwapInterval, d.vwapInterval),
    session: normalizeSession(src.session, d.session),
    minBandDistancePct: Math.max(0, Number(src.minBandDistancePct ?? d.minBandDistancePct)),
    reclaimLookbackCandles: Math.max(1, Math.round(Number(src.reclaimLookbackCandles ?? d.reclaimLookbackCandles))),
    pullback: {
      waitCandles: Math.max(1, Math.round(Number(pb.waitCandles ?? d.pullback.waitCandles))),
      tolerancePct: Math.max(0, Number(pb.tolerancePct ?? d.pullback.tolerancePct)),
      pollInterval: normalizeInterval(pb.pollInterval, d.pullback.pollInterval),
    },
  };
}

function normalizeExit(block) {
  const d = VWAP_BANDS_DEFAULTS.exit;
  const fc = block?.fastCheck ?? {};
  return {
    tolerancePct: Math.max(0, Number(block?.tolerancePct ?? d.tolerancePct)),
    fastCheck: {
      enabled: fc.enabled !== false,
      proximityPct: Math.max(0, Number(fc.proximityPct ?? d.fastCheck.proximityPct)),
    },
  };
}

function normalizeVwapBandsConfig(body = {}) {
  const d = VWAP_BANDS_DEFAULTS;
  return {
    label: body.label ?? d.label,
    kind: 'vwap_bands',
    entry: normalizeEntry(body.entry),
    exit: normalizeExit(body.exit),
    stopLoss: normalizeStopLoss(body.stopLoss),
    execution: {
      entryDiscount: Number(body.execution?.entryDiscount ?? d.execution.entryDiscount),
    },
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
  const c = normalized ?? normalizeVwapBandsConfig();
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
  if (tc?.kind === 'vwap_bands') return toEngineConfig(normalizeVwapBandsConfig(tc));
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

/** Forma "plana" usada pelo formulário do painel (mesmo shape de normalizeVwapBandsConfig,
 *  sem os campos derivados só do motor — ver normalizeSwingConfig/toFormState do swing). */
function toFormState(body) {
  return normalizeVwapBandsConfig(body);
}

module.exports = {
  ALL_INTERVALS,
  SESSIONS,
  STOP_LOSS_MODES,
  VWAP_BANDS_DEFAULTS,
  normalizeVwapBandsConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toFormState,
};
