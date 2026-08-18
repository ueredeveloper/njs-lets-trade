'use strict';

const { BollingerBands } = require('technicalindicators');
const { computeStopLossFloor } = require('../shared/stopLossFloor');
const { computeMa, buildMaTimeSeries, maLabel } = require('../../utils/movingAverage');
const { getMedianTrendThreshold } = require('../../utils/bollingerMedianTrendConfig');
const { latestPermState, isEntryBullishState } = require('../../utils/emaPersistCloud');

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

function intervalMs(iv) {
  return INTERVAL_MS[iv] ?? 3_600_000;
}

/** Intervalo padrão mais próximo de metade de `iv`, sempre estritamente menor — mesma fórmula
 *  de getEmaPersistCloudConfirmInterval em frontend-react/src/utils/uiPreferences.js (1h→30m,
 *  30m→15m, etc.), mantida em espelho aqui pro bot não depender do bundle do frontend. */
function halfInterval(iv) {
  const primaryMs = INTERVAL_MS[iv];
  if (!primaryMs) return null;
  const targetMs = primaryMs / 2;
  let best = null;
  let bestDiff = Infinity;
  for (const [k, ms] of Object.entries(INTERVAL_MS)) {
    if (ms >= primaryMs) continue;
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = k; }
  }
  return best;
}

/** Cadeia de intervalos do filtro PERM a partir do intervalo de entrada: ele mesmo, metade,
 *  um quarto (ex.: 1h → 30m → 15m) — sem duplicar/repetir quando não houver intervalo menor
 *  disponível (ex.: entrada já em '15m' → cadeia só tem '15m'). */
function permIntervalChain(entryInterval) {
  const level1 = halfInterval(entryInterval);
  const level2 = level1 ? halfInterval(level1) : null;
  return [entryInterval, level1, level2].filter(Boolean);
}

// Limiar mínimo (%, padrão global — vale para toda moeda) da inclinação média da mediana da
// BB pro medianTrendFilter liberar a compra — ver checkMedianTrendFilter. Fonte única em
// backend/utils/bollingerMedianTrendConfig.js (editável em Configurações → Filtro de
// tendência da Bollinger), compartilhada com backend/utils/bbMedianTrendTrades.js e
// analyseBollingerBandRecovery.js pra manter bot e simulação de estatísticas espelhados.

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
  const limitWait = Math.max(0, Math.round(Number(entry.limitWaitCandles ?? 0)));
  const cooldown = Math.max(0, Math.round(Number(entry.reentryCooldownCandles ?? 0)));
  const limit = entry.period * 3 + limitWait + cooldown + 30;
  const specs = new Map([[entry.interval, limit]]);

  const add = (iv, lim) => specs.set(iv, Math.max(specs.get(iv) ?? 0, lim));

  const ema = entry.emaFilter;
  if (ema?.enabled) {
    const slopeLookback = Math.max(0, Math.round(Number(ema.slopeLookback ?? 0)));
    add(ema.interval, ema.period + slopeLookback + 30);
  }

  const slEma = config.stopLoss;
  if (slEma?.enabled && slEma.mode === 'ema') add(slEma.ema.interval, slEma.ema.period + 30);

  const trend = entry.medianTrendFilter;
  if (trend?.enabled) {
    const lookback = Math.max(0, Math.round(Number(trend.lookback ?? 10)));
    add(entry.interval, entry.period + lookback + 30);
  }

  const perm = entry.permFilter;
  if (perm?.enabled) {
    // Intervalo do PERM é independente do intervalo da banda de Bollinger (entry.interval).
    // EMA21 + folga pro slope (SLOPE_LOOKBACK=2) e o candle ainda em formação.
    for (const iv of permIntervalChain(perm.interval)) add(iv, 21 + 10);
  }

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
 * Filtro de tendência da linha mediana (média) da própria Bollinger: pega os últimos
 * `lookback` valores fechados da linha média e calcula a média das variações % candle-a-candle
 * entre eles (cada variação relativa ao valor anterior). Média ≥ MEDIAN_TREND_MIN_AVG_DIFF_PCT
 * → mediana em alta/estável, libera a compra. Abaixo disso → mediana em baixa (ou subindo
 * devagar demais), bloqueia. `series` opcional reaproveita a série de BB já calculada em
 * evaluateEntrySignal (mesmo period/stdDev/interval da entrada) pra não recomputar.
 * Desligado (enabled=false) → sempre libera.
 */
function checkMedianTrendFilter(config, cMap, series) {
  const trend = config.entry?.medianTrendFilter;
  if (!trend?.enabled) return { allowed: true };

  const lookback = Math.max(1, Math.round(Number(trend.lookback ?? 10)));
  let bbSeries = series;
  if (!bbSeries) {
    const entry = config.entry;
    const raw = cMap[entry.interval] ?? [];
    const closed = closedCandlesOnly(raw);
    bbSeries = computeBollingerSeries(closed, entry.period, entry.stdDev);
  }
  if (bbSeries.length < lookback + 1) {
    return { allowed: false, reason: 'MEDIAN_TREND_NO_DATA', lookback };
  }

  const middles = bbSeries.slice(-(lookback + 1)).map(b => b.middle);
  const diffPcts = [];
  for (let i = 1; i < middles.length; i++) {
    if (!(middles[i - 1] > 0)) continue;
    diffPcts.push(((middles[i] - middles[i - 1]) / middles[i - 1]) * 100);
  }
  const avgDiffPct = diffPcts.length ? diffPcts.reduce((a, b) => a + b, 0) / diffPcts.length : 0;

  if (avgDiffPct < getMedianTrendThreshold()) {
    return { allowed: false, reason: 'MEDIAN_TREND_FALLING', avgDiffPct, lookback };
  }
  return { allowed: true, avgDiffPct, lookback };
}

/**
 * Filtro PERM (nuvem de inclinação EMA9×EMA21 — ver backend/utils/emaPersistCloud.js): libera
 * a compra sempre que a nuvem estiver VERDE (isEntryBullishState/isGreenState) — inclusive o
 * verde "antecipado" do lado abaixo da EMA21 (fallFlat/turnUp, EMA9 ainda abaixo mas já
 * estabilizando/virando), desde que as demais regras de entrada do bot Bollinger Bands também
 * sejam atendidas. `permFilter.interval` é INDEPENDENTE do intervalo da banda de Bollinger
 * (entry.interval) — ex.: BB em 15m com PERM checado em 4h. Cascata quando o intervalo mais
 * alto está sem estado disponível no momento (candle ausente, histórico curto, ou hora recém-
 * aberta): interval → metade → um quarto (ex.: 4h → 2h → 1h — ver permIntervalChain).
 * Desligado (enabled=false) → sempre libera.
 */
function checkPermFilter(config, cMap) {
  const perm = config.entry?.permFilter;
  if (!perm?.enabled) return { allowed: true };

  const chain = permIntervalChain(perm.interval);
  // `checked` registra o estado de CADA intervalo visitado na cascata (inclusive os vazios
  // que só serviram pra cair pro próximo) — usado pra montar a linha de log/WhatsApp que
  // mostra "1h neutra, 30m verde" etc., não só o intervalo que decidiu (ver permDesc em
  // bollinger-bands-bot.js).
  const checked = [];
  for (const iv of chain) {
    const closed = closedCandlesOnly(cMap[iv] ?? []);
    const last = latestPermState(closed);
    if (!last || last.state == null) {
      checked.push({ interval: iv, state: null });
      continue; // nuvem vazia nesse intervalo — cai pro próximo
    }
    const bullish = isEntryBullishState(last.state);
    checked.push({ interval: iv, state: last.state, slopePct: last.slopePct });
    return {
      allowed: bullish,
      reason: bullish ? null : 'PERM_NOT_BULLISH',
      interval: iv, state: last.state, slopePct: last.slopePct, chain, checked,
    };
  }
  // Nenhum intervalo da cadeia teve estado disponível — sem dado suficiente pra confirmar.
  return { allowed: false, reason: 'PERM_NO_DATA', chain, checked };
}

/**
 * Saída por CRUZAMENTO real da nuvem PERM depois da compra (não só "está abaixo agora" — como
 * a entrada pode acontecer com a EMA9 já abaixo da EMA21, no verde antecipado fallFlat/turnUp,
 * ver isEntryBullishState/isGreenState, só "estar abaixo" não seria cruzamento nenhum nesse
 * caso). Rastreia em `guardState.wasAbove` se a EMA9 já esteve ACIMA da EMA21 (side 'above') em
 * algum tick desde a compra; só dispara quando, tendo confirmado o lado de cima ao menos uma
 * vez, o lado volta pra baixo — o cruzamento em si. Ex.: comprou 10:00 com EMA9 já acima,
 * 10:10 cruza abaixo → vende. Comprou 10:00 com EMA9 ainda abaixo (fallFlat/turnUp) → só passa
 * a vigiar depois que cruzar pra CIMA (confirmando a reversão) e then voltar pra baixo.
 * `guardState` é o snapshot persistido no tick anterior (rules_state.permGuard — ver
 * bollinger-bands-bot.js); undefined/null no primeiro tick após a compra, auto-inicializa a
 * partir do lado atual (equivalente a checar o lado no instante da compra, sem precisar
 * snapshot separado no momento do buy). guardState do retorno só muda pra wasAbove:false
 * quando ainda não disparou saída — depois de exit:true o guardState não é resetado (fica
 * wasAbove:true), pra continuar tentando vender de novo no próximo tick se essa tentativa
 * falhar, em vez de "perder" o gatilho.
 * Cascata igual ao checkPermFilter (mesmo intervalo/ordem, primeiro com estado disponível);
 * sem dado em nenhum intervalo → não decide.
 */
function checkPermCrossExit(config, cMap, guardState) {
  const perm = config.entry?.permFilter;
  if (!perm?.enabled || perm.exitOnCrossDown === false) return { exit: false, guardState };

  const chain = permIntervalChain(perm.interval);
  for (const iv of chain) {
    const closed = closedCandlesOnly(cMap[iv] ?? []);
    const last = latestPermState(closed);
    if (!last || last.state == null) continue; // nuvem vazia nesse intervalo — cai pro próximo

    if (last.fast > last.slow) {
      return { exit: false, guardState: { wasAbove: true, interval: iv } };
    }
    const wasAbove = guardState?.wasAbove === true;
    return {
      exit: wasAbove,
      guardState: wasAbove ? guardState : { wasAbove: false, interval: iv },
      interval: iv, state: last.state, slopePct: last.slopePct,
    };
  }
  return { exit: false, guardState };
}

/**
 * Sinal de entrada: a mínima do candle mais recente (ainda em formação — reage sem esperar
 * o fechamento) toca/rompe a banda inferior, calculada com candles JÁ FECHADOS.
 * entry.pullback desce esse gatilho pullback.belowPct% abaixo da banda — exige um repique
 * mais fundo antes de comprar; desligado (padrão) compra assim que toca a banda.
 */
function evaluateEntrySignal(config, cMap) {
  const entry = config.entry;
  // Pausa de entradas (entry.enabled=false, botão "Pausar entradas" no painel): bloqueia só
  // NOVAS compras — não mexe no bloco BOUGHT do tick (bollinger-bands-bot.js), que segue
  // gerenciando/vendendo posição já aberta normalmente. Mesmo padrão de config.entry?.enabled
  // em backend/bot/ma-cross/strategyEngine.js (reason ENTRY_OFF).
  if (entry.enabled === false) return { allowed: false, reason: 'ENTRY_OFF' };
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

  const signalOpenTime = Number(live.openTime);

  const trendCheck = checkMedianTrendFilter(config, cMap, series);
  if (!trendCheck.allowed) {
    return {
      allowed: false, reason: trendCheck.reason,
      close: liveClose, lower: lastBb.lower, threshold, medianTrend: trendCheck, signalOpenTime,
    };
  }

  const emaCheck = checkEmaFilter(config, cMap, liveClose);
  if (!emaCheck.allowed) {
    return {
      allowed: false, reason: emaCheck.reason,
      close: liveClose, lower: lastBb.lower, threshold, emaFilter: emaCheck, signalOpenTime,
    };
  }

  const permCheck = checkPermFilter(config, cMap);
  if (!permCheck.allowed) {
    return {
      allowed: false, reason: permCheck.reason,
      close: liveClose, lower: lastBb.lower, threshold,
      emaFilter: emaCheck, perm: permCheck, signalOpenTime,
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
      emaStopFloor, emaFilter: emaCheck, signalOpenTime,
    };
  }

  // Stop mode 'band': mesma ideia — se o piso (banda inferior − belowPct%) já estiver
  // no/acima do preço de entrada (pullback mais raso que o belowPct do stop), não protege.
  const bandStopFloor = computeBandStopFloorRaw(config, cMap);
  if (bandStopFloor != null && threshold <= bandStopFloor) {
    return {
      allowed: false, reason: 'BAND_STOP_ABOVE_ENTRY',
      close: liveClose, lower: lastBb.lower, threshold,
      bandStopFloor, emaFilter: emaCheck, signalOpenTime,
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
  if (permCheck.state) {
    entryDesc = `${entryDesc} + PERM verde (${permCheck.interval})`;
  }

  return {
    allowed: true,
    close: liveClose,
    limitPrice: threshold,
    lower: lastBb.lower, middle: lastBb.middle, upper: lastBb.upper,
    threshold,
    emaFilter: emaCheck,
    medianTrend: trendCheck,
    perm: permCheck,
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

/** Piso bruto do stop em mode 'band' (banda inferior BB(entry.period,entry.stdDev) ao vivo
 *  × (1 − band.belowPct/100)), sem fallback %. null se stop não estiver em mode band /
 *  desligado / sem dados. */
function computeBandStopFloorRaw(config, cMap) {
  const stopLoss = config.stopLoss;
  if (!stopLoss?.enabled || stopLoss.mode !== 'band') return null;
  const entry = config.entry;
  const raw = cMap[entry.interval] ?? [];
  const closed = closedCandlesOnly(raw);
  const series = computeBollingerSeries(closed, entry.period, entry.stdDev);
  if (!series.length) return null;
  const lower = series[series.length - 1].lower;
  const belowPct = Math.max(0, stopLoss.band?.belowPct ?? 10);
  return lower * (1 - belowPct / 100);
}

/**
 * Piso do stop-loss vigente. mode 'fixed' (padrão) usa a fórmula percentual/trailing de
 * sempre (computeStopLossFloor, compartilhada com os outros bots). mode 'ema' usa
 * stop = EMA(ema.period, ema.interval) * (1 − ema.belowPct/100) — sem trailing/peak, o piso
 * acompanha a EMA pra cima e pra baixo a cada tick. mode 'band' usa
 * stop = banda inferior BB(entry.period,entry.stdDev) ao vivo × (1 − band.belowPct/100) —
 * mesma ideia, acompanha a banda inferior a cada candle novo.
 *
 * Se a linha EMA/banda (ou a linha − belowPct) estiver no/acima do preço de compra, esse
 * stop não protege a posição long (já está "por baixo" da linha) — e uma bracket com
 * stop ≥ mercado falha ou fica inútil. Nesse caso cai no piso % (maxLossPct / trailing), o
 * mesmo de mode 'fixed' — rede de segurança se a posição já estiver aberta. A entrada em si
 * é bloqueada em evaluateEntrySignal (EMA_STOP_ABOVE_ENTRY / BAND_STOP_ABOVE_ENTRY) pra não
 * comprar nesse cenário. Sem EMA/banda disponível, também usa o piso %.
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

  if (stopLoss.mode === 'band') {
    const fixedFloor = computeStopLossFloor(entryPrice, peakPrice ?? entryPrice, stopLoss);
    const bandFloor = computeBandStopFloorRaw(config, cMap);
    if (bandFloor == null) return fixedFloor;
    if (!(entryPrice > 0) || bandFloor >= entryPrice) return fixedFloor;
    return bandFloor;
  }

  return computeStopLossFloor(entryPrice, peakPrice ?? entryPrice, stopLoss);
}

/** Preço-alvo e preço-stop (fixo % ou EMA — ver computeStopPrice) vigentes — usado tanto pra
 *  colocar/repor a bracket TP/SL resting na corretora quanto pelo evaluateExit de fallback
 *  (candle, sem bracket). Alvo conforme exit.restingBracket.targetMode: 'band' (padrão) =
 *  banda superior ao vivo; 'fixed' = targetPct% de lucro fixo sobre entryPrice, constante
 *  (não precisa do bot recalcular pra continuar válido na corretora). */
function computeBracketPrices(config, cMap, entryPrice, peakPrice) {
  const entry = config.entry;
  const iv = entry.interval;
  const raw = cMap[iv] ?? [];
  if (!raw.length) return { targetPrice: null, stopPrice: null, close: null };

  const live = raw[raw.length - 1];
  const close = parseFloat(live.close);
  const stopPrice = computeStopPrice(config, cMap, entryPrice, peakPrice);

  const bracket = config.exit?.restingBracket;
  if (bracket?.targetMode === 'fixed') {
    const targetPct = Math.max(0, Number(bracket.targetPct ?? 3));
    const targetPrice = entryPrice > 0 ? entryPrice * (1 + targetPct / 100) : null;
    return { targetPrice, stopPrice, close };
  }

  const closed = closedCandlesOnly(raw);
  const series = computeBollingerSeries(closed, entry.period, entry.stdDev);
  if (!series.length) return { targetPrice: null, stopPrice: null, close };

  const lastBb = series[series.length - 1];
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
    const isFixedTarget = config.exit?.restingBracket?.targetMode === 'fixed';
    return {
      exit: true, reason: 'BB_UPPER_TARGET', close,
      targetLevelValue: targetPrice,
      exitDesc: isFixedTarget
        ? `Alvo manual +${config.exit.restingBracket.targetPct}% de lucro`
        : `BB(${entry.period},${entry.stdDev}) ${iv} banda superior`,
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

/**
 * Cooldown pós-STOP_LOSS em candles do intervalo da BB (entry.interval). Conta quantos
 * candles JÁ FECHADOS abriram depois de lastExitTime; precisa de
 * entry.reentryCooldownCandles pra liberar nova compra. Só aplica quando
 * lastExitReason === 'STOP_LOSS' — saída no alvo (BB_UPPER_TARGET) libera na hora.
 * Sem lastExitTime / cooldown 0 / outro motivo → libera.
 */
function checkReentryCooldown(config, cMap, lastExitTime, lastExitReason) {
  const need = Math.max(0, Math.round(Number(config.entry?.reentryCooldownCandles ?? 0)));
  if (need <= 0 || !lastExitTime || lastExitReason !== 'STOP_LOSS') {
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

// Ordem fixa de checagem em evaluateEntrySignal: toque na banda → mediana → EMA → PERM → stop
// (ema ou band, mutuamente exclusivos conforme stopLoss.mode). Usado só pra descrever, em
// texto, quais filtros já haviam passado quando um sinal quase entrou mas foi barrado —
// notificação de "sinal possível" no bot (ver bollinger-bands-bot.js).
const NEAR_MISS_FILTER_LABELS = {
  bbTouch: 'Toque na banda inferior',
  medianTrend: 'Tendência da mediana da BB',
  emaFilter: 'Filtro EMA de tendência',
  permFilter: 'Nuvem PERM (EMA9×EMA21)',
  emaStop: 'Stop EMA acima da entrada',
  bandStop: 'Stop banda acima da entrada',
};
// emaStop/bandStop são alternativos (dependem de stopLoss.mode, nunca os dois na mesma
// avaliação) — por isso ficam fora da ordem sequencial: qualquer um dos dois só é alcançado
// depois que os quatro filtros de NEAR_MISS_BASE_ORDER já passaram.
const NEAR_MISS_BASE_ORDER = ['bbTouch', 'medianTrend', 'emaFilter', 'permFilter'];
const NEAR_MISS_REASON_TO_FILTER = {
  MEDIAN_TREND_NO_DATA: 'medianTrend',
  MEDIAN_TREND_FALLING: 'medianTrend',
  EMA_FILTER_NO_MA: 'emaFilter',
  EMA_FILTER_BELOW: 'emaFilter',
  EMA_FILTER_NO_SLOPE: 'emaFilter',
  EMA_FILTER_FALLING: 'emaFilter',
  PERM_NOT_BULLISH: 'permFilter',
  PERM_NO_DATA: 'permFilter',
  EMA_STOP_ABOVE_ENTRY: 'emaStop',
  BAND_STOP_ABOVE_ENTRY: 'bandStop',
};

/**
 * Descreve, pra fins de notificação, um sinal que tocou a banda inferior (passou o gatilho
 * básico da estratégia) mas foi barrado por um dos filtros seguintes — quais filtros já
 * haviam passado até ali e qual barrou. Retorna null para os motivos que nem chegam a tocar
 * a banda (BB_LOWER_NOT_TOUCHED, INSUFFICIENT_DATA, NO_BANDS): não são "sinal possível".
 */
function describeNearMiss(reason) {
  const failedKey = NEAR_MISS_REASON_TO_FILTER[reason];
  if (!failedKey) return null;
  const baseIdx = NEAR_MISS_BASE_ORDER.indexOf(failedKey);
  // baseIdx === -1 → falhou no stop (emaStop/bandStop), depois dos três filtros de base.
  const passedKeys = baseIdx >= 0 ? NEAR_MISS_BASE_ORDER.slice(0, baseIdx) : NEAR_MISS_BASE_ORDER;
  return {
    passed: passedKeys.map(k => NEAR_MISS_FILTER_LABELS[k]),
    failed: NEAR_MISS_FILTER_LABELS[failedKey],
  };
}

module.exports = {
  intervalMs,
  closedCandlesOnly,
  computeBollingerSeries,
  getRequiredSpecs,
  emaSlopePct,
  checkEmaFilter,
  checkMedianTrendFilter,
  checkPermFilter,
  checkPermCrossExit,
  permIntervalChain,
  evaluateEntrySignal,
  evaluateExit,
  checkEntryLimitExpired,
  checkReentryCooldown,
  computeBracketPrices,
  computeStopPrice,
  computeEmaStopFloorRaw,
  computeBandStopFloorRaw,
  computeStopLossFloor,
  describeNearMiss,
};
