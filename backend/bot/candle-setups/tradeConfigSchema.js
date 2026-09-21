'use strict';

/**
 * Schema dos "Setups Matadores" (candle-setups) — só COMPRA, 15m por padrão.
 * Fonte única dos defaults: backtest das Estatísticas (utils/analyseCandleSetupsBacktest.js) e, mais
 * tarde, o bot ao vivo. Os valores que o livro NÃO define (janela do rompimento, R mín/máx, tempo
 * máximo, custos) são chutes calibráveis — ver backend/trading-books/leitura.md.
 *
 * Alvos (`exit.targets`): { type:'r', value, qtyPct } (múltiplo do risco a partir da entrada real) ou
 * { type:'level', key, qtyPct, fallbackR } (nível do próprio sinal: banda de Bollinger, projeção do
 * One Punch; se o nível já está abaixo da entrada, cai pra `fallbackR`). O stop NÃO é movido depois da
 * parcial (o livro: 50% em 1R + resto estopado em −1R = zero a zero).
 */

const SETUP_LABELS = {
  pontoContinuo: 'Ponto Contínuo',
  pfr: 'PFR',
  fechouForaDentro: 'Fechou Fora, Fechou Dentro',
  martelinho: 'Martelinho',
  onePunch: 'One Punch',
};

const DEFAULT_TREND = { fastPeriod: 20, slowPeriod: 80, requireHHHL: true, requirePriceAboveFast: true };

const CANDLE_SETUPS_DEFAULTS = {
  interval: '15m',
  candleCount: 3000,
  positionSizeUsd: 40,
  setups: ['pfr', 'pontoContinuo', 'fechouForaDentro'],

  common: {
    /** "1 tick" do livro, em % do preço (o bot ao vivo usa o tickSize real da corretora). */
    entryOffsetPct: 0.02,
    stopOffsetPct: 0.02,
    /** Candles (depois do sinal) em que o rompimento do gatilho ainda vale. */
    validCandles: 2,
    /** Cancela a ordem se o preço perder o stop antes de romper o gatilho. */
    cancelOnStopBreak: true,
    /** Risco = (gatilho − stop)/gatilho. Fora da faixa, o sinal é descartado (custo come o R pequeno). */
    minRiskPct: 1.0,
    maxRiskPct: 3.0,
    /** Saída a mercado no fechamento do N-ésimo candle depois da entrada (0 = sem limite). */
    maxHoldCandles: 48,
    cooldownCandles: 0,
  },

  costs: { feePct: 0.1, slippagePct: 0.05 },

  params: {
    pontoContinuo: {
      trend: { ...DEFAULT_TREND },
      touchPeriod: 21,
      tolerancePct: 0,
      requireCloseAbove: false,
      exit: { targets: [{ type: 'r', value: 1, qtyPct: 50 }, { type: 'r', value: 2, qtyPct: 50 }] },
    },
    pfr: {
      fastEma: 8,
      slowEma: 80,
      lookbackLows: 2,
      closeAbove: 'prevClose', // 'prevClose' | 'prevHigh'
      requirePriceAboveFast: true,
      exit: { targets: [{ type: 'r', value: 1.618, qtyPct: 100 }] },
    },
    fechouForaDentro: {
      period: 20,
      stdDev: 2,
      stopMode: 'both', // 'both' (mínima dos dois candles) | 'outside' (só o que fechou fora)
      requireBullish: false,
      finalTarget: '2R', // '2R' | 'middleBand' | 'upperBand'
      exit: { targets: [] }, // montado por finalTarget em resolveSetupConfig
    },
    martelinho: {
      levels: ['P', 'S1', 'S2', 'S3'],
      tolerancePct: 0.3,
      minLowerShadowToBody: 2,
      minLowerShadowToRange: 0.5,
      maxUpperShadowToRange: 0.25,
      requireTrend: false,
      trend: { ...DEFAULT_TREND },
      exit: { targets: [{ type: 'r', value: 1, qtyPct: 50 }, { type: 'r', value: 2, qtyPct: 50 }] },
    },
    onePunch: {
      sessionStartsUtc: ['00:00', '13:30'], // virada UTC (21:00 BRT) e abertura de NY (10:30 BRT no horário de verão dos EUA)
      minBodyPct: 60,
      bigBarAtrMult: 1.5,
      volumeMult: 1.5,
      congestionCandles: 0, // 0 = 1 dia de candles
      smallMaxRatio: 0.5,
      lastEntryCandle: 4,
      maxHoldMinutes: 45,
      exit: { targets: [{ type: 'level', key: 'projection', qtyPct: 100, fallbackR: 1.618 }] },
    },
  },
};

function num(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return v === true || v === '1' || v === 1 || v === 'true';
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function fechouForaTargets(finalTarget) {
  const last = finalTarget === 'middleBand'
    ? { type: 'level', key: 'middleBand', qtyPct: 50, fallbackR: 2 }
    : finalTarget === 'upperBand'
      ? { type: 'level', key: 'upperBand', qtyPct: 50, fallbackR: 2 }
      : { type: 'r', value: 2, qtyPct: 50 };
  return [{ type: 'r', value: 1, qtyPct: 50 }, last];
}

/** Sobrepõe (com validação/clamp) as opções vindas da query/painel sobre os defaults. */
function normalizeCandleSetupsOptions(raw = {}) {
  const d = CANDLE_SETUPS_DEFAULTS;
  const c = raw.common ?? {};
  const p = raw.params ?? {};

  const common = {
    entryOffsetPct: num(c.entryOffsetPct, 0, 2, d.common.entryOffsetPct),
    stopOffsetPct: num(c.stopOffsetPct, 0, 2, d.common.stopOffsetPct),
    validCandles: Math.round(num(c.validCandles, 1, 20, d.common.validCandles)),
    cancelOnStopBreak: bool(c.cancelOnStopBreak, d.common.cancelOnStopBreak),
    minRiskPct: num(c.minRiskPct, 0, 50, d.common.minRiskPct),
    maxRiskPct: num(c.maxRiskPct, 0, 100, d.common.maxRiskPct),
    maxHoldCandles: Math.round(num(c.maxHoldCandles, 0, 5000, d.common.maxHoldCandles)),
    cooldownCandles: Math.round(num(c.cooldownCandles, 0, 500, d.common.cooldownCandles)),
  };
  if (common.maxRiskPct > 0 && common.maxRiskPct < common.minRiskPct) common.maxRiskPct = common.minRiskPct;

  const costs = {
    feePct: num(raw.costs?.feePct, 0, 1, d.costs.feePct),
    slippagePct: num(raw.costs?.slippagePct, 0, 2, d.costs.slippagePct),
  };

  const pc = p.pontoContinuo ?? {};
  const pf = p.pfr ?? {};
  const ff = p.fechouForaDentro ?? {};
  const finalTarget = pick(ff.finalTarget, ['2R', 'middleBand', 'upperBand'], d.params.fechouForaDentro.finalTarget);

  const params = {
    pontoContinuo: {
      ...d.params.pontoContinuo,
      trend: {
        ...DEFAULT_TREND,
        requireHHHL: bool(pc.requireHHHL, DEFAULT_TREND.requireHHHL),
      },
      touchPeriod: Math.round(num(pc.touchPeriod, 5, 200, d.params.pontoContinuo.touchPeriod)),
      tolerancePct: num(pc.tolerancePct, 0, 5, d.params.pontoContinuo.tolerancePct),
      requireCloseAbove: bool(pc.requireCloseAbove, d.params.pontoContinuo.requireCloseAbove),
    },
    pfr: {
      ...d.params.pfr,
      closeAbove: pick(pf.closeAbove, ['prevClose', 'prevHigh'], d.params.pfr.closeAbove),
      requirePriceAboveFast: bool(pf.requirePriceAboveFast, d.params.pfr.requirePriceAboveFast),
    },
    fechouForaDentro: {
      ...d.params.fechouForaDentro,
      stopMode: pick(ff.stopMode, ['both', 'outside'], d.params.fechouForaDentro.stopMode),
      requireBullish: bool(ff.requireBullish, d.params.fechouForaDentro.requireBullish),
      finalTarget,
      exit: { targets: fechouForaTargets(finalTarget) },
    },
    martelinho: { ...d.params.martelinho },
    onePunch: { ...d.params.onePunch },
  };

  return {
    interval: raw.interval ?? d.interval,
    candleCount: Math.round(num(raw.candleCount, 200, 3000, d.candleCount)),
    positionSizeUsd: num(raw.positionSizeUsd, 1, 1_000_000, d.positionSizeUsd),
    setups: (Array.isArray(raw.setups) && raw.setups.length ? raw.setups : d.setups)
      .filter((id) => Object.prototype.hasOwnProperty.call(SETUP_LABELS, id)),
    common,
    costs,
    params,
  };
}

module.exports = { SETUP_LABELS, CANDLE_SETUPS_DEFAULTS, normalizeCandleSetupsOptions };
