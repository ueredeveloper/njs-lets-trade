// Sinais de "sair ou deixar correr" pra uma posição COMPRADA da OCO manual (acordeão "Sinais" do
// ManualOcoOrdersPanel). Pensado pro caso "comprei, esperei alguns candles e a alta não veio":
// cada linha = um indicador no intervalo da ordem (padrão 4h, o da Explosão de Alta), com um tom
// (green = deixar correr, yellow = atenção / reduzir, red = sair) e a decisão em texto.
//
// Só candles FECHADOS entram nas regras de fechamento (o candle em formação muda até fechar).
// Fórmulas iguais às do pacote `technicalindicators` do backend: EMA semeada com a SMA do período,
// MACD 12/26/9 exponencial, RSI de Wilder.
import { computeRsiWilder } from './rsiThresholdCrossings';

export const TIME_STOP_CANDLES = 12; // stop por tempo: N candles depois da compra…
export const TIME_STOP_MIN_GAIN_PCT = 3; // …sem nenhum fechamento ter passado de +X% da compra
const RANGE_CANDLES = 6; // consolidação = máxima dos últimos N candles fechados
const MACD_FADE_CANDLES = 3; // histograma caindo N candles seguidos = força acabando

const INTERVAL_MS = {
  '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3,
  '4h': 14400e3, '8h': 28800e3, '1d': 86400e3,
};

/** EMA alinhada ao FIM de `values` (1º valor = values[period-1]), semeada com a SMA. */
export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Histograma MACD (12/26/9) alinhado ao FIM de `closes`. */
export function macdHistogram(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  if (!es.length) return [];
  const off = ef.length - es.length;
  const macd = es.map((s, i) => ef[i + off] - s);
  const sig = ema(macd, signal);
  const off2 = macd.length - sig.length;
  return sig.map((s, i) => macd[i + off2] - s);
}

const fmt = (v) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8);
};
const pct = (from, to) => ((to - from) / from) * 100;
const fmtPct = (p) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;

/**
 * @param candles   [{ openTime, open, high, low, close, volume }] (strings ou números), ascendente
 * @param opts      { interval, entryPrice, fillAtMs, nowMs }
 * @returns { rows: [{ key, name, value, tone, decision }], closedAt } ou null sem dados suficientes
 */
export function computePositionSignals(candles, { interval = '4h', entryPrice, fillAtMs, nowMs = Date.now() } = {}) {
  const ivMs = INTERVAL_MS[interval] ?? INTERVAL_MS['4h'];
  const all = (candles ?? []).map((c) => ({
    t: Number(c.openTime), o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: +c.volume,
  })).filter((c) => Number.isFinite(c.c) && Number.isFinite(c.t));
  const closed = all.filter((c) => c.t + ivMs <= nowMs);
  if (closed.length < 40 || !(entryPrice > 0)) return null;

  const closes = closed.map((c) => c.c);
  const last = closed[closed.length - 1];
  const e9 = ema(closes, 9).at(-1);
  const e21 = ema(closes, 21).at(-1);
  const hist = macdHistogram(closes);
  const h0 = hist.at(-1);
  const rsi = computeRsiWilder(closes, 14).at(-1);
  const iv = interval;
  const rows = [];

  // 1. EMA9 — tendência curta: fechou abaixo = 1º sinal de fraqueza.
  rows.push({
    key: 'ema9',
    name: `EMA9 ${iv}`,
    value: `fech. ${fmt(last.c)} ${last.c >= e9 ? '>' : '<'} ${fmt(e9)}`,
    tone: last.c >= e9 ? 'green' : 'yellow',
    decision: last.c >= e9 ? 'tendência curta ok' : 'perdeu a EMA9 — reduzir/atenção',
  });

  // 2. EMA21 — tendência: fechou abaixo = sair (perto da metade do candle de explosão).
  rows.push({
    key: 'ema21',
    name: `EMA21 ${iv}`,
    value: `fech. ${fmt(last.c)} ${last.c >= e21 ? '>' : '<'} ${fmt(e21)}`,
    tone: last.c >= e21 ? 'green' : 'red',
    decision: last.c >= e21 ? `segura; sair se fechar < ${fmt(e21)}` : 'tendência perdida — sair',
  });

  // 3. MACD — força: positivo e subindo = verde; positivo mas encolhendo = força acabando; negativo = sem força.
  let fading = 0;
  for (let i = hist.length - 1; i > 0 && hist[i] < hist[i - 1]; i--) fading += 1;
  const macdTone = h0 < 0 ? 'yellow' : fading >= MACD_FADE_CANDLES ? 'yellow' : 'green';
  rows.push({
    key: 'macd',
    name: `MACD ${iv}`,
    value: `hist ${h0 >= 0 ? '+' : ''}${fmt(h0)}${fading ? ` · caindo ${fading}×` : ' · subindo'}`,
    tone: macdTone,
    decision: h0 < 0 ? 'sem força (hist negativo)' : fading >= MACD_FADE_CANDLES ? 'força acabando' : 'com força',
  });

  // 4. Fraqueza combinada (regra 1): MACD negativo E fechou abaixo da EMA9.
  const weak = h0 < 0 && last.c < e9;
  rows.push({
    key: 'weak',
    name: 'MACD < 0 + EMA9',
    value: weak ? 'os dois' : h0 < 0 || last.c < e9 ? 'só um' : 'nenhum',
    tone: weak ? 'red' : h0 < 0 || last.c < e9 ? 'yellow' : 'green',
    decision: weak ? 'fraqueza confirmada — reduzir ou sair' : 'sem fraqueza confirmada',
  });

  // 5. RSI — acima de 50 = compradores no controle.
  if (Number.isFinite(rsi)) {
    rows.push({
      key: 'rsi',
      name: `RSI ${iv}`,
      value: rsi.toFixed(1),
      tone: rsi >= 50 ? 'green' : 'yellow',
      decision: rsi >= 70 ? 'forte (sobrecomprado)' : rsi >= 50 ? 'compradores no controle' : 'abaixo de 50 — fraco',
    });
  }

  // 6. Stop por tempo: N candles desde a compra sem a máxima passar de +X%.
  if (Number.isFinite(fillAtMs)) {
    const after = closed.filter((c) => c.t + ivMs > fillAtMs); // candles que terminaram depois da compra
    const n = after.length;
    // Maior FECHAMENTO (não a máxima): um pavio logo depois da compra não conta como "a alta veio".
    const maxClose = after.length ? Math.max(...after.map((c) => c.c)) : entryPrice;
    const best = pct(entryPrice, maxClose);
    const reached = best >= TIME_STOP_MIN_GAIN_PCT;
    rows.push({
      key: 'time',
      name: 'Stop por tempo',
      value: `${n}/${TIME_STOP_CANDLES} candles · melhor fech. ${fmtPct(best)}`,
      tone: reached ? 'green' : n >= TIME_STOP_CANDLES ? 'red' : 'yellow',
      decision: reached
        ? `já passou de +${TIME_STOP_MIN_GAIN_PCT}%`
        : n >= TIME_STOP_CANDLES
          ? `${n} candles sem +${TIME_STOP_MIN_GAIN_PCT}% — sair`
          : `falta ${TIME_STOP_CANDLES - n} candle(s) pra cobrar +${TIME_STOP_MIN_GAIN_PCT}%`,
    });
  }

  // 7. Rompimento da consolidação: fechou acima da máxima dos últimos N candles com volume acima da média 20.
  const prevRange = closed.slice(-RANGE_CANDLES - 1, -1);
  const rangeHigh = Math.max(...prevRange.map((c) => c.h));
  const vols = closed.slice(-21, -1).map((c) => c.v);
  const volAvg = vols.reduce((s, v) => s + v, 0) / (vols.length || 1);
  const broke = last.c > rangeHigh;
  const volOk = last.v > volAvg;
  rows.push({
    key: 'range',
    name: `Topo ${RANGE_CANDLES} candles`,
    value: `${fmt(rangeHigh)} · vol ${(last.v / (volAvg || 1)).toFixed(1)}× média`,
    tone: broke && volOk ? 'green' : 'yellow',
    decision: broke && volOk
      ? 'rompeu com volume — deixa correr'
      : broke ? 'rompeu sem volume — confirmar'
        : `parada; continua se fechar > ${fmt(rangeHigh)} c/ volume`,
  });

  return { rows, closedAt: last.t + ivMs };
}
