/**
 * Nuvem PERM — botão "Perman." no painel de indicadores do gráfico
 * (INDICATOR_GROUPS em CandlestickChart.jsx).
 *
 * Não espera o cruzamento EMA9×EMA21 (atrasado). Dois sinais antecipados, simétricos:
 *
 *  - Fundo (EMA9 < EMA21): a EMA9 para de cair e começa a subir → nuvem verde.
 *  - Topo (EMA9 > EMA21): a EMA9 para de subir e começa a cair → nuvem vermelha
 *    (prever o fim da alta, ainda acima da EMA21).
 *
 * Inclinação (2 candles, pra um solavanco isolado não parecer virada):
 *   d1[i]      = (EMA9[i] − EMA9[i−1]) / EMA9[i−1] × 100
 *   slopePct[i] = média dos últimos SLOPE_LOOKBACK (2) valores de d1
 */

import { buildEmaCrossMergedSeries } from './emaCrossSeries';

export const SLOPE_LOOKBACK = 2;
/** |slope%| abaixo disto = "quase estabilizando" (lado de baixa e de alta). */
export const STABILIZE_PCT = 0.03;

export const PERM_CLOUD_TONES = ['red', 'orange', 'yellow', 'green'];

export const PERM_TONE_SWATCH = {
  red: '#ef5350',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#26a69a',
};

export const DEFAULT_PERM_CLOUD_TONES = {
  red: true, orange: true, yellow: true, green: true,
};

export function normalizeEmaPersistCloudTones(raw) {
  const out = { ...DEFAULT_PERM_CLOUD_TONES };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of PERM_CLOUD_TONES) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

export const SLOPE_STATE_META = {
  fallAccel: { tone: 'red',    fillColor: 'rgba(239, 83, 80, 0.26)',  emoji: '🔴', label: 'queda forte' },
  fallDecel: { tone: 'orange', fillColor: 'rgba(251, 146, 60, 0.24)', emoji: '🟠', label: 'queda perdendo força' },
  fallFlat:  { tone: 'yellow', fillColor: 'rgba(250, 204, 21, 0.22)', emoji: '🟡', label: 'quase estabilizando' },
  turnUp:    { tone: 'green',  fillColor: 'rgba(38, 166, 154, 0.28)', emoji: '🟢', label: 'EMA9 subindo' },
  riseAccel: { tone: 'green',  fillColor: 'rgba(38, 166, 154, 0.26)', emoji: '🟢', label: 'alta forte' },
  riseDecel: { tone: 'orange', fillColor: 'rgba(251, 146, 60, 0.24)', emoji: '🟠', label: 'alta perdendo força' },
  riseFlat:  { tone: 'yellow', fillColor: 'rgba(250, 204, 21, 0.22)', emoji: '🟡', label: 'alta quase no topo' },
  turnDown:  { tone: 'red',    fillColor: 'rgba(239, 83, 80, 0.30)',  emoji: '🔴', label: 'EMA9 virando pra baixo' },
};

const MAX_HISTORY_CANDLES = 700;

const EMPTY_RESULT = {
  segments: [],
  lastSlopePct: null,
  lastState: null,
};

/**
 * @param {number} slopePct média das últimas variações % da EMA9
 * @param {number|null} prevSlopePct slope do candle anterior (pra ver se acelera)
 * @param {'below'|'above'} side EMA9 abaixo ou acima da EMA21
 * @returns {null|keyof typeof SLOPE_STATE_META}
 */
export function classifyEma9SlopeState(slopePct, prevSlopePct, side) {
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

export function formatEma9SlopeLegend(slopePct, state) {
  if (slopePct == null || !Number.isFinite(slopePct) || !state) return null;
  const meta = SLOPE_STATE_META[state];
  if (!meta) return null;
  const sign = slopePct > 0 ? '+' : '';
  return `${meta.emoji} ${sign}${slopePct.toFixed(2)}% — ${meta.label}`;
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

function sideOf(fast, slow) {
  if (fast < slow) return 'below';
  if (fast > slow) return 'above';
  return null;
}

/**
 * @param {Array} candlesticks
 * @param {Array} ma9
 * @param {Array} ma21
 * @returns {{ segments: Array<{points: Array<{time:number, upper:number, lower:number}>, fillColor: string}>,
 *             lastSlopePct: number|null, lastState: string|null }}
 */
export function buildEmaCrossPersistenceClouds(candlesticks, ma9, ma21) {
  const fullMerged = buildEmaCrossMergedSeries(candlesticks, ma9, ma21);
  if (fullMerged.length < SLOPE_LOOKBACK + 1) return EMPTY_RESULT;
  const merged = fullMerged.length > MAX_HISTORY_CANDLES
    ? fullMerged.slice(-MAX_HISTORY_CANDLES)
    : fullMerged;

  const d1 = merged.map((m, i) => (
    i === 0 ? null : oneBarPct(m.fast, merged[i - 1].fast)
  ));
  const slopePct = merged.map((_, i) => smoothSlopeAt(d1, i, SLOPE_LOOKBACK));

  const states = merged.map((m, i) => (
    classifyEma9SlopeState(slopePct[i], i > 0 ? slopePct[i - 1] : null, sideOf(m.fast, m.slow))
  ));

  const cloudPoint = (m) => ({
    time: m.time,
    upper: Math.max(m.fast, m.slow),
    lower: Math.min(m.fast, m.slow),
  });

  const segments = [];
  let runState = null;
  let runStart = -1;

  const flush = (endExclusive) => {
    if (runState == null || runStart < 0) return;
    const meta = SLOPE_STATE_META[runState];
    if (!meta) return;
    const from = Math.max(0, runStart - (endExclusive - runStart < 2 ? 1 : 0));
    const points = [];
    for (let i = from; i < endExclusive; i++) points.push(cloudPoint(merged[i]));
    if (points.length >= 2) segments.push({ points, fillColor: meta.fillColor, tone: meta.tone });
  };

  for (let i = 0; i < merged.length; i++) {
    const s = states[i];
    if (s === runState) continue;
    flush(i);
    runState = s;
    runStart = s == null ? -1 : i;
  }
  flush(merged.length);

  const lastIdx = merged.length - 1;
  return {
    segments,
    lastSlopePct: slopePct[lastIdx],
    lastState: states[lastIdx],
  };
}
