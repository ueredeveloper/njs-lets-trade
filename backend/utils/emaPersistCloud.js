'use strict';

/**
 * Núcleo do indicador PERM (nuvem de inclinação EMA9×EMA21) portado pro backend — mesmo
 * algoritmo de frontend-react/src/utils/emaCrossPersistenceCloud.js, sem nada de DOM/React,
 * usado pelo filtro de entrada do bot Bollinger Bands (ver checkPermFilter em
 * backend/bot/bollinger-bands/strategyEngine.js).
 *
 * Não espera o cruzamento EMA9×EMA21 (atrasado). Inclinação (2 candles, pra um solavanco
 * isolado não parecer virada):
 *   d1[i]      = (EMA9[i] − EMA9[i−1]) / EMA9[i−1] × 100
 *   slopePct[i] = média dos últimos SLOPE_LOOKBACK (2) valores de d1
 */

const { buildMaTimeSeries } = require('./movingAverage');

const SLOPE_LOOKBACK = 2;
/** |slope%| abaixo disto = "quase estabilizando" (lado de baixa e de alta). */
const STABILIZE_PCT = 0.03;

/**
 * @param {number} slopePct média das últimas variações % da EMA9
 * @param {number|null} prevSlopePct slope do candle anterior (pra ver se acelera)
 * @param {'below'|'above'|null} side EMA9 abaixo ou acima da EMA21
 */
function classifyEma9SlopeState(slopePct, prevSlopePct, side) {
  if (!side || slopePct == null || !Number.isFinite(slopePct)) return null;
  if (side === 'below') {
    if (slopePct > 0) return 'turnUp';
    const accelerating = prevSlopePct == null || slopePct < prevSlopePct;
    if (accelerating) return 'fallAccel';
    if (slopePct <= -STABILIZE_PCT) return 'fallDecel';
    return 'fallFlat';
  }
  if (slopePct < 0) return 'turnDown';
  const accelerating = prevSlopePct == null || slopePct > prevSlopePct;
  if (accelerating) return 'riseAccel';
  if (slopePct >= STABILIZE_PCT) return 'riseDecel';
  return 'riseFlat';
}

/** Estados com tom VERDE — mesmo mapeamento de `tone` de SLOPE_STATE_META em
 *  frontend-react/src/utils/emaCrossPersistenceCloud.js. Inclui os dois lados: fallFlat/turnUp
 *  (EMA9 ainda ABAIXO da EMA21, mas quase estabilizando/já virando — reversão antecipada) e
 *  riseAccel/riseFlat (EMA9 já ACIMA, subindo). fallAccel/fallDecel/riseDecel/turnDown são
 *  vermelhos. */
const GREEN_STATES = new Set(['fallFlat', 'turnUp', 'riseAccel', 'riseFlat']);

function isGreenState(state) {
  return GREEN_STATES.has(state);
}

/** Libera a compra no filtro PERM: nuvem verde SEMPRE libera, mesmo o verde "antecipado" do
 *  lado abaixo da EMA21 (fallFlat/turnUp) — desde que as demais regras do bot Bollinger Bands
 *  também sejam atendidas (ver checkPermFilter em backend/bot/bollinger-bands/strategyEngine.js).
 *  Alias de isGreenState — nome mantido por compat com quem já importa esta função. */
function isEntryBullishState(state) {
  return isGreenState(state);
}

function sideOf(fast, slow) {
  if (fast < slow) return 'below';
  if (fast > slow) return 'above';
  return null;
}

function oneBarPct(curr, prev) {
  if (!(prev > 0) || !Number.isFinite(curr)) return null;
  return ((curr - prev) / prev) * 100;
}

function smoothSlopeAt(d1, i, lookback) {
  if (i < lookback) return null;
  let sum = 0;
  for (let k = 0; k < lookback; k++) {
    const v = d1[i - k];
    if (v == null || !Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / lookback;
}

/** [{time, fast, slow}] — merge EMA9/EMA21 pelo openTime (ms), só nos pontos com os dois. */
function mergeEma9Ema21(ema9Series, ema21Series) {
  const slowMap = new Map(ema21Series.map((p) => [Number(p.openTime), p.ma]));
  const merged = [];
  for (const p of ema9Series) {
    const t = Number(p.openTime);
    const slow = slowMap.get(t);
    if (slow == null || !Number.isFinite(p.ma)) continue;
    merged.push({ time: t, fast: p.ma, slow });
  }
  return merged;
}

/** [{time, fast, slow, slopePct, state}] a partir de séries EMA9/EMA21 já calculadas
 *  (buildMaTimeSeries — ver backend/utils/movingAverage.js). */
function computeSlopeStates(ema9Series, ema21Series) {
  const merged = mergeEma9Ema21(ema9Series ?? [], ema21Series ?? []);
  if (merged.length < SLOPE_LOOKBACK + 1) return [];
  const d1 = merged.map((m, i) => (i === 0 ? null : oneBarPct(m.fast, merged[i - 1].fast)));
  const slopePct = merged.map((_, i) => smoothSlopeAt(d1, i, SLOPE_LOOKBACK));
  return merged.map((m, i) => ({
    time: m.time,
    fast: m.fast,
    slow: m.slow,
    slopePct: slopePct[i],
    state: classifyEma9SlopeState(slopePct[i], i > 0 ? slopePct[i - 1] : null, sideOf(m.fast, m.slow)),
  }));
}

/** Estado PERM mais recente pra um array de candles (fechados) — null se não houver dados
 *  suficientes (menos de 21+3 candles pra ter EMA21 + slope de 2 candles). */
function latestPermState(candles, period9 = 9, period21 = 21) {
  const ema9 = buildMaTimeSeries(candles, period9);
  const ema21 = buildMaTimeSeries(candles, period21);
  const states = computeSlopeStates(ema9, ema21);
  if (!states.length) return null;
  return states[states.length - 1];
}

/** Série COMPLETA de estados PERM pra um array de candles — usada em backtest/estatísticas
 *  (ver analyseBollingerBandRecovery.js), onde é preciso o estado em CADA ponto do histórico,
 *  não só o mais recente (diferença pra latestPermState). */
function permStateSeries(candles, period9 = 9, period21 = 21) {
  const ema9 = buildMaTimeSeries(candles, period9);
  const ema21 = buildMaTimeSeries(candles, period21);
  return computeSlopeStates(ema9, ema21);
}

/** Busca binária pelo último ponto de `states` com `time <= alvo` (série ordenada por tempo). */
function lastStateAtOrBefore(states, time) {
  let lo = 0;
  let hi = states.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (states[mid].time <= time) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx < 0 ? null : states[idx];
}

/** Estado PERM já FECHADO em `atTime` (ms) — sem look-ahead: só considera candles cujo
 *  fechamento (openTime + intervalMs) já tenha acontecido até `atTime`, igual ao
 *  `closedCandlesOnly` que o bot ao vivo aplica antes de checar o filtro PERM (ver
 *  checkPermFilter em backend/bot/bollinger-bands/strategyEngine.js). null se ainda não havia
 *  candle fechado suficiente nesse ponto do histórico. */
function lastClosedPermStateAt(states, intervalMs, atTime) {
  if (!states?.length) return null;
  return lastStateAtOrBefore(states, atTime - intervalMs);
}

module.exports = {
  SLOPE_LOOKBACK,
  STABILIZE_PCT,
  classifyEma9SlopeState,
  isGreenState,
  isEntryBullishState,
  computeSlopeStates,
  latestPermState,
  permStateSeries,
  lastStateAtOrBefore,
  lastClosedPermStateAt,
};
