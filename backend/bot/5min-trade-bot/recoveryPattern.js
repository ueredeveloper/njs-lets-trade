'use strict';

const { RECOVERY_PATTERN_TYPES, normalizeRecoveryPattern } = require('./recoveryPatternConfig');
const { maThreshold } = require('./maFilter');

function isGreen(c) {
  return c.close > c.open;
}

/** Definições dos padrões 1h (candles já fechados). */
const PATTERN_DEFS = {
  two_green: {
    candles: 2,
    visual:  [true, true],
    match:   g => g.length === 2 && g.every(Boolean),
  },
  two_one: {
    candles: 3,
    visual:  [true, true, false],
    match:   g => g.length === 3 && g[0] && g[1] && !g[2],
  },
  three_green: {
    candles: 3,
    visual:  [true, true, true],
    match:   g => g.length === 3 && g.every(Boolean),
  },
  three_one: {
    candles: 4,
    visual:  [true, true, true, false],
    match:   g => g.length === 4 && g[0] && g[1] && g[2] && !g[3],
  },
  five_green: {
    candles: 5,
    visual:  [true, true, true, true, true],
    match:   g => g.length === 5 && g.every(Boolean),
  },
};

function greensEndingAt(candles1h, endIdx, count) {
  if (endIdx < count - 1 || endIdx >= candles1h.length) return null;
  const slice = candles1h.slice(endIdx - count + 1, endIdx + 1);
  if (slice.length !== count) return null;
  return slice.map(isGreen);
}

function patternMatchesAt(candles1h, endIdx, type) {
  const def = PATTERN_DEFS[type];
  if (!def) return false;
  const greens = greensEndingAt(candles1h, endIdx, def.candles);
  return greens != null && def.match(greens);
}

/** Índice do último candle 1h fechado antes de timeMs. */
function lastClosed1hIndex(candles1h, timeMs) {
  if (!candles1h?.length) return -1;
  const limit = candles1h.length - 1; // exclui candle aberto
  let idx = -1;
  for (let i = 0; i < limit; i++) {
    const closeTime = (candles1h[i].openTime ?? 0) + 3_600_000;
    if (closeTime <= timeMs) idx = i;
    else break;
  }
  return idx;
}

function threeRedsAt(candles1h, endIdx) {
  const colors = greensEndingAt(candles1h, endIdx, 3);
  return colors != null && colors.every(g => !g);
}

/** Estado ao vivo — padrões nos últimos candles 1h fechados. */
function checkRecoveryPatternsLive(candles1h, selectedTypes = null) {
  if (!candles1h || candles1h.length < 6) {
    return { ok: false, reason: 'candles_1h_insuficientes' };
  }
  const completed = candles1h.slice(0, -1);
  const endIdx    = completed.length - 1;
  const active    = {};

  for (const type of RECOVERY_PATTERN_TYPES) {
    active[type] = patternMatchesAt(completed, endIdx, type);
  }

  const types = Array.isArray(selectedTypes)
    ? selectedTypes.filter(t => RECOVERY_PATTERN_TYPES.includes(t))
    : (selectedTypes && RECOVERY_PATTERN_TYPES.includes(selectedTypes) ? [selectedTypes] : []);
  const selectedActive = types.length
    ? types.some(t => active[t])
    : false;
  const threeReds = threeRedsAt(completed, endIdx);

  return {
    ok:             true,
    active,
    selectedTypes:  types.length ? types : null,
    selectedActive,
    threeReds,
    confirmed:      types.length ? selectedActive : Object.values(active).some(Boolean),
    // legado
    selectedType:   types[0] ?? null,
    threeCandles:   active.three_green,
    fourCandles:    active.three_one,
    lastPatternVisual: types[0] ? PATTERN_DEFS[types[0]]?.visual : null,
  };
}

function getPatternVisual(type) {
  return PATTERN_DEFS[type]?.visual ?? [];
}

/**
 * Verifica se entrada é permitida com padrão + zona MA.
 * @param {number} price
 * @param {number} ma
 * @param {number} tolerancePct — calibragem % do filtro MA
 * @param {object} recoveryPattern — { types, zones, abovePct }
 * @param {object} patternLive — resultado de checkRecoveryPatternsLive
 */
function evaluateRecoveryEntry(price, ma, tolerancePct, recoveryPattern, patternLive) {
  const cfg = normalizeRecoveryPattern(recoveryPattern);
  if (!cfg.types.length) {
    return { ok: true, reason: 'sem_padrao_configurado' };
  }

  const patternOk = cfg.types.some(t => !!patternLive?.active?.[t]);
  const floor     = ma != null ? maThreshold(ma, 'above', tolerancePct) : null;
  const aboveLine = ma != null ? ma * (1 + (cfg.abovePct ?? 5) / 100) : null;

  const inAboveZone   = cfg.zones.includes('above_ma') && ma != null && price >= aboveLine;
  const inBetweenZone = cfg.zones.includes('between_ma') && ma != null && floor != null
    && price >= floor && price < ma;

  if (!inAboveZone && !inBetweenZone) {
    return {
      ok: true,
      patternRequired: false,
      reason: 'fora_das_zonas_do_padrao',
      inAboveZone: false,
      inBetweenZone: false,
      patternOk,
      threeReds: !!patternLive?.threeReds,
    };
  }

  if (patternLive?.threeReds) {
    return {
      ok: false,
      patternRequired: true,
      reason: 'tres_vermelhos_1h',
      zone: inAboveZone ? 'above_ma' : 'between_ma',
      inAboveZone,
      inBetweenZone,
      patternOk: false,
      threeReds: true,
      aboveLine,
      floor,
    };
  }

  if (!patternOk) {
    const zone = inAboveZone ? 'above_ma' : 'between_ma';
    return {
      ok: false,
      patternRequired: true,
      reason: 'padrao_ausente_na_zona',
      zone,
      inAboveZone,
      inBetweenZone,
      patternOk: false,
      aboveLine,
      floor,
    };
  }

  return {
    ok: true,
    patternRequired: true,
    patternOk: true,
    inAboveZone,
    inBetweenZone,
    zone: inAboveZone ? 'above_ma' : 'between_ma',
    aboveLine,
    floor,
  };
}

module.exports = {
  PATTERN_DEFS,
  isGreen,
  patternMatchesAt,
  threeRedsAt,
  lastClosed1hIndex,
  checkRecoveryPatternsLive,
  getPatternVisual,
  evaluateRecoveryEntry,
};
