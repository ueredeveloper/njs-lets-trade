// Sugestão de alvo/stop "realista" pra OCO manual do gráfico (ChartOcoTool.jsx), medida nos
// candles JÁ carregados (intervalo da tela) em vez de um % fixo.
//
// Tudo no INTERVALO DO GRÁFICO (o usuário opera 1h/4h): o intervalo é medido pelo espaçamento
// real dos candles e o horizonte é fixo em CANDLES (H = 24 → ≈ 1 dia no 1h, ≈ 4 dias no 4h). Antes
// era "≈ 1 dia" pra qualquer intervalo — no 4h só olhava 6 candles à frente e a sugestão saía
// praticamente igual à do 1h.
//
// Base estatística: cada candle fechado recente (até 300) vira uma entrada hipotética no close;
// anda até H candles à frente e vê o que vem PRIMEIRO — alvo (máxima ≥
// +T%), stop (mínima ≤ −S%; candle que toca os dois = stop) ou nenhum dos dois. Sem filtro de
// sinal, então NÃO mede vantagem (a expectativa de qualquer par fica ~0 — a vantagem vem do
// sinal de entrada); mede a PROBABILIDADE de cada alvo/stop ser atingido no ritmo atual da moeda.
//
// Regra da sugestão:
//  1. Stop fora do ruído: 1× ATR(14)% (arredondado pra cima a 0,5; entre 1% e 12%). Suporte (S/R
//     LuxAlgo, ≥ 2 toques) logo abaixo (até 1,5× a distância) → stop logo abaixo do suporte.
//  2. Alvo = o MAIOR da grade (passo 0,5%, R:R ≥ 1) que a moeda atingiu ANTES do stop pelo menos
//     tantas vezes quanto o stop veio antes do alvo (chance ≥ risco); nenhum → alvo = stop.
//  3. Resistência (≥ 2 toques) entre a entrada e o alvo → alvo logo abaixo dela.
// Caso KATUSDT 1h (26/10): ATR ~5,5% → 12%/6% batia o alvo 13% das vezes e o stop 27%; um stop de
// 2–3% caía no ruído (40–60% de stop).

import { detectSupportResistance } from './srDetectors';

const MAX_SAMPLES = 300;
const MIN_SAMPLES = 40;
const HORIZON_CANDLES = 24;
const LEVEL_BUFFER = 0.003; // 0,3% antes da resistência / depois do suporte
// Escada de alvos mostrada no cartão = múltiplos do ATR (escala com a volatilidade da moeda —
// +3/5/8/12% fixos não diziam nada pra BTC nem pra uma memecoin).
const LADDER_ATR_MULTS = [1, 1.5, 2, 3];

function toCandles(candlesticks) {
  return (candlesticks ?? [])
    .map((c) => ({
      openTime: Number(c.openTime), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
    }))
    .filter((c) => [c.openTime, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.close > 0);
}

function atrPct(cs, period = 14) {
  if (cs.length < period + 1) return null;
  let sum = 0;
  for (let i = cs.length - period; i < cs.length; i++) {
    const prev = cs[i - 1].close;
    const tr = Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - prev), Math.abs(cs[i].low - prev));
    sum += tr / cs[i].close;
  }
  return (sum / period) * 100;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Pré-calcula os caminhos das amostras (só depende dos candles) e devolve um sugeridor barato por
 * preço de entrada. null quando não há candles suficientes.
 */
/** Intervalo REAL dos candles (mediana do espaçamento) — fonte da verdade, não depende do estado
 *  da tela; cai no `fallbackMs` informado se não der pra medir. */
function measureIntervalMs(cs, fallbackMs) {
  const diffs = [];
  for (let i = Math.max(1, cs.length - 50); i < cs.length; i++) {
    const d = cs[i].openTime - cs[i - 1].openTime;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return fallbackMs || 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

export function buildOcoSuggester(candlesticks, fallbackIntervalMs, nowMs = Date.now()) {
  let cs = toCandles(candlesticks);
  const intervalMs = measureIntervalMs(cs, fallbackIntervalMs);
  // Último candle ainda em formação não entra (máx./mín. incompletas).
  if (cs.length && intervalMs > 0 && cs[cs.length - 1].openTime + intervalMs > nowMs) cs = cs.slice(0, -1);
  const H = HORIZON_CANDLES;
  const lastStart = cs.length - 1 - H;
  if (lastStart < MIN_SAMPLES) return null;
  const firstStart = Math.max(0, lastStart - MAX_SAMPLES + 1);

  // Caminho de cada amostra em % da entrada: up[j] = máxima, dn[j] = queda (positiva).
  const samples = [];
  const mfe = [];
  for (let i = firstStart; i <= lastStart; i++) {
    const e = cs[i].close;
    const up = new Float64Array(H);
    const dn = new Float64Array(H);
    let maxUp = 0;
    for (let j = 1; j <= H; j++) {
      const c = cs[i + j];
      up[j - 1] = (c.high / e - 1) * 100;
      dn[j - 1] = (1 - c.low / e) * 100;
      if (up[j - 1] > maxUp) maxUp = up[j - 1];
    }
    samples.push({ up, dn });
    mfe.push(maxUp);
  }
  mfe.sort((a, b) => a - b);

  // Chance de alvo antes do stop / stop antes do alvo / nenhum, em H candles.
  const evalPct = (T, S) => {
    let wins = 0;
    let losses = 0;
    for (const s of samples) {
      for (let j = 0; j < H; j++) {
        if (s.dn[j] >= S) { losses++; break; }
        if (s.up[j] >= T) { wins++; break; }
      }
    }
    const n = samples.length;
    return { winRate: wins / n, lossRate: losses / n, openRate: (n - wins - losses) / n };
  };

  const atr = atrPct(cs);
  const baseStop = atr != null ? Math.min(12, Math.max(1, Math.ceil(atr * 2) / 2)) : 3;
  const zones = detectSupportResistance(cs.slice(-MAX_SAMPLES), { maxLevels: 12 }).filter((z) => z.touches >= 2);

  const suggest = (entry) => {
    if (!(entry > 0)) return null;
    const notes = [];
    const resistance = zones
      .filter((z) => z.price > entry * (1 + LEVEL_BUFFER * 2))
      .sort((a, b) => a.price - b.price)[0] ?? null;
    const support = zones
      .filter((z) => z.price < entry * (1 - LEVEL_BUFFER * 2))
      .sort((a, b) => b.price - a.price)[0] ?? null;

    let S = baseStop;
    if (support) {
      const sPct = (1 - (support.price * (1 - LEVEL_BUFFER)) / entry) * 100;
      if (sPct > S && sPct <= S * 1.5 && sPct <= 12) {
        S = Math.round(sPct * 10) / 10;
        notes.push(`stop abaixo do suporte (${support.touches} toques)`);
      }
    }

    let T = S;
    let anyFair = false;
    for (let t = Math.ceil(S * 2) / 2; t <= 20; t += 0.5) {
      const r = evalPct(t, S);
      if (r.winRate >= r.lossRate) { T = t; anyFair = true; }
    }
    if (!anyFair) notes.push('queda no período: nem com R:R 1 o alvo veio antes do stop na maioria — cautela');
    if (samples.length < 150) notes.push(`só ${samples.length} amostras — carregue mais candles pra uma estatística mais firme`);
    if (resistance) {
      const rPct = ((resistance.price * (1 - LEVEL_BUFFER)) / entry - 1) * 100;
      if (rPct < T && rPct >= 0.5) {
        T = Math.round(rPct * 10) / 10;
        notes.push(`alvo antes da resistência (${resistance.touches} toques)`);
        if (T < S) notes.push('R:R < 1 — resistência perto demais pra esse stop');
      }
    }
    const ladderTargets = [...new Set(LADDER_ATR_MULTS.map((m) => Math.max(0.5, Math.round((atr ?? S) * m * 2) / 2)))];

    return {
      targetPct: T,
      stopPct: S,
      targetPrice: entry * (1 + T / 100),
      stopPrice: entry * (1 - S / 100),
      ...evalPct(T, S),
      rr: T / S,
      ladder: ladderTargets.map((t) => ({ targetPct: t, ...evalPct(t, S) })),
      samples: samples.length,
      horizon: H,
      intervalMs,
      horizonMs: intervalMs * H,
      atrPct: atr,
      mfeMedian: quantile(mfe, 0.5),
      mfeP75: quantile(mfe, 0.75),
      resistance,
      support,
      notes,
      evalPct,
    };
  };

  return { suggest, horizon: H, intervalMs, samples: samples.length };
}
