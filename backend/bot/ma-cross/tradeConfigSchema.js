'use strict';

/**
 * Schema MA Cross — parâmetros livres (períodos custom, múltiplos filtros, saída MA ou RSI).
 */

const MA_CROSS_PERIOD_MIN = 2;
const MA_CROSS_PERIOD_MAX = 500;

const ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const CROSS_DIRS    = ['cross_up', 'cross_down'];
const FILTER_MODES  = ['strict_above', 'adaptive', 'below', 'off'];
const RSI_PERIODS   = [7, 14, 21];
const RSI_OPS       = ['<', '<=', '>', '>='];

const MA_CROSS_DEFAULTS = {
  kind: 'ma_cross',
  label: 'MA Cross',

  entry: {
    enabled:         true,
    ma1:             { period: 9,  interval: '15m' },
    ma2:             { period: 21, interval: '15m' },
    direction:       'cross_up',
    tolerancePct:    0.1,
    /** Máx % acima da MA2 (param2) para permitir compra; 0 = desligado. */
    maxAboveMaPct:   3,
  },

  /** Tendência HTF: EMA curta acima da EMA longa (padrão EMA9 > EMA21 em 4h). */
  entryTrendMa: {
    enabled: true,
    ma1: { period: 9, interval: '4h' },
    ma2: { period: 21, interval: '4h' },
    /** Máx % abaixo da EMA longa ainda permitido (ex.: 2 = EMA9 até 2% abaixo da EMA21).
     *  Mantido baixo de proposito: exige que a EMA9(4h) esteja praticamente cruzando
     *  ou ja acima da EMA21(4h), nao so "perto" dela. Validado em BANKUSDT (09/07). */
    tolerancePct: 0.3,
  },

  maFiltersEnabled: true,
  /** Só adaptativa inferior (piso 0.5% abaixo da MA50 1h) — teto superior desligado
   *  (maxAbovePct: 0) de propósito, não bloqueia entrada por preço esticado acima da MA. */
  maFilters: [{
    id: 1, enabled: true, period: 50, interval: '1h',
    mode: 'adaptive', maxDipPct: 0.5, fixedDipPct: null, maxAbovePct: 0, fixedAbovePct: null, tolerancePct: 0,
  }],

  exit: {
    logic: 'any',
    maCross: {
      enabled:      true,
      ma1:          { period: 9,  interval: '30m' },
      ma2:          { period: 21, interval: '30m' },
      direction:    'cross_down',
      tolerancePct: 0.1,
    },
    rsi: {
      enabled:    false,
      logic:      'any',
      conditions: [
        { enabled: true, interval: '15m', period: 14, operator: '>', value: 70 },
      ],
    },
    /** Preço na/acima da banda superior da Bollinger Bands (topo) → vende. */
    bbUpper: {
      enabled:  false,
      interval: '4h',
      period:   20,
      stdDev:   2.0,
      /** % mínimo acima da banda superior para confirmar o rompimento (0 = basta tocar). */
      breakoutPct: 1,
    },
    /** Vende quando o ganho desde a entrada atinge targetPct — sugerido a partir da
     *  valorização média histórica fundo→topo da Bollinger Bands (ver analyseBollingerBandRecovery). */
    bbTakeProfit: {
      enabled:   false,
      targetPct: 6,
    },
  },

  stopLoss: { enabled: true, maxLossPct: 5, trailing: true, trailStepPct: 5 },

  execution: {
    immediateEntry:       false,
    entryDiscount:        0.001,
    pendingTimeoutMs:     90 * 60_000,
    pendingCancelPct:     0.002,
    pendingCancelOnExitRsi: true,
    /** Janela de até N candles após cruzamento; compra no 1º que passar (pullback + teto). */
    pullbackEntry: {
      enabled:         true,
      waitCandles:     2,
      requirePullback: true,
    },
  },

  polling: { pollMs: 60_000, fastPollMs: 30_000 },

  adaptiveOpts: {
    defaultPct:  3,
    maxPct:      8,
    minPct:      0.5,
    minEpisodes: 3,
    defaultAbovePct: 4,
    maxAbovePct:     8,
    minAbovePct:     0.5,
  },

  volume: {
    minVolumeUsdt:  3_000_000,
    allowLowVolume: false,
  },

  /** Filtro Bollinger Bands: %B do preço vs banda inferior/superior no intervalo HTF.
   *  %B = (close − lower) / (upper − lower); 0 = toca banda inferior, 1 = toca banda superior.
   *  Exige %B < maxPctB para permitir entrada (preço na metade inferior do range BB).
   *  Desligado por padrão — substituído pela regra entryEmaApproach (funil mostrou quase
   *  zero sobreposição entre as duas; empilhar as duas deixava a entrada rara demais). */
  entryBbFilter: {
    enabled:  false,
    interval: '4h',
    period:   20,
    stdDev:   2.0,
    /** Máx %B permitido (0–1); padrão 0.3 = preço nos 30% inferiores do range BB. */
    maxPctB:  0.3,
  },

  /** Aproximação + retomada: exige que a EMA rápida tenha formado um fundo perto da
   *  EMA lenta nos últimos candles e já esteja subindo de volta (não basta estar acima
   *  há muito tempo). Substitui o filtro BB 4h como filtro de entrada secundário.
   *  approachPct sugerido a partir de dados reais (ver analyze-ema-approach-4h.js):
   *  mediana do fundo histórico ficou em -0.85% antes da alta; 1.5% dá margem. */
  entryEmaApproach: {
    enabled: true,
    ma1: { period: 9, interval: '4h' },
    ma2: { period: 21, interval: '4h' },
    approachPct: 1.5,
  },

  /** Horas sem nova entrada após venda (0 = desligado). */
  entryCooldownHours: 4,

  /** Guard de reversão por candle (1h): bloqueia entrada se um candle de exaustão
   *  (vermelho, fecha no terço inferior do range, corpo grande) apareceu depois de
   *  uma perna de alta esticada, e o preço ainda não reconquistou a máxima desse
   *  candle. Cobre o atraso do entryTrendMa/entryEmaApproach (posição de EMA), que
   *  ainda ficam "de lado comprado" durante a própria reversão (ver estudo ARB 17/jul,
   *  ADA 04/jul, HOME/ALGO/KITE jul/2026). Desligado por padrão até calibrar por
   *  símbolo — habilitar manualmente por enquanto.
   */
  entryReversalGuard: {
    enabled: false,
    interval: '1h',
    /** Candles de histórico usados pra medir o tamanho da perna de alta antes do topo. */
    rallyLookbackCandles: 96,
    /** Por quantos candles, após um candle de exaustão, novas entradas ficam bloqueadas
     *  (a menos que o preço reconquiste a máxima do candle de exaustão antes disso). */
    cooldownCandles: 12,
    /** Alta mínima (%) desde a mínima do lookback até a máxima do candle de exaustão
     *  pra considerar que houve uma perna esticada (evita marcar qualquer candle
     *  vermelho comum como reversão). */
    minRallyPct: 8,
    /** Fechamento do candle de exaustão no máximo neste % do próprio range (0 = mínima). */
    maxClosePosPct: 30,
    /** Corpo real mínimo (%) do range do candle de exaustão. */
    minBodyPct: 45,
  },

  /** Gatilho de entrada alternativo/independente do cruzamento EMA: compra quando o
   *  preço toca/rompe a banda inferior da Bollinger Bands (fundo) — mesma lógica do
   *  exit.bbUpper espelhada pra baixo. Pode ser usado sozinho (desligando entry,
   *  entryTrendMa e entryEmaApproach) ou combinado com o cruzamento EMA: qualquer um
   *  dos dois gatilhos dispara a compra. Entra imediatamente, sem fase PENDING/pullback
   *  (a própria banda inferior já é o "fundo" que o pullback do cruzamento tenta achar). */
  entryBbLower: {
    enabled:  false,
    interval: '4h',
    period:   20,
    stdDev:   2.0,
    /** % mínimo abaixo da banda inferior para confirmar o toque (0 = basta tocar). */
    breakoutPct: 0,
  },
};

function isValidMaCrossPeriod(p) {
  const n = parseInt(p, 10);
  return Number.isFinite(n) && n >= MA_CROSS_PERIOD_MIN && n <= MA_CROSS_PERIOD_MAX;
}

function clampPeriod(p, fb = 50) {
  const n = Number(p);
  if (!Number.isFinite(n) || n < MA_CROSS_PERIOD_MIN) return fb;
  return Math.min(MA_CROSS_PERIOD_MAX, Math.round(n));
}

function normalizeInterval(iv, fb) {
  return ALL_INTERVALS.includes(iv) ? iv : fb;
}

function normalizeMaLeg(m, fallback) {
  const fb = fallback ?? { period: 50, interval: '1h' };
  return {
    period:   clampPeriod(m?.period, fb.period),
    interval: normalizeInterval(m?.interval, fb.interval),
  };
}

function normalizeCrossBlock(block, fallback) {
  const fb = fallback ?? MA_CROSS_DEFAULTS.entry;
  return {
    enabled:      block?.enabled !== false,
    ma1:          normalizeMaLeg(block?.ma1 ?? block?.param1, fb.ma1),
    ma2:          normalizeMaLeg(block?.ma2 ?? block?.param2, fb.ma2),
    direction:       CROSS_DIRS.includes(block?.direction) ? block.direction : fb.direction,
    tolerancePct:    Math.max(0, Number(block?.tolerancePct ?? fb.tolerancePct ?? 0)),
    maxAboveMaPct:   Math.max(0, Number(block?.maxAboveMaPct ?? fb.maxAboveMaPct ?? 0)),
  };
}

function normalizeMaFilter(m, i = 0) {
  const mode = FILTER_MODES.includes(m?.mode) ? m.mode : 'strict_above';
  return {
    id:       m?.id ?? i + 1,
    enabled:  m?.enabled !== false && mode !== 'off',
    period:   clampPeriod(m?.period, 50),
    interval: normalizeInterval(m?.interval, '1h'),
    mode,
    maxDipPct:   Math.max(0, Number(m?.maxDipPct ?? 4)),
    fixedDipPct: m?.fixedDipPct != null && m?.fixedDipPct !== '' ? Number(m?.fixedDipPct) : null,
    maxAbovePct: Math.max(0, Number(m?.maxAbovePct ?? 4)),
    fixedAbovePct: m?.fixedAbovePct != null && m?.fixedAbovePct !== '' ? Number(m?.fixedAbovePct) : null,
    tolerancePct: Math.max(0, Number(m?.tolerancePct ?? 0)),
  };
}

function normalizeEntryBbFilter(block) {
  const d = MA_CROSS_DEFAULTS.entryBbFilter;
  const src = block ?? {};
  return {
    enabled:  src.enabled === true,
    interval: normalizeInterval(src.interval, d.interval),
    period:   clampPeriod(src.period, d.period),
    stdDev:   Math.max(0.5, Math.min(4, Number(src.stdDev  ?? d.stdDev))),
    maxPctB:  Math.max(0,   Math.min(1, Number(src.maxPctB ?? d.maxPctB))),
  };
}

function normalizeExitBbUpper(block, fallback) {
  const fb = fallback ?? MA_CROSS_DEFAULTS.exit.bbUpper;
  const src = block ?? {};
  return {
    enabled:     src.enabled === true,
    interval:    normalizeInterval(src.interval, fb.interval),
    period:      clampPeriod(src.period, fb.period),
    stdDev:      Math.max(0.5, Math.min(4, Number(src.stdDev ?? fb.stdDev))),
    breakoutPct: Math.max(0, Math.min(20, Number(src.breakoutPct ?? fb.breakoutPct ?? 0))),
  };
}

function normalizeEntryBbLower(block) {
  const d = MA_CROSS_DEFAULTS.entryBbLower;
  const src = block ?? {};
  return {
    enabled:     src.enabled === true,
    interval:    normalizeInterval(src.interval, d.interval),
    period:      clampPeriod(src.period, d.period),
    stdDev:      Math.max(0.5, Math.min(4, Number(src.stdDev ?? d.stdDev))),
    breakoutPct: Math.max(0, Math.min(20, Number(src.breakoutPct ?? d.breakoutPct ?? 0))),
  };
}

function normalizeExitBbTakeProfit(block, fallback) {
  const fb = fallback ?? MA_CROSS_DEFAULTS.exit.bbTakeProfit;
  const src = block ?? {};
  return {
    enabled:   src.enabled === true,
    targetPct: Math.max(0.5, Number(src.targetPct ?? fb.targetPct)),
  };
}

function normalizeEntryTrendMa(block) {
  const d = MA_CROSS_DEFAULTS.entryTrendMa;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    ma1: normalizeMaLeg(src.ma1, d.ma1),
    ma2: normalizeMaLeg(src.ma2, d.ma2),
    tolerancePct: Math.max(0, Number(src.tolerancePct ?? d.tolerancePct ?? 0)),
  };
}

function normalizeEntryEmaApproach(block) {
  const d = MA_CROSS_DEFAULTS.entryEmaApproach;
  const src = block ?? {};
  return {
    enabled: src.enabled !== false,
    ma1: normalizeMaLeg(src.ma1, d.ma1),
    ma2: normalizeMaLeg(src.ma2, d.ma2),
    approachPct: Math.max(0, Number(src.approachPct ?? d.approachPct ?? 0)),
  };
}

function normalizeEntryReversalGuard(block) {
  const d = MA_CROSS_DEFAULTS.entryReversalGuard;
  const src = block ?? {};
  return {
    enabled:              src.enabled === true,
    interval:             normalizeInterval(src.interval, d.interval),
    rallyLookbackCandles: Math.max(1, Math.round(Number(src.rallyLookbackCandles ?? d.rallyLookbackCandles))),
    cooldownCandles:      Math.max(1, Math.round(Number(src.cooldownCandles ?? d.cooldownCandles))),
    minRallyPct:          Math.max(0, Number(src.minRallyPct ?? d.minRallyPct)),
    maxClosePosPct:       Math.max(0, Math.min(100, Number(src.maxClosePosPct ?? d.maxClosePosPct))),
    minBodyPct:           Math.max(0, Math.min(100, Number(src.minBodyPct ?? d.minBodyPct))),
  };
}

function normalizePullbackEntry(pb) {
  const d = MA_CROSS_DEFAULTS.execution.pullbackEntry;
  const src = pb ?? {};
  return {
    enabled:         src.enabled ?? d.enabled,
    waitCandles:     Math.max(1, Math.round(Number(src.waitCandles ?? d.waitCandles))),
    requirePullback: src.requirePullback ?? d.requirePullback,
  };
}

function normalizeRsiCondition(c, i = 0) {
  const fb = MA_CROSS_DEFAULTS.exit.rsi.conditions[0];
  return {
    id:       c?.id ?? i + 1,
    enabled:  c?.enabled !== false,
    interval: normalizeInterval(c?.interval, fb.interval),
    period:   Number(c?.period ?? fb.period),
    operator: RSI_OPS.includes(c?.operator) ? c.operator : fb.operator,
    value:    Number(c?.value ?? fb.value),
  };
}

function migrateMaFilters(body) {
  if (Array.isArray(body.maFilters) && body.maFilters.length) {
    return body.maFilters.map(normalizeMaFilter);
  }
  const pf = body.priceFilter ?? body.param3;
  if (!pf) return MA_CROSS_DEFAULTS.maFilters.map(f => ({ ...f }));
  return [normalizeMaFilter({
    ...pf,
    mode: pf.mode ?? 'strict_above',
    enabled: pf.enabled !== false,
  })];
}

function normalizeMaCrossConfig(body = {}) {
  const d = MA_CROSS_DEFAULTS;
  const exitBody = body.exit ?? {};

  const maCrossExit = normalizeCrossBlock(
    exitBody.maCross ?? (exitBody.ma1 ? exitBody : null) ?? d.exit.maCross,
    d.exit.maCross,
  );

  const rsiRaw = exitBody.rsi ?? {};
  const rsiConditions = Array.isArray(rsiRaw.conditions) && rsiRaw.conditions.length
    ? rsiRaw.conditions.map(normalizeRsiCondition)
    : rsiRaw.interval
      ? [normalizeRsiCondition(rsiRaw)]
      : d.exit.rsi.conditions.map(normalizeRsiCondition);

  return {
    label: body.label ?? d.label,
    kind:  'ma_cross',
    entry: normalizeCrossBlock(body.entry, d.entry),
    entryTrendMa:   normalizeEntryTrendMa(body.entryTrendMa),
    entryEmaApproach: normalizeEntryEmaApproach(body.entryEmaApproach),
    entryBbFilter:  normalizeEntryBbFilter(body.entryBbFilter),
    entryBbLower:   normalizeEntryBbLower(body.entryBbLower),
    entryReversalGuard: normalizeEntryReversalGuard(body.entryReversalGuard),
    maFiltersEnabled: body.maFiltersEnabled !== false,
    maFilters: migrateMaFilters(body),
    exit: {
      logic: ['any', 'all'].includes(exitBody.logic) ? exitBody.logic : d.exit.logic,
      maCross: {
        ...maCrossExit,
        enabled: exitBody.maCross?.enabled ?? (exitBody.ma1 ? true : d.exit.maCross.enabled),
      },
      rsi: {
        enabled:    rsiRaw.enabled === true,
        logic:      ['any', 'all'].includes(rsiRaw.logic) ? rsiRaw.logic : d.exit.rsi.logic,
        conditions: rsiConditions,
      },
      bbUpper:      normalizeExitBbUpper(exitBody.bbUpper, d.exit.bbUpper),
      bbTakeProfit: normalizeExitBbTakeProfit(exitBody.bbTakeProfit, d.exit.bbTakeProfit),
    },
    stopLoss: {
      enabled:      body.stopLoss?.enabled !== false,
      maxLossPct:   Math.max(0.5, Number(body.stopLoss?.maxLossPct ?? d.stopLoss.maxLossPct)),
      trailing:     body.stopLoss?.trailing !== false,
      trailStepPct: Math.max(0.5, Number(body.stopLoss?.trailStepPct ?? body.stopLoss?.maxLossPct ?? d.stopLoss.trailStepPct)),
    },
    execution: {
      immediateEntry:         body.execution?.immediateEntry === true,
      entryDiscount:          Number(body.execution?.entryDiscount ?? d.execution.entryDiscount),
      pendingTimeoutMs:       Number(body.execution?.pendingTimeoutMs ?? d.execution.pendingTimeoutMs),
      pendingCancelPct:       Number(body.execution?.pendingCancelPct ?? d.execution.pendingCancelPct),
      pendingCancelOnExitRsi: body.execution?.pendingCancelOnExitRsi ?? d.execution.pendingCancelOnExitRsi,
      pullbackEntry: normalizePullbackEntry(body.execution?.pullbackEntry),
    },
    polling: {
      pollMs:     Number(body.polling?.pollMs ?? d.polling.pollMs),
      fastPollMs: Number(body.polling?.fastPollMs ?? d.polling.fastPollMs),
    },
    adaptiveOpts: {
      ...d.adaptiveOpts,
      ...(body.adaptiveOpts ?? {}),
      maxPct: Math.max(0.5, Number(body.adaptiveOpts?.maxPct ?? d.adaptiveOpts.maxPct)),
      maxAbovePct: Math.max(0.5, Number(body.adaptiveOpts?.maxAbovePct ?? d.adaptiveOpts.maxAbovePct)),
    },
    volume: {
      minVolumeUsdt:  Number(body.volume?.minVolumeUsdt ?? d.volume.minVolumeUsdt),
      allowLowVolume: body.volume?.allowLowVolume === true,
    },
    entryCooldownHours: Math.max(0, Number(body.entryCooldownHours ?? d.entryCooldownHours)),
  };
}

function toEngineConfig(normalized) {
  const c = normalized ?? normalizeMaCrossConfig();
  return {
    ...c,
    minVolumeUsdt:    c.volume.minVolumeUsdt,
    allowLowVolume:   c.volume.allowLowVolume,
    pollMs:           c.polling.pollMs,
    fastPollMs:       c.polling.fastPollMs,
    entryDiscount:    c.execution.entryDiscount,
    immediateEntry:   c.execution.immediateEntry,
    pendingTimeoutMs: c.execution.pendingTimeoutMs,
    pendingCancelPct: c.execution.pendingCancelPct,
    pendingCancelOnExitRsi: c.execution.pendingCancelOnExitRsi,
  };
}

function configFromRow(row) {
  if (!row) return null;
  let tc = row.trade_config;
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc); } catch { tc = null; }
  }
  if (tc?.kind === 'ma_cross') return toEngineConfig(normalizeMaCrossConfig(tc));
  return null;
}

function resolveStrategy(row) {
  const config = configFromRow(row);
  if (!config) return null;
  return {
    config,
    label: config.label,
    pollMs:           config.pollMs,
    fastPollMs:       config.fastPollMs,
    entryDiscount:    config.entryDiscount,
    immediateEntry:   config.immediateEntry,
    pendingTimeoutMs: config.pendingTimeoutMs,
    pendingCancelPct: config.pendingCancelPct,
    pendingCancelOnExitRsi: config.pendingCancelOnExitRsi,
  };
}

function toFormState(body) {
  return normalizeMaCrossConfig(body);
}

function formStateToPayload(form) {
  return normalizeMaCrossConfig(form);
}

module.exports = {
  MA_CROSS_PERIOD_MIN,
  MA_CROSS_PERIOD_MAX,
  isValidMaCrossPeriod,
  MA_CROSS_DEFAULTS,
  ALL_INTERVALS,
  CROSS_DIRS,
  FILTER_MODES,
  RSI_PERIODS,
  normalizeMaCrossConfig,
  toEngineConfig,
  configFromRow,
  resolveStrategy,
  toFormState,
  formStateToPayload,
};
