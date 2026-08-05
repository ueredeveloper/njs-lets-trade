'use strict';

const { computeRollingVwapWithBands } = require('../../utils/vwapSession');
const { buildMaTimeSeries } = require('../../utils/movingAverage');
const { computeStopLossFloor } = require('../shared/stopLossFloor');

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};
const SESSION_HOURS = { daily: 24, weekly: 24 * 7 };

const LEVEL_LABELS = {
  lower2: 'lw2', lower1: 'lw1', vwap: 'vw', upper1: 'up1', upper2: 'up2',
};

/**
 * Escada de setups: cada um é "toque no nível de baixo → fechamento acima do nível do
 * meio → compra nesse nível (retorno) → venda no nível de cima". Três degraus:
 *   - lower2→lower1→vwap: compra na volta à -1σ, vende na linha principal, stop na -2σ.
 *   - lower1→vwap→upper1: compra na volta à linha principal, vende na +1σ, stop na -1σ.
 *   - vwap→upper1→upper2: compra na volta à +1σ, vende na +2σ (ao vivo — igual aos outros
 *     dois degraus; exit.upper2FixedPct permite trocar por um alvo fixo, mas 0 por padrão
 *     desliga isso, ver evaluateExit), stop na linha principal. Antes o usuário não operava
 *     acima da +1σ (risco de comprar continuação de topo sem nenhum filtro de tendência);
 *     com o emaFilter (EMA200 15m -2% por padrão, ver acima) como guarda extra na compra,
 *     esse degrau ficou liberado.
 * lower2 só é usado como stop do degrau de baixo, nunca como alvo/gatilho de entrada.
 */
const LADDER_SETUPS = [
  { id: 'lower2_lower1_vwap', touch: 'lower2', confirm: 'lower1', target: 'vwap' },
  { id: 'lower1_vwap_upper1', touch: 'lower1', confirm: 'vwap', target: 'upper1' },
  { id: 'vwap_upper1_upper2', touch: 'vwap', confirm: 'upper1', target: 'upper2' },
];

function labelForLevel(key) {
  return LEVEL_LABELS[key] ?? key;
}

function intervalMs(iv) {
  return INTERVAL_MS[iv] ?? 3_600_000;
}

function closedCandlesOnly(candles) {
  if (!candles?.length || candles.length < 2) return candles ?? [];
  return candles.slice(0, -1);
}

/** VWAP rolante (janela móvel de 24h ou 7d, conforme `session`) + bandas ±1σ/±2σ — sem
 *  reset de calendário. Cripto negocia 24/7 e não tem pregão real, então o reset ancorado
 *  (00:00 UTC / segunda 00:00 UTC) era só convenção — e colapsava as bandas (variância ~0)
 *  logo após cada reset, gerando sinais com distância entre bandas artificialmente estreita
 *  ou nula justo nesse período. A rolante nunca zera, então não tem esse artefato. */
function computeVwapSeries(candles, session) {
  const windowMs = (SESSION_HOURS[session] ?? SESSION_HOURS.daily) * 3_600_000;
  return computeRollingVwapWithBands(candles, { windowMs, bandMultipliers: [1, 2] });
}

/** Nomeia os 5 níveis de preço num ponto da série VWAP. */
function levelsAt(vwapPoint) {
  if (!vwapPoint) return {};
  return {
    lower2: vwapPoint.lower2, lower1: vwapPoint.lower1,
    vwap: vwapPoint.value,
    upper1: vwapPoint.upper1, upper2: vwapPoint.upper2,
  };
}

/**
 * Ponto da série VWAP vigente num dado instante — o último ponto cujo candle (do
 * intervalo em que a VWAP foi calculada, ex.: 4h) abriu em ou antes de `openTime` (do
 * intervalo em que os candles de preço são avaliados, ex.: 1h). Mesma ideia do
 * `maValueAt` do ma-cross (strategyEngine.js), usado quando dois indicadores rodam em
 * intervalos diferentes.
 */
function vwapPointAt(series, openTime) {
  if (!series?.length) return null;
  let best = null;
  for (const pt of series) {
    if (pt.openTime <= openTime) best = pt;
    else break;
  }
  return best;
}

/** Último valor da série EMA (buildMaTimeSeries) cujo openTime <= alvo — mesma convenção
 *  de vwapPointAt, mas pra uma EMA simples (usada pelo emaFilter de entrada). */
function emaFilterValueAt(series, openTime) {
  if (!series?.length) return null;
  let best = null;
  for (const pt of series) {
    if (pt.openTime <= openTime) best = pt.ma; else break;
  }
  return best;
}

/** Inclinação da EMA (série buildMaTimeSeries) no instante `openTime`: variação % entre o
 *  valor vigente e o valor de `lookback` candles (do intervalo do próprio emaFilter, ex.:
 *  15m) atrás. null se não houver histórico suficiente pra olhar tão pra trás. */
function emaFilterSlopeAt(series, openTime, lookback) {
  if (!series?.length) return null;
  let idx = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i].openTime <= openTime) idx = i; else break;
  }
  const pastIdx = idx - lookback;
  if (idx < 0 || pastIdx < 0) return null;
  const current = series[idx].ma;
  const past = series[pastIdx].ma;
  if (!(past > 0)) return null;
  return ((current - past) / past) * 100;
}

/** Inclinação (%) da própria linha VWAP (vwapSeries, ponto .value) no instante `openTime`,
 *  comparando com o valor de `lookback` candles atrás NA MESMA SÉRIE (unidade
 *  entry.vwapInterval, ex.: 4h) — mesma ideia de emaFilterSlopeAt, mas medindo a VWAP em si
 *  em vez da EMA de preço (usada pelo vwapSlopeFilter de entrada). */
function vwapSlopeAt(series, openTime, lookback) {
  if (!series?.length) return null;
  let idx = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i].openTime <= openTime) idx = i; else break;
  }
  const pastIdx = idx - lookback;
  if (idx < 0 || pastIdx < 0) return null;
  const current = series[idx].value;
  const past = series[pastIdx].value;
  if (!(past > 0)) return null;
  return ((current - past) / past) * 100;
}

/** Confere o vwapSlopeFilter (inclinação da própria linha VWAP, não da EMA de preço) no
 *  candle do sinal — ver comentário de entry.vwapSlopeFilter em tradeConfigSchema.js. */
function checkVwapSlopeFilterAt(entry, vwapSeries, openTime) {
  const vf = entry.vwapSlopeFilter;
  if (!vf?.enabled) return { ok: true };
  const slopePct = vwapSlopeAt(vwapSeries, openTime, vf.lookback);
  if (slopePct == null) return { ok: false, reason: 'VWAP_SLOPE_FILTER_NO_DATA' };
  if (slopePct < vf.minSlopePct) return { ok: false, reason: 'VWAP_SLOPE_FILTER_FALLING' };
  return { ok: true };
}

/**
 * Especificações de candles necessárias: um intervalo pros candles de preço (fechamento/
 * toque, ex.: 1h), outro pra VWAP+bandas (ex.: 4h), outro pra checagem rápida do retorno
 * durante o PENDING (ex.: 15m) e outro pro emaFilter de entrada (ex.: EMA200 15m) — podem
 * coincidir ou ser intervalos diferentes (o usuário usa VWAP 4h semanal, gráfico de 1h,
 * checagem de retorno em 15m).
 */
function getRequiredSpecs(config) {
  const entry = config.entry;
  const vwapIv = entry.vwapInterval ?? entry.interval;
  const pollIv = entry.pullback?.pollInterval ?? entry.interval;

  const sessionHours = SESSION_HOURS[entry.session] ?? 24;
  const vwapCandlesPerSession = Math.ceil((sessionHours * 3_600_000) / intervalMs(vwapIv));
  // 3 sessões de histórico pra VWAP (reancora a cada sessão, não precisa de mais que isso).
  const vwapLimit = vwapCandlesPerSession * 3 + 30;
  // Candles de preço: folga pra janela de pullback e pro lookback de reconquista.
  const priceLimit = entry.pullback.waitCandles + Math.round(Number(entry.reclaimLookbackCandles ?? 24)) + 30;
  // pollInterval precisa cobrir a janela de espera inteira (waitCandles, contado na
  // unidade de entry.interval) já escalada pra candles de pollInterval.
  const pollRatio = Math.max(1, Math.round(intervalMs(entry.interval) / intervalMs(pollIv)));
  const pollLimit = entry.pullback.waitCandles * pollRatio + 30;

  const specs = new Map();
  const add = (iv, limit) => specs.set(iv, Math.max(specs.get(iv) ?? 0, limit));
  add(entry.interval, priceLimit);
  add(vwapIv, vwapLimit);
  add(pollIv, pollLimit);

  if (entry.emaFilter?.enabled) {
    const efIv = entry.emaFilter.interval ?? pollIv;
    const efPeriod = Math.max(2, Math.round(Number(entry.emaFilter.period ?? 200)));
    // Folga de 3x o período pra EMA estabilizar (mesmo critério usado no backtest de
    // validação, ver analyze-ema200-15m-filter.js) + cobertura do lookback de reconquista
    // (checagem roda no candle do SINAL, que pode estar até reclaimLookbackCandles pra trás)
    // + folga pro slopeLookback (compara o valor vigente com o de N candles atrás na série).
    const efRatio = Math.max(1, Math.round(intervalMs(entry.interval) / intervalMs(efIv)));
    const efReclaimLookback = Math.round(Number(entry.reclaimLookbackCandles ?? 24));
    const efSlopeLookback = Math.max(0, Math.round(Number(entry.emaFilter.slopeLookback ?? 0)));
    const efLimit = efReclaimLookback * efRatio + efPeriod * 3 + efSlopeLookback + 30;
    add(efIv, efLimit);
  }

  // vwapSlopeFilter olha `lookback` candles pra trás na PRÓPRIA série de VWAP (vwapIv) —
  // soma essa folga ao limite já calculado pra vwapIv acima (add() fica com o maior).
  if (entry.vwapSlopeFilter?.enabled) {
    const vfLookback = Math.max(0, Math.round(Number(entry.vwapSlopeFilter.lookback ?? 0)));
    add(vwapIv, vwapLimit + vfLookback);
  }

  return [...specs.entries()].map(([interval, limit]) => ({ interval, limit }));
}

/**
 * Sinal de entrada (stateless — recalculado a cada tick a partir do histórico de candles):
 * roda a escada (LADDER_SETUPS) em ordem procurando, dentro de `reclaimLookbackCandles`
 * candles fechados pra trás (no intervalo de preço, ex.: 1h), a reconquista mais recente
 * do nível de confirmação — um candle DE ALTA (close > open) que fecha acima dele, tendo o
 * candle anterior fechado na/abaixo dele. Exigir candle de alta descarta reconquistas
 * "fracas" (ex.: um candle vermelho que só encosta acima da linha na ponta do pavio).
 *
 * Os níveis (lower2/lower1/vwap/upper1/upper2) vêm da VWAP calculada no intervalo
 * `vwapInterval` (ex.: 4h) — cada candle de preço usa o ponto vigente mais recente dessa
 * série (vwapPointAt), não recalcula a VWAP no próprio intervalo de preço.
 *
 * O lookback existe pelo mesmo motivo do `crossLookbackCandles` do ma-cross
 * (findRecentMaCross): sem ele, uma reconquista que aconteceu enquanto o bot estava
 * ocupado (ex.: já em PENDING esperando o retorno de um degrau anterior) nunca mais seria
 * vista. Por isso também exige que o nível tenha se "segurado" (nenhum fechamento de volta
 * abaixo dele) desde a reconquista.
 *
 * NÃO verifica aqui se o preço tocou o nível de baixo (ex.: -2σ) antes — essa exaustão já
 * é detectada pelo screener BB+VWAP do ma-cross (backend/bot/ma-cross/exhaustionScreener.js),
 * que é quem decide se a moeda entra em observação. O vwap-bands assume que, se está
 * vigiando o símbolo, a condição de exaustão já foi satisfeita — só reage ao fechamento
 * de reconquista do degrau seguinte da escada.
 *
 * Além da reconquista em si, o candle que a confirma também precisa passar no emaFilter
 * (checkEmaFilterAt, abaixo) — banda inferior + inclinação da EMA. Se não passar, o degrau
 * fica sem sinal válido (não vira `pending`) até um novo candle de reconquista aparecer; não
 * é reavaliado no retorno/pullback (ver evaluatePullbackReady).
 */
/** Confere o emaFilter (banda inferior + inclinação) no candle/preço do próprio sinal —
 *  ver comentário de entry.emaFilter em tradeConfigSchema.js. */
function checkEmaFilterAt(entry, cMap, openTime, closePrice) {
  const ef = entry.emaFilter;
  if (!ef?.enabled) return { ok: true };
  const pollIv = entry.pullback?.pollInterval ?? entry.interval;
  const efIv = ef.interval ?? pollIv;
  const efRaw = cMap[efIv] ?? [];
  const efClosed = closedCandlesOnly(efRaw);
  const efSeries = buildMaTimeSeries(efClosed, ef.period);
  const efValue = emaFilterValueAt(efSeries, openTime);
  if (efValue == null) return { ok: false, reason: 'EMA_FILTER_NO_DATA' };
  const efFloor = efValue * (1 - ef.tolerancePct / 100);
  if (closePrice <= efFloor) return { ok: false, reason: 'EMA_FILTER_BELOW_BAND' };
  const slopeLookback = ef.slopeLookback ?? 0;
  if (slopeLookback > 0) {
    const slopePct = emaFilterSlopeAt(efSeries, openTime, slopeLookback);
    if (slopePct == null) return { ok: false, reason: 'EMA_FILTER_NO_DATA' };
    if (slopePct < ef.minSlopePct) return { ok: false, reason: 'EMA_FILTER_FALLING' };
  }
  return { ok: true };
}

function evaluateEntrySignal(config, cMap) {
  const entry = config.entry;
  const iv = entry.interval;
  const vwapIv = entry.vwapInterval ?? iv;

  const raw = cMap[iv] ?? [];
  const candles = closedCandlesOnly(raw);
  if (candles.length < 2) return { allowed: false, reason: 'INSUFFICIENT_DATA' };

  const vwapRaw = cMap[vwapIv] ?? [];
  const vwapCandleSource = vwapIv === iv ? candles : closedCandlesOnly(vwapRaw);
  if (vwapCandleSource.length < 2) return { allowed: false, reason: 'NO_VWAP' };
  const vwapSeries = computeVwapSeries(vwapCandleSource, entry.session);
  if (vwapSeries.length < 2) return { allowed: false, reason: 'NO_VWAP' };

  const lastIdx = candles.length - 1;
  const minDistPct = Math.max(0, Number(entry.minBandDistancePct ?? 0));
  const minMarginPct = Math.max(0, Number(entry.minReclaimMarginPct ?? 0));
  const lookback = Math.max(1, Math.round(Number(entry.reclaimLookbackCandles ?? 24)));
  const fromIdx = Math.max(1, lastIdx - lookback + 1);
  const lastClose = parseFloat(candles[lastIdx].close);

  let lastReason = 'NO_LADDER_SIGNAL';
  let best = null;
  // Degrau mais recente que passaria em tudo (reconquista+held+bandDist+emaFilter) e só foi
  // barrado pelo vwapSlopeFilter — guardado à parte de `best` pra notificar (WhatsApp, ver
  // vwap-bands-bot.js) o caso "passou em todos os filtros, só não entrou pelo vwap em queda",
  // mesmo quando nenhum degrau libera a compra (best fica null).
  let vwapSlopeBlocked = null;

  // Avalia TODOS os degraus (não para no primeiro que bater) e fica com o de reconquista
  // MAIS RECENTE. Um degrau de baixo (ex.: lower2→lower1→vwap) fica "sempre válido" assim
  // que o preço sobe e nunca mais fecha abaixo da lower1 — se parássemos no primeiro match
  // da lista, ele bloquearia pra sempre um degrau de cima mais novo e mais relevante (ex.:
  // reconquista fresca da própria vwap, lower1→vwap→upper1), mesmo o preço já tendo subido
  // bem além dele.
  for (const setup of LADDER_SETUPS) {
    // Acha a reconquista mais recente dentro da janela (varre de trás pra frente — a 1ª
    // que achar já é a mais recente).
    let reclaimIdx = -1;
    for (let i = lastIdx; i >= fromIdx; i--) {
      const levels = levelsAt(vwapPointAt(vwapSeries, candles[i].openTime));
      const prevLevels = levelsAt(vwapPointAt(vwapSeries, candles[i - 1].openTime));
      const levelValue = levels[setup.confirm];
      const prevLevelValue = prevLevels[setup.confirm];
      if (levelValue == null || prevLevelValue == null) continue;

      const c = candles[i];
      const cClose = parseFloat(c.close);
      const cOpen = parseFloat(c.open);
      const prevClose = parseFloat(candles[i - 1].close);
      const isBullish = cClose > cOpen;
      // Exige fechar minMarginPct% acima do nível, não só "acima" por qualquer valor — sem
      // isso, um fechamento a centésimos de % da linha (ruído) já conta como reconquista
      // (ver comentário de entry.minReclaimMarginPct em tradeConfigSchema.js).
      const reclaimThreshold = levelValue * (1 + minMarginPct / 100);

      if (isBullish && prevClose <= prevLevelValue && cClose > reclaimThreshold) {
        reclaimIdx = i;
        break;
      }
    }
    if (reclaimIdx === -1) continue;

    // Precisa ter segurado o nível desde a reconquista: nenhum fechamento de volta
    // abaixo dele entre o candle da reconquista e o último candle fechado.
    let held = true;
    for (let i = reclaimIdx + 1; i <= lastIdx; i++) {
      const lv = levelsAt(vwapPointAt(vwapSeries, candles[i].openTime))[setup.confirm];
      if (lv != null && parseFloat(candles[i].close) <= lv) { held = false; break; }
    }
    if (!held) { lastReason = 'RECLAIM_LOST'; continue; }

    // Bandas muito próximas dão pouco espaço de lucro entre compra (nível de confirmação)
    // e venda (nível-alvo) — não compensa o risco/taxas. Usa os níveis ATUAIS (última VWAP
    // vigente), não os do candle da reconquista, pra refletir a distância real de agora.
    const lastLevels = levelsAt(vwapPointAt(vwapSeries, candles[lastIdx].openTime));
    const confirmLevelValue = lastLevels[setup.confirm];
    const targetLevelValue = lastLevels[setup.target];
    const bandDistPct = targetLevelValue != null && confirmLevelValue != null
      ? ((targetLevelValue - confirmLevelValue) / confirmLevelValue) * 100
      : null;
    if (bandDistPct == null || bandDistPct < minDistPct) {
      lastReason = 'BANDS_TOO_CLOSE';
      continue;
    }

    // Filtro EMA (banda inferior + inclinação, ver entry.emaFilter em tradeConfigSchema.js):
    // checado NO CANDLE DA RECONQUISTA (o candle de alta que fechou acima da linha), não no
    // momento em que o preço volta a tocá-la depois — o candle que arma o sinal já precisa
    // fechar acima da banda inferior da EMA e com a EMA estável/subindo. Motivo: a checagem
    // só no retorno deixava passar sinais armados com a EMA já em queda forte, como
    // aconteceu com a HOLO (a EMA vira antes do preço voltar pra reconquistar a linha).
    const reclaimCandle = candles[reclaimIdx];
    const emaCheck = checkEmaFilterAt(entry, cMap, reclaimCandle.openTime, parseFloat(reclaimCandle.close));
    if (!emaCheck.ok) {
      lastReason = emaCheck.reason;
      continue;
    }

    // Filtro de inclinação da VWAP (entry.vwapSlopeFilter): mesma ideia do emaFilter, mas
    // medindo a queda da própria linha VWAP em vez da EMA de preço — pega casos como
    // ALLO/PYR, onde a VWAP e as bandas em si estão em queda acentuada (a EMA200(15m) de
    // preço pode não refletir isso a tempo). Checado no mesmo candle da reconquista.
    const vwapSlopeCheck = checkVwapSlopeFilterAt(entry, vwapSeries, reclaimCandle.openTime);
    if (!vwapSlopeCheck.ok) {
      lastReason = vwapSlopeCheck.reason;
      if (!vwapSlopeBlocked || reclaimIdx > vwapSlopeBlocked.reclaimIdx) {
        vwapSlopeBlocked = {
          reclaimIdx, setup, close: parseFloat(reclaimCandle.close), confirmOpenTime: reclaimCandle.openTime,
          entryDesc: `VWAP(${vwapIv},${entry.session}) fechamento acima ${labelForLevel(setup.confirm)}`,
        };
      }
      continue;
    }

    if (!best || reclaimIdx > best.reclaimIdx) {
      best = {
        reclaimIdx, setup, confirmLevelValue, targetLevelValue, bandDistPct,
      };
    }
  }

  const vwapSlopeBlockedInfo = vwapSlopeBlocked ? {
    setupId: vwapSlopeBlocked.setup.id,
    touchLevel: vwapSlopeBlocked.setup.touch,
    confirmLevel: vwapSlopeBlocked.setup.confirm,
    targetLevel: vwapSlopeBlocked.setup.target,
    close: vwapSlopeBlocked.close,
    confirmOpenTime: vwapSlopeBlocked.confirmOpenTime,
    entryDesc: vwapSlopeBlocked.entryDesc,
  } : null;

  if (!best) return { allowed: false, reason: lastReason, close: lastClose, vwapSlopeBlocked: vwapSlopeBlockedInfo };

  // close/confirmOpenTime têm que ser do candle que DE FATO reconquistou o nível
  // (best.reclaimIdx), não do último candle fechado — senão o "horário do sinal" fica
  // avançando a cada tick em que o degrau continua válido (o `held` já garante que não
  // fechou de volta abaixo do nível desde a reconquista), inclusive travestindo um candle
  // de baixa qualquer (o mais recente fechado) de "o candle que armou a compra". Isso
  // também quebraria a preempção em PENDING (freshSignal.confirmOpenTime > signalOpenTime
  // seria sempre verdadeiro enquanto o degrau seguisse válido) e o cálculo de `waited`/
  // `mainCloseTime` do pullback, que dependem do horário real da reconquista.
  const reclaimCandle = candles[best.reclaimIdx];
  return {
    allowed: true,
    setupId: best.setup.id,
    touchLevel: best.setup.touch,
    confirmLevel: best.setup.confirm,
    targetLevel: best.setup.target,
    close: parseFloat(reclaimCandle.close),
    confirmLevelValue: best.confirmLevelValue,
    targetLevelValue: best.targetLevelValue,
    bandDistPct: best.bandDistPct,
    confirmOpenTime: reclaimCandle.openTime,
    entryDesc: `VWAP(${vwapIv},${entry.session}) fechamento acima ${labelForLevel(best.setup.confirm)}`,
    vwapSlopeBlocked: vwapSlopeBlockedInfo,
  };
}

/**
 * Janela de espera pelo retorno ao nível de confirmação (ex.: -1σ) após o candle de 1h que
 * armou a compra. A compra dispara assim que um candle FECHADO do intervalo rápido
 * (`pullback.pollInterval`, padrão 15m) tocar de volta o nível — mínima (low) dentro de
 * `tolerancePct` de distância dele — sem exigir reconquista/fechamento de força: o objetivo
 * é comprar perto da linha, não esperar confirmação extra que só empurra o preço de compra
 * pra mais longe dela (ver conversa com o usuário — comprar "no meio" das bandas não conta
 * como pullback).
 *
 * A checagem roda no intervalo RÁPIDO `pullback.pollInterval` (padrão 15m), não no
 * intervalo principal (`entry.interval`, ex.: 1h) — mesmo motivo do ema50Proximity.
 * pollInterval do ma-cross: esperar o candle de 1h fechar pra conferir o retorno deixa o
 * preço passar batido pela banda e voltar a subir dentro da própria hora, sem o bot nunca
 * ver o candle de 1h fechar já tendo tocado o nível. `waited`/expiração continuam contados
 * na unidade de entry.interval (waitCandles significa o mesmo de sempre).
 */
function evaluatePullbackReady(config, cMap, pending) {
  const entry = config.entry;
  const iv = entry.interval;
  const vwapIv = entry.vwapInterval ?? iv;
  const pollIv = entry.pullback.pollInterval ?? iv;

  const rawMain = cMap[iv] ?? [];
  const mainCandles = closedCandlesOnly(rawMain);
  if (mainCandles.length < 1) return { ready: false, reason: 'NO_DATA' };

  const waited = mainCandles.filter(c => Number(c.openTime) > Number(pending.signalOpenTime)).length;
  const waitCandles = Math.max(1, entry.pullback.waitCandles);
  if (waited > waitCandles) {
    return { ready: false, cancel: true, reason: 'PULLBACK_WINDOW_EXPIRED' };
  }

  const rawPoll = pollIv === iv ? rawMain : (cMap[pollIv] ?? []);
  const pollCandlesAll = closedCandlesOnly(rawPoll);
  // Só aceita candles do intervalo rápido (ex.: 15m) que comecem DEPOIS do fechamento do
  // candle principal que confirmou a reconquista — um candle de 15m que ainda faz parte da
  // própria hora da confirmação não é um "retorno" de verdade: nesse momento, pra quem
  // estivesse operando ao vivo, a confirmação nem tinha fechado ainda.
  const mainCloseTime = Number(pending.signalOpenTime) + intervalMs(iv);
  const pollCandles = pollCandlesAll.filter(c => Number(c.openTime) >= mainCloseTime);
  if (pollCandles.length < 1) return { ready: false, waited, need: waitCandles, reason: 'WAITING_CANDLES' };
  const lastCandle = pollCandles[pollCandles.length - 1];

  const vwapRaw = cMap[vwapIv] ?? [];
  const vwapCandleSource = closedCandlesOnly(vwapRaw);
  if (vwapCandleSource.length < 2) return { ready: false, reason: 'NO_BANDS' };
  const vwapSeries = computeVwapSeries(vwapCandleSource, entry.session);
  if (vwapSeries.length < 2) return { ready: false, reason: 'NO_BANDS' };

  const lastLevels = levelsAt(vwapPointAt(vwapSeries, lastCandle.openTime));
  const target = lastLevels[pending.confirmLevel];
  if (target == null) return { ready: false, reason: 'NO_BANDS' };

  const lastClose = parseFloat(lastCandle.close);

  // Perdeu a força do repique: fechou de volta abaixo do nível que tinha sido tocado.
  const touchLevelValue = lastLevels[pending.touchLevel];
  if (touchLevelValue != null && lastClose <= touchLevelValue) {
    return { ready: false, cancel: true, reason: 'BROKE_BACK_BELOW_TOUCH_LEVEL' };
  }

  // Único critério de compra: o preço chegou perto da linha de confirmação (mínima do
  // candle dentro de tolerancePct dela) — não importa se o candle fechou de alta ou não,
  // nem se fechou acima da linha. Comprar exige só "voltou pra linha", pra sair no preço
  // da própria linha em vez de num fechamento que já correu longe dela.
  const tol = Math.max(0, entry.pullback.tolerancePct) / 100;
  const lastLow = parseFloat(lastCandle.low ?? lastClose);
  const reachedLevel = lastLow <= target * (1 + tol);

  if (!reachedLevel) {
    return { ready: false, waited, need: waitCandles, reason: 'WAITING_CANDLES' };
  }

  // Reconfere o vwapSlopeFilter aqui, no momento REAL da compra (retorno ao nível) — não só
  // no candle que armou o sinal (checkVwapSlopeFilterAt já rodou em evaluateEntrySignal). A
  // VWAP pode virar de subida pra queda durante a espera do pullback (PENDING); sem essa
  // reconferência o filtro vira decorativo nesse caso — barra a entrada "cedo" (WATCHING) mas
  // deixa passar quando o degrau já tinha armado antes da virada (caso DEXE, ver conversa com
  // o usuário). Não cancela a pendência: só segura a compra, igual WAITING_CANDLES, até a
  // janela expirar ou a VWAP voltar a subir.
  const vwapSlopeCheck = checkVwapSlopeFilterAt(entry, vwapSeries, lastCandle.openTime);
  if (!vwapSlopeCheck.ok) {
    return { ready: false, waited, need: waitCandles, reason: vwapSlopeCheck.reason };
  }

  return {
    ready: true,
    close: lastClose,
    decisionTime: lastCandle.openTime,
    targetLevelValue: target,
    entryDesc: `retorno a ${labelForLevel(pending.confirmLevel)} VWAP(${vwapIv}) (candle toca o nível, checagem ${pollIv})`,
  };
}

/**
 * Saída: alcançou o nível-alvo do degrau que gerou a compra (`opts.targetLevel` — vwap pro
 * 1º degrau, +1σ pro 2º) ou rompeu o piso de stop-loss (estrutural/ladder por padrão, ou
 * percentual/trailing compartilhado — ver backend/bot/shared/stopLossFloor.js).
 *
 * Confere primeiro no candle FECHADO de entry.interval (ex.: 1h) — sem espiar o candle
 * ainda em formação. Se esse fechamento já estiver perto o suficiente do alvo ou do stop
 * (dentro de exit.fastCheck.proximityPct), passa a conferir também os candles fechados do
 * intervalo rápido (entry.pullback.pollInterval, ex.: 15m) a partir do fim do candle
 * principal — mesmo padrão do exit.maCross.fastCheck do ma-cross: reage ao toque sem
 * esperar até 1h a mais quando já estava a poucos % de distância.
 */
/**
 * Preço-alvo (venda) e preço-stop (banda tocada) vigentes do degrau ativo — mesmo cálculo
 * que `evaluateExit` faz internamente pra decidir a saída via candle fechado, mas exposto à
 * parte (sem tolerância aplicada) pra quem precisa só do valor cru da banda: colocar/repor
 * a ordem resting TP/SL na corretora (ver vwap-bands-bot.js) precisa do preço exato, não do
 * "já alcançou dentro da tolerância X%" que `evaluateExit` usa pra disparar a venda a mercado.
 * Retorna `{ targetPrice, stopPrice, targetLabel, close }` — qualquer valor pode vir `null`
 * se não houver candle/VWAP suficiente ainda.
 */
function computeLadderLevelPrices(config, cMap, entryPrice, opts = {}) {
  const entry = config.entry;
  const iv = entry.interval;
  const vwapIv = entry.vwapInterval ?? iv;

  const rawMain = cMap[iv] ?? [];
  const mainClosed = closedCandlesOnly(rawMain);
  if (!mainClosed.length) return { targetPrice: null, stopPrice: null, close: null };
  const last = mainClosed[mainClosed.length - 1];
  const lastClose = parseFloat(last.close);

  const vwapRaw = cMap[vwapIv] ?? [];
  const vwapCandleSource = vwapIv === iv ? mainClosed : closedCandlesOnly(vwapRaw);
  if (!vwapCandleSource.length) return { targetPrice: null, stopPrice: null, close: lastClose };
  const vwapSeries = computeVwapSeries(vwapCandleSource, entry.session);
  const vwapPoint = vwapPointAt(vwapSeries, last.openTime);
  if (!vwapPoint) return { targetPrice: null, stopPrice: null, close: lastClose };

  const levels = levelsAt(vwapPoint);
  const targetLevel = opts.targetLevel ?? 'vwap';
  // Degrau vwap→upper1→upper2: alvo fixo (preço de compra + upper2FixedPct%) em vez da +2σ
  // ao vivo — ver comentário de exit.upper2FixedPct em tradeConfigSchema.js.
  const upper2FixedPct = Math.max(0, Number(config.exit?.upper2FixedPct ?? 0));
  const useFixedUpper2Target = targetLevel === 'upper2' && upper2FixedPct > 0 && entryPrice;
  const target = useFixedUpper2Target ? entryPrice * (1 + upper2FixedPct / 100) : levels[targetLevel];

  const stopMode = config.stopLoss?.mode ?? 'ladder';
  let stopLevelValue = (config.stopLoss?.enabled && stopMode === 'ladder' && opts.touchLevel)
    ? levels[opts.touchLevel] : null;

  // Banda tocada (touchLevel) é um stop estrutural sem limite — em bandas largas (alta
  // volatilidade) pode ficar bem mais longe do que os maxLossPct% de praxe. Como esse valor
  // vira o stop de uma ordem OCO resting na corretora (ver placeInitialBracket em
  // vwap-bands-bot.js), sem esse teto a corretora só venderia depois de uma queda muito maior
  // que o stop-loss máximo configurado. Reaproveita stopLoss.maxLossPct (mesmo campo do modo
  // 'percent') como teto: nunca deixa o stop passar de maxLossPct% abaixo do preço de compra.
  if (stopLevelValue != null && entryPrice) {
    const maxLossPct = Math.max(0, Number(config.stopLoss?.maxLossPct ?? 5));
    const stopFloor = entryPrice * (1 - maxLossPct / 100);
    if (stopLevelValue < stopFloor) stopLevelValue = stopFloor;
  }

  const targetLabel = useFixedUpper2Target
    ? `alvo fixo +${upper2FixedPct}% (em vez da +2σ ao vivo)`
    : `VWAP(${vwapIv},${entry.session}) ${labelForLevel(targetLevel)}`;

  return { targetPrice: target ?? null, stopPrice: stopLevelValue ?? null, targetLabel, close: lastClose };
}

function evaluateExit(config, cMap, entryPrice, opts = {}) {
  const entry = config.entry;
  const iv = entry.interval;
  const pollIv = entry.pullback.pollInterval ?? iv;

  const rawMain = cMap[iv] ?? [];
  const mainClosed = closedCandlesOnly(rawMain);
  if (!mainClosed.length) return { exit: false };
  const last = mainClosed[mainClosed.length - 1];
  const lastClose = parseFloat(last.close);

  const { targetPrice: target, stopPrice: stopLevelValue, targetLabel } =
    computeLadderLevelPrices(config, cMap, entryPrice, opts);
  if (target == null && stopLevelValue == null) return { exit: false, close: lastClose };

  const targetLevel = opts.targetLevel ?? 'vwap';
  const stopMode = config.stopLoss?.mode ?? 'ladder';
  const tol = Math.max(0, config.exit?.tolerancePct ?? 0) / 100;
  const stopTol = Math.max(0, config.stopLoss?.tolerancePct ?? 0) / 100;
  const floor = stopLevelValue != null ? stopLevelValue * (1 - stopTol) : null;

  if (target != null) {
    const threshold = target * (1 - tol);
    const high = parseFloat(last.high ?? last.close);
    if (high >= threshold) {
      return {
        exit: true,
        reason: 'VWAP_TARGET_LEVEL',
        close: lastClose,
        decisionTime: last.openTime,
        targetLevel, targetLevelValue: target,
        exitDesc: targetLabel,
        viaFastCheck: false,
      };
    }
  }

  if (floor != null) {
    const low = parseFloat(last.low ?? last.close);
    if (low <= floor) {
      return {
        exit: true,
        reason: 'STOP_LOSS',
        close: lastClose,
        decisionTime: last.openTime,
        dropPct: entryPrice ? ((lastClose - entryPrice) / entryPrice) * 100 : null,
        stopFloor: floor,
        stopLevel: opts.touchLevel,
        exitDesc: `Stop-loss em ${labelForLevel(opts.touchLevel)}`,
        viaFastCheck: false,
      };
    }
  }

  const fastCheck = config.exit?.fastCheck;
  if (fastCheck?.enabled && pollIv !== iv && (target != null || floor != null)) {
    const proxTol = Math.max(0, fastCheck.proximityPct ?? 1) / 100;
    const nearTarget = target != null && lastClose >= target * (1 - proxTol);
    const nearStop = floor != null && lastClose <= floor * (1 + proxTol);
    if (nearTarget || nearStop) {
      const mainCloseTime = Number(last.openTime) + intervalMs(iv);
      const rawPoll = cMap[pollIv] ?? [];
      const pollClosed = closedCandlesOnly(rawPoll).filter(c => Number(c.openTime) >= mainCloseTime);
      const fastLast = pollClosed[pollClosed.length - 1];
      if (fastLast) {
        const fastClose = parseFloat(fastLast.close);
        if (nearTarget) {
          const threshold = target * (1 - tol);
          const high = parseFloat(fastLast.high ?? fastLast.close);
          if (high >= threshold) {
            return {
              exit: true,
              reason: 'VWAP_TARGET_LEVEL',
              close: fastClose,
              decisionTime: fastLast.openTime,
              targetLevel, targetLevelValue: target,
              exitDesc: `${targetLabel} (checagem rápida — perto do alvo no ${iv})`,
              viaFastCheck: true,
            };
          }
        }
        if (nearStop) {
          const low = parseFloat(fastLast.low ?? fastLast.close);
          if (low <= floor) {
            return {
              exit: true,
              reason: 'STOP_LOSS',
              close: fastClose,
              decisionTime: fastLast.openTime,
              dropPct: entryPrice ? ((fastClose - entryPrice) / entryPrice) * 100 : null,
              stopFloor: floor,
              stopLevel: opts.touchLevel,
              exitDesc: `Stop-loss em ${labelForLevel(opts.touchLevel)} (checagem rápida — perto do stop no ${iv})`,
              viaFastCheck: true,
            };
          }
        }
      }
    }
  }

  if (config.stopLoss?.enabled && stopMode === 'percent' && entryPrice && lastClose != null) {
    const peakPrice = opts.peakPrice != null ? opts.peakPrice : entryPrice;
    const stopFloor = computeStopLossFloor(entryPrice, peakPrice, config.stopLoss);
    if (stopFloor != null && lastClose <= stopFloor) {
      return {
        exit: true,
        reason: 'STOP_LOSS',
        close: lastClose,
        decisionTime: last.openTime,
        dropPct: ((lastClose - entryPrice) / entryPrice) * 100,
        stopFloor,
        peakPrice,
      };
    }
  }

  return { exit: false, close: lastClose };
}

module.exports = {
  LADDER_SETUPS,
  labelForLevel,
  intervalMs,
  computeVwapSeries,
  levelsAt,
  vwapPointAt,
  emaFilterValueAt,
  emaFilterSlopeAt,
  vwapSlopeAt,
  getRequiredSpecs,
  evaluateEntrySignal,
  evaluatePullbackReady,
  evaluateExit,
  computeStopLossFloor,
  computeLadderLevelPrices,
};
