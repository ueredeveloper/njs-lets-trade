'use strict';

/**
 * Detectores dos "Setups Matadores para Day Trade" (João Victor Haro Chagas, vol. 1) — só COMPRA.
 * Estudo completo e ambiguidades do livro em backend/trading-books/leitura.md.
 *
 * Funções PURAS (candles → sinais), sem rede nem estado: o backtest (utils/analyseCandleSetupsBacktest.js)
 * e, mais tarde, o bot ao vivo usam o MESMO código — mesmo princípio do RSI Momentum.
 *
 * Todo setup segue o mesmo esqueleto: contexto (tendência) → candle-sinal FECHADO no índice `i` →
 * gatilho = máxima do candle-sinal + folga → stop = mínima do candle-sinal − folga → alvos em múltiplos
 * de R (ver setupSimulator.js). O detector só olha candles ≤ i (sem olhar o futuro): o fractal de topo/
 * fundo do livro ("candle com máxima maior que o anterior E o seguinte") só vale depois que o candle
 * seguinte fechou, por isso o fractal k só entra a partir de i = k + 1.
 */

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};
const DAY_MS = 86_400_000;

function intervalMs(iv) {
  return INTERVAL_MS[iv] ?? 900_000;
}

/** Candles da corretora (strings) → séries numéricas paralelas. */
function toSeries(candles) {
  const n = candles.length;
  const s = { n, t: new Array(n), o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n), v: new Array(n) };
  for (let i = 0; i < n; i++) {
    const k = candles[i];
    s.t[i] = Number(k.openTime);
    s.o[i] = parseFloat(k.open);
    s.h[i] = parseFloat(k.high);
    s.l[i] = parseFloat(k.low);
    s.c[i] = parseFloat(k.close);
    s.v[i] = parseFloat(k.volume);
  }
  return s;
}

// ── Indicadores ───────────────────────────────────────────────────────────────────────────────

function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA semeada com a SMA dos `period` primeiros valores (mesma convenção do technicalindicators/TradingView). */
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let sum = 0;
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { sum += values[i]; continue; }
    if (i === period - 1) {
      sum += values[i];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** Bollinger (desvio padrão populacional, como o indicador padrão). */
function bbSeries(closes, period, mult) {
  const mid = smaSeries(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(acc / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

/** ATR de Wilder. */
function atrSeries(s, period) {
  const out = new Array(s.n).fill(null);
  let prev = null;
  let sum = 0;
  for (let i = 0; i < s.n; i++) {
    const tr = i === 0
      ? s.h[i] - s.l[i]
      : Math.max(s.h[i] - s.l[i], Math.abs(s.h[i] - s.c[i - 1]), Math.abs(s.l[i] - s.c[i - 1]));
    if (i < period - 1) { sum += tr; continue; }
    if (i === period - 1) {
      sum += tr;
      prev = sum / period;
    } else {
      prev = (prev * (period - 1) + tr) / period;
    }
    out[i] = prev;
  }
  return out;
}

/**
 * "Topos e fundos ascendentes" do livro (definição do Stormer): fundo = candle com mínima abaixo do
 * anterior E do seguinte; topo = máxima acima do anterior E do seguinte. out[i] = os 2 últimos topos
 * confirmados E os 2 últimos fundos confirmados (até o candle i) estão ascendentes.
 */
function hhhlSeries(s) {
  const out = new Array(s.n).fill(false);
  const highs = [];
  const lows = [];
  for (let i = 0; i < s.n; i++) {
    const k = i - 1; // k+1 = i acabou de fechar → o fractal k está confirmado
    if (k >= 1) {
      if (s.h[k] > s.h[k - 1] && s.h[k] > s.h[k + 1]) highs.push(s.h[k]);
      if (s.l[k] < s.l[k - 1] && s.l[k] < s.l[k + 1]) lows.push(s.l[k]);
    }
    const nh = highs.length;
    const nl = lows.length;
    out[i] = nh >= 2 && nl >= 2 && highs[nh - 1] > highs[nh - 2] && lows[nl - 1] > lows[nl - 2];
  }
  return out;
}

/**
 * Tendência de ALTA saudável do livro: SMA curta (20) acima da EMA longa (80), preço acima da média
 * curta e topos/fundos ascendentes. Devolve `ok(i)`.
 */
function createTrendChecker(s, cfg) {
  const fast = smaSeries(s.c, cfg.fastPeriod);
  const slow = emaSeries(s.c, cfg.slowPeriod);
  const hhhl = cfg.requireHHHL ? hhhlSeries(s) : null;
  return {
    warmup: cfg.slowPeriod,
    fast,
    slow,
    ok(i) {
      if (fast[i] == null || slow[i] == null) return false;
      if (!(fast[i] > slow[i])) return false;
      if (cfg.requirePriceAboveFast && !(s.c[i] > fast[i])) return false;
      if (hhhl && !hhhl[i]) return false;
      return true;
    },
  };
}

// ── Setups ────────────────────────────────────────────────────────────────────────────────────

function buildSignal(setup, s, i, cfgCommon, { stopLow = s.l[i], levels = {}, overrides = null } = {}) {
  const trigger = s.h[i] * (1 + cfgCommon.entryOffsetPct / 100);
  const stop = stopLow * (1 - cfgCommon.stopOffsetPct / 100);
  if (!(trigger > stop) || !(stop > 0)) return null;
  return {
    setup, index: i, signalTime: s.t[i],
    signalHigh: s.h[i], signalLow: s.l[i],
    trigger, stop,
    riskPct: ((trigger - stop) / trigger) * 100,
    levels, overrides,
  };
}

/** PFR (Preço de Fechamento de Reversão): tendência EMA8 > EMA80, preço acima das duas; candle com
 *  mínima abaixo das mínimas dos últimos N candles (padrão 2) e fechamento acima do anterior. */
function createPfrDetector(s, cfg, common) {
  const emaF = emaSeries(s.c, cfg.fastEma);
  const emaS = emaSeries(s.c, cfg.slowEma);
  const N = Math.max(1, cfg.lookbackLows);
  return {
    warmup: Math.max(cfg.slowEma, N + 1),
    detect(i) {
      if (emaF[i] == null || emaS[i] == null) return null;
      if (!(emaF[i] > emaS[i]) || !(s.c[i] > emaS[i])) return null;
      if (cfg.requirePriceAboveFast && !(s.c[i] > emaF[i])) return null;
      for (let j = 1; j <= N; j++) if (!(s.l[i] < s.l[i - j])) return null;
      const ref = cfg.closeAbove === 'prevHigh' ? s.h[i - 1] : s.c[i - 1];
      if (!(s.c[i] > ref)) return null;
      return buildSignal('pfr', s, i, common, { levels: { emaFast: emaF[i], emaSlow: emaS[i] } });
    },
  };
}

/** Ponto Contínuo: tendência de alta + recuo até a SMA21; o candle que toca a média é o sinal. */
function createPontoContinuoDetector(s, cfg, common) {
  const trend = createTrendChecker(s, cfg.trend);
  const touchMa = smaSeries(s.c, cfg.touchPeriod);
  return {
    warmup: Math.max(trend.warmup, cfg.touchPeriod) + 2,
    detect(i) {
      const ma = touchMa[i];
      if (ma == null || touchMa[i - 1] == null) return null;
      if (!trend.ok(i - 1)) return null;                 // tendência vigente ANTES do recuo
      if (!(s.c[i - 1] > touchMa[i - 1])) return null;   // vinha de cima da média
      if (!(s.l[i] <= ma * (1 + cfg.tolerancePct / 100) && s.h[i] >= ma)) return null; // tocou
      if (cfg.requireCloseAbove && !(s.c[i] >= ma)) return null;
      return buildSignal('pontoContinuo', s, i, common, {
        levels: { touchMa: ma, trendFast: trend.fast[i - 1], trendSlow: trend.slow[i - 1] },
      });
    },
  };
}

/** Fechou Fora, Fechou Dentro (compra): candle anterior fechou ABAIXO da banda inferior e este fechou
 *  de volta DENTRO. Stop na mínima dos dois candles (exemplo do livro) ou só do que fechou fora. */
function createFechouForaDentroDetector(s, cfg, common) {
  const bb = bbSeries(s.c, cfg.period, cfg.stdDev);
  return {
    warmup: cfg.period + 1,
    detect(i) {
      if (bb.lower[i] == null || bb.lower[i - 1] == null) return null;
      if (!(s.c[i - 1] < bb.lower[i - 1])) return null;  // fechou fora
      if (!(s.c[i] >= bb.lower[i])) return null;         // fechou dentro
      if (cfg.requireBullish && !(s.c[i] > s.o[i])) return null;
      const stopLow = cfg.stopMode === 'outside' ? s.l[i - 1] : Math.min(s.l[i - 1], s.l[i]);
      return buildSignal('fechouForaDentro', s, i, common, {
        stopLow,
        levels: { middleBand: bb.mid[i], upperBand: bb.upper[i], lowerBand: bb.lower[i] },
      });
    },
  };
}

/** Pivôs Fibonacci do dia UTC anterior (aproximação do "Método LeandroStormer", que o livro não
 *  detalha): P=(H+L+C)/3, S/R = P ∓ {0.382, 0.618, 1.0}·(H−L). Só usa o dia anterior COMPLETO. */
function dailyPivotsByDay(s, ivMs) {
  const days = new Map();
  for (let i = 0; i < s.n; i++) {
    const day = Math.floor(s.t[i] / DAY_MS);
    let d = days.get(day);
    if (!d) { d = { h: s.h[i], l: s.l[i], c: s.c[i], firstT: s.t[i], lastT: s.t[i] }; days.set(day, d); continue; }
    d.h = Math.max(d.h, s.h[i]);
    d.l = Math.min(d.l, s.l[i]);
    d.c = s.c[i];
    d.lastT = s.t[i];
  }
  const pivots = new Map();
  for (const [day, d] of days) {
    if (d.firstT !== day * DAY_MS || d.lastT + ivMs !== (day + 1) * DAY_MS) continue; // dia incompleto
    const P = (d.h + d.l + d.c) / 3;
    const rng = d.h - d.l;
    pivots.set(day + 1, {
      P, S1: P - 0.382 * rng, S2: P - 0.618 * rng, S3: P - rng,
      R1: P + 0.382 * rng, R2: P + 0.618 * rng, R3: P + rng,
    });
  }
  return pivots;
}

/** Martelinho: candle de martelo (pavio inferior longo, pouco pavio superior) tocando um nível de
 *  pivô e fechando acima dele. */
function createMartelinhoDetector(s, cfg, common, ivMs) {
  const pivots = dailyPivotsByDay(s, ivMs);
  const trend = cfg.requireTrend ? createTrendChecker(s, cfg.trend) : null;
  return {
    warmup: trend ? trend.warmup + 1 : 2,
    detect(i) {
      const lv = pivots.get(Math.floor(s.t[i] / DAY_MS));
      if (!lv) return null;
      const range = s.h[i] - s.l[i];
      if (!(range > 0)) return null;
      const body = Math.abs(s.c[i] - s.o[i]);
      const lowerShadow = Math.min(s.o[i], s.c[i]) - s.l[i];
      const upperShadow = s.h[i] - Math.max(s.o[i], s.c[i]);
      if (!(lowerShadow >= cfg.minLowerShadowToBody * body)) return null;
      if (!(lowerShadow >= cfg.minLowerShadowToRange * range)) return null;
      if (!(upperShadow <= cfg.maxUpperShadowToRange * range)) return null;
      if (trend && !trend.ok(i - 1)) return null;
      let best = null;
      for (const name of cfg.levels) {
        const price = lv[name];
        if (!(price > 0)) continue;
        const dist = Math.abs(s.l[i] - price) / price * 100;
        if (dist <= cfg.tolerancePct && s.c[i] > price && (!best || dist < best.dist)) best = { name, price, dist };
      }
      if (!best) return null;
      return buildSignal('martelinho', s, i, common, { levels: { pivotName: best.name, pivotPrice: best.price } });
    },
  };
}

/** One Punch adaptado a cripto (sem abertura de pregão/gap): 1ª barra da sessão (abertura UTC do dia e/ou
 *  de NY) ampla, altista, com volume e rompendo a "zona de congestão" (máxima dos últimos N candles);
 *  a 2ª barra é o sinal (≤ metade da 1ª). Alvo = mínima da 2ª + 161,8% da amplitude da 1ª. */
function createOnePunchDetector(s, cfg, common, ivMs) {
  const atr = atrSeries(s, 14);
  const volMa = smaSeries(s.v, 20);
  const starts = new Set(cfg.sessionStartsUtc.map((hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h * 60 + m) * 60_000;
  }));
  const lookback = cfg.congestionCandles > 0 ? cfg.congestionCandles : Math.round(DAY_MS / ivMs);
  const holdCandles = Math.max(1, Math.round(cfg.maxHoldMinutes / (ivMs / 60_000)));
  // "Entrar até o 4º candle do dia": sinal é o 2º, sobram o 3º e o 4º para o rompimento.
  const validCandles = Math.max(1, cfg.lastEntryCandle - 2);
  return {
    warmup: Math.max(lookback, 21) + 2,
    detect(i) {
      const b = i - 1; // barra grande = 1ª candle da sessão
      if (b < 1 || !starts.has(s.t[b] % DAY_MS)) return null;
      const rangeB = s.h[b] - s.l[b];
      if (!(rangeB > 0) || !(s.c[b] > s.o[b])) return null;
      if (!(Math.abs(s.c[b] - s.o[b]) >= cfg.minBodyPct / 100 * rangeB)) return null;
      if (atr[b - 1] == null || !(rangeB >= cfg.bigBarAtrMult * atr[b - 1])) return null;
      if (Number.isFinite(s.v[b]) && volMa[b - 1] > 0 && !(s.v[b] >= cfg.volumeMult * volMa[b - 1])) return null;
      let congestionHigh = -Infinity;
      for (let j = b - lookback; j < b; j++) congestionHigh = Math.max(congestionHigh, s.h[j]);
      if (!(s.c[b] > congestionHigh)) return null;
      if (!((s.h[i] - s.l[i]) <= cfg.smallMaxRatio * rangeB)) return null;
      return buildSignal('onePunch', s, i, common, {
        levels: { projection: s.l[i] + 1.618 * rangeB, bigBarRange: rangeB, congestionHigh },
        overrides: { validCandles, maxHoldCandles: holdCandles },
      });
    },
  };
}

const DETECTOR_FACTORIES = {
  pontoContinuo: createPontoContinuoDetector,
  pfr: createPfrDetector,
  fechouForaDentro: createFechouForaDentroDetector,
  martelinho: createMartelinhoDetector,
  onePunch: createOnePunchDetector,
};

const SETUP_IDS = Object.keys(DETECTOR_FACTORIES);

/**
 * @param {string} setupId
 * @param {object} s      Séries (toSeries).
 * @param {object} cfg    Config do setup (tradeConfigSchema → resolveSetupConfig(...).params).
 * @param {object} common Bloco comum (entryOffsetPct, stopOffsetPct).
 * @returns {{warmup:number, detect:(i:number)=>object|null}}
 */
function createDetector(setupId, s, cfg, common, interval) {
  const factory = DETECTOR_FACTORIES[setupId];
  if (!factory) throw new Error(`Setup desconhecido: ${setupId}`);
  return factory(s, cfg, common, intervalMs(interval));
}

module.exports = {
  SETUP_IDS,
  intervalMs,
  toSeries,
  smaSeries,
  emaSeries,
  bbSeries,
  atrSeries,
  hhhlSeries,
  dailyPivotsByDay,
  createTrendChecker,
  createDetector,
};
