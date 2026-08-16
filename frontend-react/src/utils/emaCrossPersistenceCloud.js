/**
 * Nuvem PERM — botão "Perman." no painel de indicadores do gráfico
 * (INDICATOR_GROUPS em CandlestickChart.jsx).
 *
 * Não espera o cruzamento EMA9×EMA21 (atrasado). Dois sinais antecipados, simétricos:
 *
 *  - Fundo (EMA9 < EMA21): a EMA9 para de cair e começa a subir → nuvem verde (bullish).
 *  - Topo (EMA9 > EMA21): a EMA9 para de subir e começa a cair → nuvem vermelha
 *    (prever o fim da alta, ainda acima da EMA21).
 *
 * Inclinação (2 candles, pra um solavanco isolado não parecer virada):
 *   d1[i]      = (EMA9[i] − EMA9[i−1]) / EMA9[i−1] × 100
 *   slopePct[i] = média dos últimos SLOPE_LOOKBACK (2) valores de d1
 *
 * Só 2 cores no gráfico (indicador simplificado): vermelho = perdendo força/caindo (era
 * vermelho+laranja), verde = ganhando força/estável/subindo (era amarelo+verde). Os 8 estados
 * internos (classifyEma9SlopeState) continuam existindo pra rótulo/legenda — só o preenchimento
 * da nuvem foi reduzido a 2 tons.
 *
 * Confirmação num intervalo menor (ver EMA_PERSIST_CLOUD_CONFIRM_INTERVAL em uiPreferences.js,
 * ex.: 1h confirma em 15m): os estados bullish (turnUp/riseAccel — "EMA9 virou/subindo forte")
 * só são considerados "firmes" se a EMA9 do intervalo de confirmação também estiver num desses
 * dois estados no candle correspondente. Sem isso, a nuvem continua aparecendo (não é
 * descartada), só fica com o preenchimento mais fraco — um candle isolado de 1h vira alta com
 * muito mais frequência do que quatro candles seguidos de 15m concordando.
 *
 * Prévia com o intervalo menor (modo comparação, temporário): a nuvem do intervalo de
 * confirmação (ex.: 30m) é desenhada na extensão INTEIRA do gráfico, sempre esmaecida, por baixo
 * da nuvem do principal (que é pintada por cima e cobre onde tiver candle) — dá pra comparar as
 * duas lado a lado, não só nos buracos. Importante: a prévia é REAMOSTRADA pro mesmo espaçamento
 * do candle principal antes de virar nuvem — um segmento cru, com largura menor que 1 candle do
 * principal, colapsa num único ponto ao ser encaixado no gráfico (todo mundo cai no mesmo
 * candle) e é descartado por ter menos de 2 pontos. Reamostrando primeiro, cada ponto da prévia
 * ocupa uma posição própria no candle do gráfico.
 */

import { buildEmaCrossMergedSeries } from './emaCrossSeries';

export const SLOPE_LOOKBACK = 2;
/** |slope%| abaixo disto = "quase estabilizando" (lado de baixa e de alta). */
export const STABILIZE_PCT = 0.03;

export const PERM_CLOUD_TONES = ['red', 'green'];

export const PERM_TONE_SWATCH = {
  red: '#ef5350',
  green: '#26a69a',
};

export const DEFAULT_PERM_CLOUD_TONES = {
  red: true, green: true,
};

export function normalizeEmaPersistCloudTones(raw) {
  const out = { ...DEFAULT_PERM_CLOUD_TONES };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of PERM_CLOUD_TONES) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

const RED_FILL = 'rgba(239, 83, 80, 0.28)';
const GREEN_FILL = 'rgba(38, 166, 154, 0.26)';

export const SLOPE_STATE_META = {
  fallAccel: { tone: 'red',   fillColor: RED_FILL,   emoji: '🔴', label: 'queda forte' },
  fallDecel: { tone: 'red',   fillColor: RED_FILL,   emoji: '🔴', label: 'queda perdendo força' },
  fallFlat:  { tone: 'green', fillColor: GREEN_FILL, emoji: '🟢', label: 'quase estabilizando' },
  turnUp:    { tone: 'green', fillColor: GREEN_FILL, emoji: '🟢', label: 'EMA9 subindo' },
  riseAccel: { tone: 'green', fillColor: GREEN_FILL, emoji: '🟢', label: 'alta forte' },
  riseDecel: { tone: 'red',   fillColor: RED_FILL,   emoji: '🔴', label: 'alta perdendo força' },
  riseFlat:  { tone: 'green', fillColor: GREEN_FILL, emoji: '🟢', label: 'alta quase no topo' },
  turnDown:  { tone: 'red',   fillColor: RED_FILL,   emoji: '🔴', label: 'EMA9 virando pra baixo' },
};

/** Estados bullish "firmes" — só esses passam pela confirmação do intervalo menor; os demais
 *  estados verdes (fallFlat/riseFlat, quase estáveis) não. */
function isBullishState(state) {
  return state === 'turnUp' || state === 'riseAccel';
}

const MAX_HISTORY_CANDLES = 700;

const EMPTY_RESULT = {
  segments: [],
  lastSlopePct: null,
  lastState: null,
  lastConfirmed: null,
  lastIsPreview: false,
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

/**
 * @param {boolean|null} [confirmed] só relevante pros estados bullish (turnUp/riseAccel) — ver buildEmaCrossPersistenceClouds
 * @param {boolean} [preview] true quando o último estado vem da extensão em 15m (candle de 1h ainda não fechou)
 */
export function formatEma9SlopeLegend(slopePct, state, confirmed, preview) {
  if (slopePct == null || !Number.isFinite(slopePct) || !state) return null;
  const meta = SLOPE_STATE_META[state];
  if (!meta) return null;
  const sign = slopePct > 0 ? '+' : '';
  const suffix = preview
    ? ' (prévia em 15m — candle do intervalo principal ainda não fechou)'
    : (isBullishState(state) && confirmed === false ? ' (não confirmado no intervalo menor)' : '');
  return `${meta.emoji} ${sign}${slopePct.toFixed(2)}% — ${meta.label}${suffix}`;
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

/** [{time, fast, slow, slopePct, state}] — mesma série usada pra nuvem e pra confirmação
 *  (o intervalo de confirmação passa pelas mesmas contas, só que com os candles menores). */
function computeSlopeStates(candlesticks, ma9, ma21) {
  const fullMerged = buildEmaCrossMergedSeries(candlesticks, ma9, ma21);
  if (fullMerged.length < SLOPE_LOOKBACK + 1) return [];
  const merged = fullMerged.length > MAX_HISTORY_CANDLES
    ? fullMerged.slice(-MAX_HISTORY_CANDLES)
    : fullMerged;

  const d1 = merged.map((m, i) => (
    i === 0 ? null : oneBarPct(m.fast, merged[i - 1].fast)
  ));
  const slopePct = merged.map((_, i) => smoothSlopeAt(d1, i, SLOPE_LOOKBACK));

  return merged.map((m, i) => ({
    time: m.time,
    fast: m.fast,
    slow: m.slow,
    slopePct: slopePct[i],
    state: classifyEma9SlopeState(slopePct[i], i > 0 ? slopePct[i - 1] : null, sideOf(m.fast, m.slow)),
  }));
}

/** Enfraquece o preenchimento (alpha) de uma cor rgba(...) — usado na nuvem verde não confirmada. */
function dimColor(rgbaStr, factor = 0.45) {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(rgbaStr);
  if (!m) return rgbaStr;
  const [, r, g, b, a] = m;
  return `rgba(${r}, ${g}, ${b}, ${(parseFloat(a) * factor).toFixed(2)})`;
}

/** Busca binária pelo último ponto de confirmStates com time <= alvo (série ordenada por tempo). */
function lastStateAtOrBefore(confirmStates, time) {
  let lo = 0;
  let hi = confirmStates.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (confirmStates[mid].time <= time) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx < 0 ? null : confirmStates[idx];
}

const cloudPoint = (s) => ({
  time: s.time,
  upper: Math.max(s.fast, s.slow),
  lower: Math.min(s.fast, s.slow),
});

/** Agrupa `states` em segmentos contíguos por estado (mesmo algoritmo pra nuvem principal e pra
 *  a extensão de prévia em 15m — só muda a regra de esmaecimento). `shouldDim(state, points)`
 *  decide se o segmento entra com o fillColor mais fraco. */
function buildSegmentsFromStates(states, shouldDim) {
  const segments = [];
  let runState = null;
  let runStart = -1;

  const flush = (endExclusive) => {
    if (runState == null || runStart < 0) return;
    const meta = SLOPE_STATE_META[runState];
    if (!meta) return;
    const from = Math.max(0, runStart - (endExclusive - runStart < 2 ? 1 : 0));
    const points = [];
    for (let i = from; i < endExclusive; i++) points.push(cloudPoint(states[i]));
    if (points.length < 2) return;
    const dim = shouldDim ? shouldDim(runState, points) : false;
    segments.push({
      points,
      fillColor: dim ? dimColor(meta.fillColor) : meta.fillColor,
      tone: meta.tone,
      confirmed: !dim,
    });
  };

  for (let i = 0; i < states.length; i++) {
    const s = states[i].state;
    if (s === runState) continue;
    flush(i);
    runState = s;
    runStart = s == null ? -1 : i;
  }
  flush(states.length);
  return segments;
}

/** Menor intervalo positivo entre candles consecutivos de `states` — "tamanho do bucket" do
 *  candle principal (ex.: 3600 pra 1h), usado pra reamostrar a prévia de 15m pro mesmo grid. */
function inferBucketSec(states) {
  let min = Infinity;
  for (let i = 1; i < states.length; i++) {
    const d = states[i].time - states[i - 1].time;
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * @param {Array} candlesticks
 * @param {Array} ma9
 * @param {Array} ma21
 * @param {{candlesticks:Array, ma9:Array, ma21:Array}|null} [confirmData] dados (candles + EMA9 +
 *   EMA21) de um intervalo menor — usado pra (1) confirmar os estados bullish do intervalo
 *   principal (ex.: 1h confirmado em 15m) e (2) preencher, como prévia, os buracos do intervalo
 *   principal (ver EMA_PERSIST_CLOUD_CONFIRM_INTERVAL). Opcional: sem isso o comportamento é o
 *   de antes.
 * @returns {{ segments: Array<{points: Array<{time:number, upper:number, lower:number}>, fillColor: string, tone: string, confirmed: boolean, preview?: boolean}>,
 *             lastSlopePct: number|null, lastState: string|null, lastConfirmed: boolean|null, lastIsPreview: boolean }}
 */
export function buildEmaCrossPersistenceClouds(candlesticks, ma9, ma21, confirmData) {
  const states = computeSlopeStates(candlesticks, ma9, ma21);
  if (states.length < 2) return EMPTY_RESULT;

  const confirmStates = confirmData?.candlesticks?.length
    ? computeSlopeStates(confirmData.candlesticks, confirmData.ma9, confirmData.ma21)
    : [];

  // Sem dado de confirmação (intervalo já é o menor, ou ainda carregando): não penaliza a nuvem.
  const isBullishConfirmedAt = (time) => {
    if (!confirmStates.length) return true;
    const at = lastStateAtOrBefore(confirmStates, time);
    return isBullishState(at?.state);
  };

  const primarySegments = buildSegmentsFromStates(
    states,
    (runState, points) => isBullishState(runState) && !points.every((p) => isBullishConfirmedAt(p.time)),
  );

  // Modo comparação (temporário): a nuvem do intervalo de confirmação é desenhada na EXTENSÃO
  // INTEIRA (não só nos buracos do principal), REAMOSTRADA pro mesmo espaçamento do candle
  // principal (ex.: 1h). Entra ANTES do principal no array — na hora de desenhar, o principal é
  // pintado por cima e cobre essa base onde tiver candle; onde não tiver, essa base continua
  // visível. A reamostragem é necessária porque um segmento de 15m/30m cru, com largura menor
  // que 1 candle do principal, colapsa num ponto só ao ser "encaixado" (snapPointsToChartCandles)
  // no gráfico de 1h — cada ponto da prévia precisa da sua própria posição no grid do principal
  // pra sobreviver ao encaixe.
  const bucketSec = inferBucketSec(states);
  let previewSegments = [];
  if (confirmStates.length && bucketSec) {
    const firstTime = states[0].time;
    const lastConfirmTime = confirmStates[confirmStates.length - 1].time;
    const resampled = [];
    for (let t = firstTime; t <= lastConfirmTime; t += bucketSec) {
      const at = lastStateAtOrBefore(confirmStates, t);
      resampled.push(at
        ? { time: t, fast: at.fast, slow: at.slow, slopePct: at.slopePct, state: at.state }
        : { time: t, fast: null, slow: null, slopePct: null, state: null });
    }
    previewSegments = buildSegmentsFromStates(resampled, () => true).map((seg) => ({ ...seg, preview: true }));
  }

  const lastPrimaryIdx = states.length - 1;
  const lastPrimaryState = states[lastPrimaryIdx].state;
  const lastPrimaryTime = states[lastPrimaryIdx].time;
  const lastConfirm = confirmStates[confirmStates.length - 1] ?? null;
  const lastIsPreview = !!lastConfirm && lastConfirm.time > lastPrimaryTime;

  return {
    segments: [...previewSegments, ...primarySegments],
    lastSlopePct: lastIsPreview ? lastConfirm.slopePct : states[lastPrimaryIdx].slopePct,
    lastState: lastIsPreview ? lastConfirm.state : lastPrimaryState,
    lastConfirmed: lastIsPreview
      ? null
      : (isBullishState(lastPrimaryState) ? isBullishConfirmedAt(lastPrimaryTime) : null),
    lastIsPreview,
  };
}
