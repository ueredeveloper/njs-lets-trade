'use strict';

const { BollingerBands } = require('technicalindicators');
const { computeStopLossFloor } = require('../shared/stopLossFloor');
const { computeMa, buildMaTimeSeries, maLabel } = require('../../utils/movingAverage');

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

function intervalMs(iv) {
  return INTERVAL_MS[iv] ?? 3_600_000;
}

function closedCandlesOnly(candles) {
  if (!candles?.length || candles.length < 2) return candles ?? [];
  return candles.slice(0, -1);
}

/** Série de Bollinger Bands (upper/middle/lower) a partir de candles JÁ FECHADOS — ancora
 *  a banda no histórico consolidado, sem "perseguir" o candle ainda em formação. */
function computeBollingerSeries(candles, period, stdDev) {
  if (!candles?.length || candles.length < period) return [];
  const closes = candles.map(c => parseFloat(c.close));
  const bb = BollingerBands.calculate({ period, values: closes, stdDev });
  if (!bb.length) return [];
  const offset = candles.length - bb.length;
  return bb.map((b, i) => ({
    openTime: Number(candles[i + offset].openTime),
    lower: b.lower, middle: b.middle, upper: b.upper,
  }));
}

function getRequiredSpecs(config) {
  const entry = config.entry;
  const cooldown = Math.max(0, Math.round(Number(entry.reentryCooldownCandles ?? 0)));
  const limitWait = Math.max(0, Math.round(Number(entry.limitWaitCandles ?? 0)));
  const limit = entry.period * 3 + cooldown + limitWait + 30;
  const specs = new Map([[entry.interval, limit]]);

  const add = (iv, lim) => specs.set(iv, Math.max(specs.get(iv) ?? 0, lim));

  const ema = entry.emaFilter;
  if (ema?.enabled) {
    const slopeLookback = Math.max(0, Math.round(Number(ema.slopeLookback ?? 0)));
    add(ema.interval, ema.period + slopeLookback + 30);
  }

  const slEma = config.stopLoss;
  if (slEma?.enabled && slEma.mode === 'ema') add(slEma.ema.interval, slEma.ema.period + 30);

  return [...specs.entries()].map(([interval, lim]) => ({ interval, limit: lim }));
}

/** Inclinação % da EMA: variação entre o valor vigente e o de `lookback` candles atrás
 *  na mesma série (mesma ideia de emaFilterSlopeAt do vwap-bands). null se faltar histórico. */
function emaSlopePct(series, lookback) {
  if (!series?.length || lookback <= 0) return null;
  const idx = series.length - 1;
  const pastIdx = idx - lookback;
  if (pastIdx < 0) return null;
  const current = series[idx].ma;
  const past = series[pastIdx].ma;
  if (!(past > 0)) return null;
  return ((current - past) / past) * 100;
}

/**
 * Filtro de tendência EMA: (1) close acima da EMA(period) do intervalo escolhido, com folga
 * de maxDipPct% abaixo ainda contando como "acima" (mesma ideia adaptativa do ma-cross);
 * (2) a própria linha da EMA em alta — variação % vs. slopeLookback candles atrás
 * ≥ minSlopePct (padrão: 5 candles, ≥ 0%). Desligado (enabled=false) → sempre libera.
 */
function checkEmaFilter(config, cMap, closePrice) {
  const ema = config.entry?.emaFilter;
  if (!ema?.enabled) return { allowed: true };

  const raw = cMap[ema.interval] ?? [];
  const closed = closedCandlesOnly(raw);
  const series = buildMaTimeSeries(closed, ema.period);
  if (!series.length) return { allowed: false, reason: 'EMA_FILTER_NO_MA' };

  const maValue = series[series.length - 1].ma;
  const label = maLabel(ema.period, ema.interval);
  const floor = maValue * (1 - Math.max(0, ema.maxDipPct) / 100);
  if (closePrice < floor) {
    return {
      allowed: false, reason: 'EMA_FILTER_BELOW',
      ema: maValue, floor, dipPct: ema.maxDipPct, label,
    };
  }

  const slopeLookback = Math.max(0, Math.round(Number(ema.slopeLookback ?? 0)));
  const minSlopePct = Number(ema.minSlopePct ?? 0);
  let slopePct = null;
  if (slopeLookback > 0) {
    slopePct = emaSlopePct(series, slopeLookback);
    if (slopePct == null) {
      return {
        allowed: false, reason: 'EMA_FILTER_NO_SLOPE',
        ema: maValue, floor, dipPct: ema.maxDipPct, slopeLookback, minSlopePct, label,
      };
    }
    if (slopePct < minSlopePct) {
      return {
        allowed: false, reason: 'EMA_FILTER_FALLING',
        ema: maValue, floor, dipPct: ema.maxDipPct, slopePct, slopeLookback, minSlopePct, label,
      };
    }
  }

  return {
    allowed: true,
    ema: maValue, floor, dipPct: ema.maxDipPct,
    slopePct, slopeLookback, minSlopePct, label,
  };
}

/**
 * Sinal de entrada: a mínima do candle mais recente (ainda em formação — reage sem esperar
 * o fechamento) toca/rompe a banda inferior, calculada com candles JÁ FECHADOS.
 * entry.pullback desce esse gatilho pullback.belowPct% abaixo da banda — exige um repique
 * mais fundo antes de comprar; desligado (padrão) compra assim que toca a banda.
 */
function evaluateEntrySignal(config, cMap) {
  const entry = config.entry;
  const iv = entry.interval;
  const raw = cMap[iv] ?? [];
  if (raw.length < 2) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

  const closed = closedCandlesOnly(raw);
  const series = computeBollingerSeries(closed, entry.period, entry.stdDev);
  if (!series.length) return { allowed: false, reason: 'NO_BANDS' };

  const lastBb = series[series.length - 1];
  const live = raw[raw.length - 1];
  const liveLow = parseFloat(live.low ?? live.close);
  const liveClose = parseFloat(live.close);

  const pullbackPct = entry.pullback?.enabled ? Math.max(0, entry.pullback.belowPct) : 0;
  const threshold = lastBb.lower * (1 - pullbackPct / 100);

  if (liveLow > threshold) {
    return {
      allowed: false, reason: 'BB_LOWER_NOT_TOUCHED',
      close: liveClose, lower: lastBb.lower, threshold,
    };
  }

  const emaCheck = checkEmaFilter(config, cMap, liveClose);
  if (!emaCheck.allowed) {
    return {
      allowed: false, reason: emaCheck.reason,
      close: liveClose, lower: lastBb.lower, threshold, emaFilter: emaCheck,
    };
  }

  // Stop mode 'ema': comprar no/abaixo do piso da EMA significa entrada do lado errado
  // da tendência (o stop já estaria acima da compra e não protegeria). Não entra —
  // o fallback % do computeStopPrice só cobre posição já aberta / slip.
  const emaStopFloor = computeEmaStopFloorRaw(config, cMap);
  if (emaStopFloor != null && threshold <= emaStopFloor) {
    return {
      allowed: false, reason: 'EMA_STOP_ABOVE_ENTRY',
      close: liveClose, lower: lastBb.lower, threshold,
      emaStopFloor, emaFilter: emaCheck,
    };
  }

  const bbDesc = pullbackPct > 0
    ? `BB(${entry.period},${entry.stdDev}) ${iv} banda inferior -${pullbackPct}%`
    : `BB(${entry.period},${entry.stdDev}) ${iv} banda inferior`;

  let entryDesc = bbDesc;
  if (emaCheck.label) {
    const slopeBit = emaCheck.slopeLookback > 0
      ? ` subindo (${emaCheck.slopePct >= 0 ? '+' : ''}${Number(emaCheck.slopePct).toFixed(2)}%/${emaCheck.slopeLookback})`
      : '';
    entryDesc = `${bbDesc} + acima ${emaCheck.label}${slopeBit}`;
  }

  return {
    allowed: true,
    close: liveClose,
    limitPrice: threshold,
    lower: lastBb.lower, middle: lastBb.middle, upper: lastBb.upper,
    threshold,
    emaFilter: emaCheck,
    emaStopFloor,
    signalOpenTime: Number(live.openTime),
    entryDesc,
  };
}

/** Piso bruto do stop em mode 'ema' (EMA × (1 − belowPct/100)), sem fallback %.
 *  null se stop não estiver em mode ema / desligado / sem dados. */
function computeEmaStopFloorRaw(config, cMap) {
  const stopLoss = config.stopLoss;
  if (!stopLoss?.enabled || stopLoss.mode !== 'ema') return null;
  const ema = stopLoss.ema;
  const raw = cMap[ema.interval] ?? [];
  const closed = closedCandlesOnly(raw);
  const maValue = computeMa(closed, ema.period);
  if (maValue == null) return null;
  return maValue * (1 - Math.max(0, ema.belowPct) / 100);
}

/**
 * Piso do stop-loss vigente. mode 'fixed' (padrão) usa a fórmula percentual/trailing de
 * sempre (computeStopLossFloor, compartilhada com os outros bots). mode 'ema' usa
 * stop = EMA(ema.period, ema.interval) * (1 − ema.belowPct/100) — sem trailing/peak, o piso
 * acompanha a EMA pra cima e pra baixo a cada tick.
 *
 * Se a linha EMA (ou a EMA − belowPct) estiver no/acima do preço de compra, esse stop não
 * protege a posição long (já está "por baixo" da linha) — e uma bracket com stop ≥ mercado
 * falha ou fica inútil. Nesse caso cai no piso % (maxLossPct / trailing), o mesmo de mode
 * 'fixed' — rede de segurança se a posição já estiver aberta. A entrada em si é bloqueada
 * em evaluateEntrySignal (EMA_STOP_ABOVE_ENTRY) pra não comprar nesse cenário.
 * Sem EMA disponível, também usa o piso %.
 */
function computeStopPrice(config, cMap, entryPrice, peakPrice) {
  const stopLoss = config.stopLoss;
  if (!stopLoss?.enabled) return null;

  if (stopLoss.mode === 'ema') {
    const fixedFloor = computeStopLossFloor(entryPrice, peakPrice ?? entryPrice, stopLoss);
    const emaFloor = computeEmaStopFloorRaw(config, cMap);
    if (emaFloor == null) return fixedFloor;
    if (!(entryPrice > 0) || emaFloor >= entryPrice) return fixedFloor;
    return emaFloor;
  }

  return computeStopLossFloor(entryPrice, peakPrice ?? entryPrice, stopLoss);
}

/** Preço-alvo (banda superior ao vivo) e preço-stop (fixo % ou EMA — ver computeStopPrice)
 *  vigentes — usado tanto pra colocar/repor a bracket TP/SL resting na corretora quanto pelo
 *  evaluateExit de fallback (candle, sem bracket). */
function computeBracketPrices(config, cMap, entryPrice, peakPrice) {
  const entry = config.entry;
  const iv = entry.interval;
  const raw = cMap[iv] ?? [];
  if (!raw.length) return { targetPrice: null, stopPrice: null, close: null };

  const closed = closedCandlesOnly(raw);
  const series = computeBollingerSeries(closed, entry.period, entry.stdDev);
  const live = raw[raw.length - 1];
  const close = parseFloat(live.close);
  if (!series.length) return { targetPrice: null, stopPrice: null, close };

  const lastBb = series[series.length - 1];
  const stopPrice = computeStopPrice(config, cMap, entryPrice, peakPrice);

  return { targetPrice: lastBb.upper, stopPrice, close };
}

/** Saída via candle — fallback usado quando não há bracket resting (desligada ou falhou
 *  ao colocar): máxima do candle em formação alcança a banda superior, ou mínima rompe o
 *  piso do stop percentual. */
function evaluateExit(config, cMap, entryPrice, opts = {}) {
  const entry = config.entry;
  const iv = entry.interval;
  const raw = cMap[iv] ?? [];
  if (!raw.length) return { exit: false };

  const live = raw[raw.length - 1];
  const close = parseFloat(live.close);
  const high = parseFloat(live.high ?? live.close);
  const low = parseFloat(live.low ?? live.close);

  const { targetPrice, stopPrice } = computeBracketPrices(config, cMap, entryPrice, opts.peakPrice);

  if (targetPrice != null && high >= targetPrice) {
    return {
      exit: true, reason: 'BB_UPPER_TARGET', close,
      targetLevelValue: targetPrice,
      exitDesc: `BB(${entry.period},${entry.stdDev}) ${iv} banda superior`,
    };
  }
  if (stopPrice != null && low <= stopPrice) {
    return {
      exit: true, reason: 'STOP_LOSS', close,
      dropPct: entryPrice ? ((close - entryPrice) / entryPrice) * 100 : null,
      stopFloor: stopPrice,
    };
  }
  return { exit: false, close };
}

/**
 * Cooldown pós-saída em candles do intervalo da BB (entry.interval). Conta quantos
 * candles JÁ FECHADOS abriram depois de lastExitTime; precisa de
 * entry.reentryCooldownCandles pra liberar nova compra (aí evaluateEntrySignal roda
 * a análise completa de novo). Sem lastExitTime ou com cooldown 0 → libera.
 */
function checkReentryCooldown(config, cMap, lastExitTime) {
  const need = Math.max(0, Math.round(Number(config.entry?.reentryCooldownCandles ?? 0)));
  if (need <= 0 || !lastExitTime) {
    return { waiting: false, need, have: 0, remain: 0 };
  }
  const exitMs = new Date(lastExitTime).getTime();
  if (!Number.isFinite(exitMs)) {
    return { waiting: false, need, have: 0, remain: 0 };
  }

  const iv = config.entry.interval;
  const closed = closedCandlesOnly(cMap[iv] ?? []);
  const have = closed.filter(c => Number(c.openTime) >= exitMs).length;
  const remain = Math.max(0, need - have);
  return {
    waiting: remain > 0,
    need,
    have,
    remain,
    interval: iv,
    reason: remain > 0 ? 'REENTRY_COOLDOWN' : null,
  };
}

/**
 * Ordem limite resting (armada no toque da BB): expirou depois de
 * entry.limitWaitCandles candles fechados com openTime >= signalOpenTime?
 */
function checkEntryLimitExpired(config, cMap, entryLimit) {
  const need = Math.max(1, Math.round(Number(config.entry?.limitWaitCandles ?? 5)));
  const sinceMs = Number(entryLimit?.signalOpenTime)
    || (entryLimit?.placedAt ? new Date(entryLimit.placedAt).getTime() : NaN);
  if (!Number.isFinite(sinceMs)) {
    return { expired: false, need, have: 0, remain: need };
  }
  const iv = config.entry.interval;
  const closed = closedCandlesOnly(cMap[iv] ?? []);
  const have = closed.filter(c => Number(c.openTime) >= sinceMs).length;
  const remain = Math.max(0, need - have);
  return {
    expired: remain <= 0,
    need,
    have,
    remain,
    interval: iv,
  };
}

module.exports = {
  intervalMs,
  closedCandlesOnly,
  computeBollingerSeries,
  getRequiredSpecs,
  emaSlopePct,
  checkEmaFilter,
  evaluateEntrySignal,
  evaluateExit,
  checkReentryCooldown,
  checkEntryLimitExpired,
  computeBracketPrices,
  computeStopPrice,
  computeEmaStopFloorRaw,
  computeStopLossFloor,
};
