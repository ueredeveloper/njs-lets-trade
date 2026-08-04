'use strict';

/**
 * MA Cross Bot — cruzamento de duas MAs (compra) + cruzamento inverso (venda).
 *
 * strategy_id: ma-cross
 * Exemplo: MA9(15m) cruza ↑ MA21(15m) com preço acima de MA50(1h); saída MA9/21(30m) ↓.
 *
 * Uso:
 *   node backend/bot/ma-cross/ma-cross-bot.js
 *   node backend/bot/ma-cross/ma-cross-bot.js --symbol BTCUSDT
 */

const path     = require('path');
const fs       = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { sendWhatsApp } = require('../whatsapp');
const { maLabel } = require('../../utils/movingAverage');
const registry = require('../multitradeRegistry');
const { startMultitradeWatch, configFingerprint } = require('../multitradeWatch');
const { startExhaustionScreener } = require('./exhaustionScreener');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isMaCrossStrategy } = require('./strategyPresets');
const {
  getRequiredSpecs, evaluateEntry, evaluateCrossSignal, evaluatePullbackReady,
  evaluateImmediateEntry,
  pullbackEntryEnabled, ema50ProximityEnabled, evaluateExit, computeAdaptiveDips, computeAdaptiveStretches,
  computeStopLossFloor, getFinestPollInterval,
  computeDcaTiers, evaluateBbLowerEntry, evaluateEntryBbLowerSignal,
} = require('./strategyEngine');

// Componentes genéricos (compra/venda/execução), compartilhados com outros bots de
// trade (e reaproveitáveis por um bot novo) — ver backend/bot/shared/*.
const { buildAdapter, syncExchangeClocks } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const { createTradeExecution, entrySignalFields } = require('../shared/tradeExecution');

const VOL_CACHE_MS  = 5 * 60_000;

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
// Verde/vermelho reservados para compra/venda — não usar em tags de símbolo
const COLORS = ['\x1b[94m','\x1b[93m','\x1b[95m','\x1b[96m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[34m','\x1b[97m','\x1b[90m'];

function nowFmt() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function makeLogger(symbol, strategyId, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-${strategyId}.txt`);
  const tag = `${symbol}/${strategyId}`;
  return function log(...args) {
    const msg    = `[${nowFmt()}] ${color}[${tag}]${X} ${args.join(' ')}`;
    const noAnsi = msg.replace(/\x1b\[[0-9;]*m/g, '');
    console.log(msg);
    try { fs.appendFileSync(logFile, noAnsi + '\n'); } catch {}
  };
}

async function loadMaCrossRows() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  return sbReq('GET', 'rsi_multi_bot_state', null, `?or=(${ids})&order=id.asc`);
}

function crossDesc(block) {
  const dir = block.direction === 'cross_down' ? '↓' : '↑';
  return `${maLabel(block.ma1.period, block.ma1.interval)} ${dir} ${maLabel(block.ma2.period, block.ma2.interval)}`;
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  if (x < 0.01) return x.toFixed(6);
  if (x < 1) return x.toFixed(4);
  return x.toFixed(2);
}

function fmtPct(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(digits)}%`;
}

/** Resumo em texto dos cálculos que levaram à entrada (cruzamento, tendência 1h, filtros MA, Bollinger). */
function buildEntryReasonLines(config, entryMeta) {
  const lines = [];
  const entry = config.entry;

  lines.push(`${entryMeta.entryDesc ?? crossDesc(entry)} @ ${fmtPrice(entryMeta.close)}`);

  const trend = config.entryTrendMa;
  if (trend?.enabled && entryMeta.trendMa1 != null && entryMeta.trendMa2 != null) {
    const ma1Leg = trend.ma1 ?? { period: 9, interval: '4h' };
    const ma2Leg = trend.ma2 ?? { period: 21, interval: '4h' };
    lines.push(
      `Tendência ${maLabel(ma1Leg.period, ma1Leg.interval)} > ${maLabel(ma2Leg.period, ma2Leg.interval)}: `
      + `${fmtPrice(entryMeta.trendMa1)} > ${fmtPrice(entryMeta.trendMa2)} (${fmtPct(entryMeta.trendGapPct)})`,
    );
  }

  const approach = config.entryEmaApproach;
  if (approach?.enabled && entryMeta.approachTroughGapPct != null) {
    lines.push(
      `Aproximação EMA9/EMA21(4h): fundo ${fmtPct(entryMeta.approachTroughGapPct)} → agora ${fmtPct(entryMeta.approachGapPct)}`,
    );
  }

  for (const d of entryMeta.maFilterDetails ?? []) {
    const f = d.filter;
    const distTxt = d.distPct != null ? ` (${fmtPct(d.distPct)} vs MA)` : '';
    lines.push(`${maLabel(f.period, f.interval)}: preço ${fmtPrice(entryMeta.close)}${distTxt}`);
  }

  const bbf = config.entryBbFilter;
  if (bbf?.enabled && entryMeta.pctB != null) {
    const iv = entryMeta.bbInterval ?? bbf.interval ?? '4h';
    lines.push(
      `Bollinger ${iv}: %B ${(entryMeta.pctB * 100).toFixed(0)}% `
      + `(banda ${fmtPrice(entryMeta.bbLower)}–${fmtPrice(entryMeta.bbUpper)})`,
    );
  }

  // entryMeta.kind vem do registro IMMEDIATE_ENTRY_TRIGGERS (strategyEngine.js) quando a
  // compra veio de um gatilho imediato — hoje só 'bbLower'; novos gatilhos registrados lá
  // ganham aqui o mesmo detalhamento se expuserem os campos correspondentes.
  if (entryMeta.kind === 'bbLower' && entryMeta.bbLower != null) {
    const iv = entryMeta.bbInterval ?? config.entryBbLower?.interval ?? '4h';
    lines.push(
      `Bollinger ${iv} banda inferior: preço ${fmtPrice(entryMeta.close)} ≤ ${fmtPrice(entryMeta.bbLower)} `
      + `(banda ${fmtPrice(entryMeta.bbLower)}–${fmtPrice(entryMeta.bbUpper)})`,
    );
  }

  return lines;
}

// executeBuy/executeSell/saveState/insertTrade/parseRulesState/resolveLastExitTime/
// hasOpenPosition/resetOrphanPosition/postExitRulesState são genéricos (mecânica de
// ordem + bookkeeping Supabase) — ver backend/bot/shared/tradeExecution.js. Aqui só
// injetamos o que é específico do ma-cross: rótulo do bot e o texto do motivo de entrada.
const {
  saveState, insertTrade, hasOpenPosition, resetOrphanPosition,
  parseRulesState, postExitRulesState, resolveLastExitTime,
  executeBuy, executeSell,
} = createTradeExecution({
  botLabel: 'MA-CROSS',
  buildReasonLines: buildEntryReasonLines,
  computeStopLossFloor,
  extraBuyLogLines: ({ config, capital, totalCapital }) => {
    const dcaCfg = config.entryMultiDca;
    if (!dcaCfg?.enabled) return null;
    const tierCount = computeDcaTiers(parseFloat(totalCapital ?? capital), dcaCfg.minEntryUsdt).length;
    return [`Entradas parceladas (DCA): 1/${tierCount} — próxima após ${dcaCfg.reEntryGapHours}h no toque da banda inferior`];
  },
});

const DEFAULT_ENTRY_COOLDOWN_HOURS = 4;
const COOLDOWN_LOG_INTERVAL_MS = 15 * 60_000;
const ENTRY_CAP_LOG_REASON = 'ABOVE_MA2_MAX';
const PENDING_LOG_INTERVAL_MS = 15 * 60_000;
const LOW_VOL_LOG_INTERVAL_MS = 15 * 60_000;

/** Volume abaixo do mínimo nunca bloqueia compra/venda — só avisa no log (throttle 15min). */
function logLowVolumeWarning(config, session, log) {
  const vol = session.volCache?.volumeUsdt;
  const minVol = config.minVolumeUsdt ?? 1_000_000;
  if (vol == null || vol >= minVol) return;
  const now = Date.now();
  if (session.lastLowVolLogAt && now - session.lastLowVolLogAt < LOW_VOL_LOG_INTERVAL_MS) return;
  session.lastLowVolLogAt = now;
  log(`${Y}⚠️ Volume 24h (${vol.toFixed(0)} USDT) abaixo do mínimo (${minVol.toFixed(0)}) — operando mesmo assim${X}`);
}

const PENDING_CANCEL_LABELS = {
  NO_PULLBACK: 'sem pullback em direção à MA21',
  GAP_TOO_WIDE: 'ainda longe da MA21 (gap não fechou o suficiente)',
  ABOVE_MA2_MAX: 'acima do teto MA2',
  ENTRY_WINDOW_PASSED: 'janela de entrada expirou',
  SIGNAL_LOST: 'candle de sinal perdido',
  NO_PENDING_SIGNAL: 'sinal pendente inválido',
  BELOW_ADAPTIVE_FLOOR: 'filtro MA adaptativo',
  NOT_ABOVE_MA: 'filtro MA',
  NOT_BELOW_MA: 'filtro MA',
  FILTER_NO_MA: 'filtro MA indisponível',
  HTF_TREND_BELOW: 'EMA9(4h) abaixo de EMA21(4h) (fora da tolerância)',
  HTF_TREND_NO_MA: 'tendência 4h indisponível',
  HTF_TREND_NO_DATA: 'dados 4h insuficientes',
  EMA_APPROACH_NOT_FOUND: 'EMA9(4h) não formou fundo perto da EMA21 e subiu',
  EMA_APPROACH_TOO_FAR: 'fundo da EMA9(4h) longe demais da EMA21',
  EMA_APPROACH_NO_MA: 'aproximação EMA 4h indisponível',
  EMA_APPROACH_NO_DATA: 'dados 4h insuficientes p/ aproximação EMA',
  REVERSAL_1H_COOLDOWN: 'candle de exaustão 1h recente (cooldown de reversão)',
  REVERSAL_GUARD_NO_DATA: 'dados 1h insuficientes p/ guard de reversão',
  EMA50_PROXIMITY_OUTSIDE_CHANNEL: 'fora do canal EMA21/EMA50',
  EMA50_PROXIMITY_CHANNEL_TOO_WIDE: 'canal EMA21/EMA50 largo demais',
  EMA50_PROXIMITY_NOT_REACHED: 'não aproximou da EMA21 nem da EMA50',
  EMA50_PROXIMITY_NO_MA: 'EMA21/EMA50 indisponível',
};

function entryCooldownHours(config) {
  const h = Number(config?.entryCooldownHours);
  return Number.isFinite(h) && h >= 0 ? h : DEFAULT_ENTRY_COOLDOWN_HOURS;
}

function cooldownRemainingMs(lastExitTime, hours) {
  if (!hours || !lastExitTime) return 0;
  const end = new Date(lastExitTime).getTime() + hours * 3_600_000;
  return Math.max(0, end - Date.now());
}

function formatCooldownRemaining(ms) {
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function parsePendingPullback(state, session) {
  if (session?.pendingPullback) return session.pendingPullback;
  const rs = parseRulesState(state);
  return rs.pendingPullback ?? null;
}

function pendingPullbackPayload(crossCheck) {
  return {
    signalOpenTime: crossCheck.crossOpenTime,
    signalClose:    parseFloat(crossCheck.close),
    signalMa1:      crossCheck.ma1,
    startedAt:      new Date().toISOString(),
  };
}

function rulesStateWithoutPending(state, session, extra = {}) {
  const rs = { ...parseRulesState(state), ...(session?.rulesState ?? {}), ...extra };
  delete rs.pendingPullback;
  return rs;
}

/**
 * Entradas parceladas (DCA): enquanto a posição está BOUGHT, verifica se ainda há
 * tranches disponíveis (config.entryMultiDca) e, se o intervalo mínimo já passou e a
 * banda inferior tocou de novo, compra mais uma tranche e recalcula o preço médio.
 * Não mexe na fase (permanece BOUGHT) nem na saída (evaluateExit continua indiferente
 * a quantas tranches formaram a posição, pois só olha buy_price/qty agregados).
 */
async function maybeExecuteDcaReEntry({
  rowId, adapter, strategy, log, session, state, capital, symbol, cMap, evalOpts, rulesState,
}) {
  const { config } = strategy;
  const dcaCfg = config.entryMultiDca;
  const dca = rulesState.dca ?? { entries: [] };
  const tiers = computeDcaTiers(parseFloat(capital), dcaCfg.minEntryUsdt);
  if (dca.entries.length >= tiers.length) return false;

  const lastEntryTime = dca.entries.at(-1)?.time ?? state.buy_time;
  const gapMs = dcaCfg.reEntryGapHours * 3_600_000;
  if (lastEntryTime && Date.now() - new Date(lastEntryTime).getTime() < gapMs) return false;

  const signal = dcaCfg.reapplyFilters
    ? evaluateBbLowerEntry(config, cMap, computeAdaptiveDips(config, cMap), evalOpts)
    : evaluateEntryBbLowerSignal(config, cMap, { ...evalOpts, forDca: true });
  const allowed = dcaCfg.reapplyFilters ? signal.allowed : signal.matched;
  if (!allowed) return false;

  const tierIndex = dca.entries.length;
  const tierUsdt  = tiers[tierIndex];

  let result;
  try {
    result = await adapter.marketBuy(tierUsdt);
  } catch (err) {
    log(`❌ Erro na reentrada DCA: ${err.message}`);
    return false;
  }

  const { filledQty, quoteQty, avgPrice } = result;
  const prevQty  = parseFloat(state.buy_qty) || 0;
  const prevUsdt = parseFloat(state.buy_usdt) || 0;
  const newQty   = prevQty + filledQty;
  const newUsdt  = prevUsdt + quoteQty;
  const newAvgPrice = newUsdt / newQty;
  const entryTime = new Date().toISOString();

  const newDca = { entries: [...dca.entries, { price: avgPrice, qty: filledQty, usdt: quoteQty, time: entryTime }] };
  session.rulesState = { ...rulesState, dca: newDca };
  await saveState(rowId, {
    buy_price: newAvgPrice, buy_qty: newQty, buy_usdt: newUsdt,
    rules_state: session.rulesState,
  }, log);

  log(`${'─'.repeat(60)}`);
  log(`${G}🟢 REENTRADA DCA (${tierIndex + 1}/${tiers.length}) — ${tierUsdt.toFixed(2)} USDT${X}`);
  log(`   Preço: ${avgPrice.toFixed(6)}  Preço médio: ${newAvgPrice.toFixed(6)}  Qty total: ${newQty}`);
  log(`${'─'.repeat(60)}`);
  sendWhatsApp(
    `🟢 MA-CROSS REENTRADA DCA (${tierIndex + 1}/${tiers.length}) [${state.strategy_id}] ${symbol}\n`
    + `Preço: ${avgPrice}\nPreço médio: ${newAvgPrice.toFixed(6)}`,
  );
  return true;
}

async function cancelPendingPullback(rowId, log, session, state, reason, detail) {
  const label = PENDING_CANCEL_LABELS[reason] ?? reason;
  log(`${Y}⏹️  Entrada pendente cancelada — ${label}${detail ? ` (${detail})` : ''}${X}`);
  session.phase = 'WATCHING';
  session.pendingPullback = null;
  await saveState(rowId, {
    phase: 'WATCHING',
    rules_state: rulesStateWithoutPending(state, session),
    entry_signal_time: null,
    entry_signal_price: null,
  }, log);
}

function getTickPeak(cMap, config, buyPrice, storedPeak) {
  const iv = getFinestPollInterval(config);
  const last = (cMap[iv] ?? []).at(-1);
  const lastHigh = last?.high != null ? parseFloat(last.high) : parseFloat(last?.close ?? buyPrice);
  const lastClose = last?.close != null ? parseFloat(last.close) : buyPrice;
  return Math.max(storedPeak ?? buyPrice, lastHigh, lastClose);
}

async function fetchCandleMap(adapter, specs) {
  const maxLimits = {};
  for (const { interval, limit } of specs) {
    maxLimits[interval] = Math.max(maxLimits[interval] || 0, limit);
  }
  const fetchAll = () => Promise.all(
    Object.entries(maxLimits).map(async ([iv, lim]) => [iv, await adapter.fetchCandles(lim, iv)]),
  );
  let entries;
  try {
    entries = await fetchAll();
  } catch (err) {
    if (err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || /fetch failed/i.test(err.message)) {
      await new Promise(r => setTimeout(r, 2000));
      entries = await fetchAll();
    } else {
      throw err;
    }
  }
  return Object.fromEntries(entries);
}

// ── Tick ──────────────────────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, log, session) {
  const { config } = strategy;
  const specs = getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);
  const adaptiveDips = computeAdaptiveDips(config, cMap);
  const adaptiveStretches = computeAdaptiveStretches(config, cMap);
  const evalOpts = { adaptiveStretches };

  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) return { phase: 'WATCHING' };

  const { capital, symbol, strategy_id: strategyId } = state;
  /** Com entryMultiDca ligado, a 1ª entrada usa só a 1ª tranche do capital (não o
   *  capital inteiro) — as demais tranches entram depois, via reentrada na fase BOUGHT. */
  const entryCapital = config.entryMultiDca?.enabled
    ? computeDcaTiers(parseFloat(capital), config.entryMultiDca.minEntryUsdt)[0]
    : capital;
  const buyPrice = state.buy_price ? parseFloat(state.buy_price) : null;
  let phase = session.phase ?? state.phase;
  if (phase === 'BOUGHT' && !hasOpenPosition(state)) {
    return resetOrphanPosition(rowId, log, session, state, 'sem buy_qty/buy_price no Supabase');
  }
  if (session.phase === 'BOUGHT' && state.phase !== 'BOUGHT') {
    session.phase = state.phase;
    phase = state.phase;
  }

  // ── PENDING (pullback após cruzamento) ───────────────────────────────────
  if (phase === 'PENDING') {
    const pending = parsePendingPullback(state, session);
    if (!pending?.startedAt) {
      await cancelPendingPullback(rowId, log, session, state, 'NO_PENDING_SIGNAL');
      return { phase: 'WATCHING' };
    }

    // Sem teto de tempo real — quem decide até quando esperar é evaluatePullbackReady
    // (janela de waitCandles em cima do próprio candle do sinal, ver strategyEngine.js).
    const ready = evaluatePullbackReady(config, cMap, adaptiveDips, pending, adaptiveStretches);
    if (ready.cancel) {
      const detail = ready.pullbackVsMa2Pct != null
        ? `+${ready.aboveMa2Pct?.toFixed?.(1) ?? '?'}% MA21 (sinal +${ready.signalAboveMa2Pct?.toFixed?.(1) ?? '?'})`
        : (ready.aboveMa2Pct != null ? `+${ready.aboveMa2Pct.toFixed(1)}% MA21` : null);
      await cancelPendingPullback(rowId, log, session, state, ready.reason, detail);
      return { phase: 'WATCHING' };
    }
    if (!ready.ready) {
      if (ready.reason === 'WAITING_CANDLES') {
        const now = Date.now();
        if (!session.lastPendingLogAt || now - session.lastPendingLogAt >= PENDING_LOG_INTERVAL_MS) {
          session.lastPendingLogAt = now;
          const wait = ready.need ?? (ema50ProximityEnabled(config)
            ? (config.entry?.ema50Proximity?.waitCandles ?? 5)
            : (config.execution?.pullbackEntry?.waitCandles ?? 2));
          const reject = ready.lastRejectReason
            ? ` (último: ${PENDING_CANCEL_LABELS[ready.lastRejectReason] ?? ready.lastRejectReason})`
            : '';
          log(`${Y}⏳ Aguardando pullback — candle ${ready.waited}/${wait} após cruzamento${reject}${X}`);
        }
      }
      return { phase: 'PENDING' };
    }

    logLowVolumeWarning(config, session, log);

    log(`${G}📍 Pullback confirmado (${ready.entryDesc}) — comprando ${parseFloat(entryCapital).toFixed(2)} USDT${X}`);
    const bought = await executeBuy({
      rowId, adapter, strategy, log, session, state,
      entryMeta: {
        ...ready,
        // Sinal = candle do cruzamento (pending.signalOpenTime), não o candle da compra
        // (que só vem depois do pullback) — ver comentário de entrySignalFields em
        // tradeExecution.js.
        signalOpenTime: pending.signalOpenTime,
        signalPrice: ready.signalClose ?? pending.signalClose,
      },
      capital: entryCapital, totalCapital: capital, strategyId, symbol,
    });
    return { phase: bought ? 'BOUGHT' : 'PENDING' };
  }

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    // Dois grupos de gatilho de entrada, independentes entre si: o cruzamento EMA
    // (config.entry — o único com fase PENDING/pullback) e o registro de gatilhos
    // imediatos (IMMEDIATE_ENTRY_TRIGGERS em strategyEngine.js — hoje só banda inferior
    // BB, mas novos indicadores de entrada plugam ali sem tocar este arquivo). Qualquer
    // um que disparar já é suficiente; cada um segue seu próprio fluxo de execução.
    const crossCheck = evaluateCrossSignal(config, cMap, adaptiveDips);
    const immediateCheck = evaluateImmediateEntry(config, cMap, adaptiveDips, evalOpts);
    if (!crossCheck.allowed && !immediateCheck.allowed) return { phase };

    const cooldownH = entryCooldownHours(config);
    if (cooldownH > 0) {
      const remaining = cooldownRemainingMs(resolveLastExitTime(state, session), cooldownH);
      if (remaining > 0) {
        const now = Date.now();
        if (!session.lastCooldownLogAt || now - session.lastCooldownLogAt >= COOLDOWN_LOG_INTERVAL_MS) {
          session.lastCooldownLogAt = now;
          const kindLabel = crossCheck.allowed
            ? (crossCheck.entryDesc ?? crossDesc(config.entry))
            : immediateCheck.entryDesc;
          log(`${Y}⏳ Sinal (${kindLabel}) — cooldown ${formatCooldownRemaining(remaining)} restantes${X}`);
        }
        return { phase };
      }
    }

    logLowVolumeWarning(config, session, log);

    // Gatilhos imediatos não têm janela de pullback (o próprio disparo já representa o
    // "fundo" que o pullback do cruzamento tenta achar).
    if (immediateCheck.allowed) {
      log(`${G}📍 COMPRA imediata (${immediateCheck.entryDesc}) — ${parseFloat(entryCapital).toFixed(2)} USDT${X}`);
      const bought = await executeBuy({
        rowId, adapter, strategy, log, session, state,
        entryMeta: {
          ...immediateCheck,
          signalOpenTime: immediateCheck.crossOpenTime ?? null,
          signalPrice: immediateCheck.close ?? null,
        },
        capital: entryCapital, totalCapital: capital, strategyId, symbol,
      });
      return { phase: bought ? 'BOUGHT' : 'WATCHING' };
    }

    const entryCheck = evaluateEntry(config, cMap, adaptiveDips, evalOpts);
    const usingEma50Proximity = ema50ProximityEnabled(config);
    const usePendingFallback = (pullbackEntryEnabled(config) || usingEma50Proximity)
      && config.execution?.immediateEntry !== true;

    if (entryCheck.allowed) {
      const kindLabel = entryCheck.entryDesc ?? crossDesc(config.entry);
      const capLabel = usingEma50Proximity ? 'canal EMA21/EMA50' : `≤${entryCheck.maxAboveMaPct ?? 3}% MA21`;
      log(`${G}📍 COMPRA imediata (${kindLabel}) — ${capLabel} — ${parseFloat(entryCapital).toFixed(2)} USDT${X}`);
      const bought = await executeBuy({
        rowId, adapter, strategy, log, session, state,
        entryMeta: {
          ...entryCheck,
          signalOpenTime: entryCheck.crossOpenTime ?? null,
          signalPrice: entryCheck.close ?? null,
        },
        capital: entryCapital, totalCapital: capital, strategyId, symbol,
      });
      return { phase: bought ? 'BOUGHT' : 'WATCHING' };
    }

    if (usePendingFallback) {
      const pending = pendingPullbackPayload(crossCheck);
      const wait = usingEma50Proximity
        ? (config.entry?.ema50Proximity?.waitCandles ?? 5)
        : (config.execution?.pullbackEntry?.waitCandles ?? 2);
      session.phase = 'PENDING';
      session.pendingPullback = pending;
      session.rulesState = { ...parseRulesState(state), pendingPullback: pending };
      await saveState(rowId, {
        phase: 'PENDING',
        rules_state: session.rulesState,
        ...entrySignalFields({ signalOpenTime: pending.signalOpenTime, signalPrice: pending.signalClose }),
      }, log);
      if (usingEma50Proximity) {
        const label = entryCheck.reason === 'EMA50_PROXIMITY_CHANNEL_TOO_WIDE'
          ? `canal EMA21/EMA50 largo demais (${entryCheck.channelWidthPct?.toFixed(2)}% > ${entryCheck.maxChannelPct}%)`
          : 'fora do canal EMA21/EMA50';
        log(`${G}📍 Cruzamento (${crossCheck.entryDesc}) — ${label} → pending pullback (até ${wait} candles)${X}`);
      } else if (entryCheck.reason === ENTRY_CAP_LOG_REASON) {
        const pct = entryCheck.aboveMa2Pct != null ? entryCheck.aboveMa2Pct.toFixed(1) : '?';
        const cap = entryCheck.maxAboveMaPct ?? '?';
        log(`${G}📍 Cruzamento (${crossCheck.entryDesc}) — +${pct}% MA21 (máx ${cap}%) → pending pullback (até ${wait} candles)${X}`);
      } else {
        log(`${G}📍 Cruzamento (${crossCheck.entryDesc}) — aguardando pullback (até ${wait} candles)${X}`);
      }
      return { phase: 'PENDING' };
    }

    if (entryCheck.reason === ENTRY_CAP_LOG_REASON) {
      const now = Date.now();
      if (!session.lastEntryCapLogAt || now - session.lastEntryCapLogAt >= COOLDOWN_LOG_INTERVAL_MS) {
        session.lastEntryCapLogAt = now;
        const pct = entryCheck.aboveMa2Pct != null ? entryCheck.aboveMa2Pct.toFixed(1) : '?';
        const cap = entryCheck.maxAboveMaPct ?? '?';
        log(`${Y}⛔ Sinal bloqueado — preço +${pct}% acima MA21 (máx ${cap}%)${X}`);
      }
    }
    return { phase };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  if (phase === 'BOUGHT') {
    const rulesState = { ...parseRulesState(state), ...(session.rulesState ?? {}) };
    const storedPeak = rulesState.stopPeakPrice != null
      ? parseFloat(rulesState.stopPeakPrice)
      : buyPrice;
    const peakPrice = getTickPeak(cMap, config, buyPrice, storedPeak);
    const stopFloor = computeStopLossFloor(buyPrice, peakPrice, config.stopLoss);
    const prevFloor = rulesState.stopFloor != null
      ? parseFloat(rulesState.stopFloor)
      : computeStopLossFloor(buyPrice, storedPeak, config.stopLoss);

    if (peakPrice > storedPeak + 1e-12 || Math.abs((stopFloor ?? 0) - (prevFloor ?? 0)) > 1e-12) {
      session.rulesState = { ...rulesState, stopPeakPrice: peakPrice, stopFloor };
      await saveState(rowId, { rules_state: session.rulesState }, log);
      if (stopFloor != null && stopFloor > prevFloor + 1e-12) {
        log(`📈 Stop trailing: pico ${peakPrice.toFixed(6)} → piso ${stopFloor.toFixed(6)}`);
      }
    }

    if (config.entryMultiDca?.enabled) {
      const reentered = await maybeExecuteDcaReEntry({
        rowId, adapter, strategy, log, session, state, capital, symbol, cMap, evalOpts, rulesState,
      });
      if (reentered) return { phase: 'BOUGHT' };
    }

    const entryOpenTime = state.buy_time ? new Date(state.buy_time).getTime() : null;
    const exitResult = evaluateExit(config, cMap, buyPrice, { peakPrice, entryOpenTime });
    if (!exitResult.exit) return { phase };

    try {
      await executeSell({
        rowId, adapter, strategy, log, state, exitResult, session,
        defaultReasonDesc: crossDesc(config.exit?.maCross ?? config.exit),
      });
      session.phase = 'WATCHING';
      session.rulesState = null;
    } catch {
      return { phase: 'BOUGHT' };
    }
    return { phase: 'WATCHING' };
  }

  return { phase };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color) {
  if (registry.has(row.id)) return;

  let strategy = resolveStrategy(row);
  if (!strategy) return;

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, row.strategy_id, color);

  const ctx = {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: registry.sessionKey(row.symbol, row.strategy_id),
    adapter,
    log,
    strategy,
    stopped: false,
    timer: null,
    configFingerprint: configFingerprint(row),
  };

  let lastResult = { phase: row.phase };
  const rs = parseRulesState(row);
  const session  = {
    volCache: null,
    phase: ['BOUGHT', 'PENDING'].includes(row.phase) ? row.phase : null,
    pendingPullback: rs.pendingPullback ?? null,
    rulesState: null,
    lastExitTime: rs.lastExitTime ?? null,
    lastCooldownLogAt: 0,
    lastEntryCapLogAt: 0,
    lastPendingLogAt: 0,
  };
  let volIv;

  const stop = async () => {
    if (ctx.stopped) return;
    ctx.stopped = true;
    if (ctx.timer) clearTimeout(ctx.timer);
    if (volIv) clearInterval(volIv);
    registry.unregister(ctx.rowId);
  };

  const updateFromRow = (newRow) => {
    const next = resolveStrategy(newRow);
    if (!next) return;
    ctx.strategy = next;
  };

  registry.register(row.id, {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: ctx.key,
    stop,
    updateFromRow,
    configFingerprint: ctx.configFingerprint,
  });

  const refreshVol = async () => {
    if (ctx.stopped) return;
    try {
      const volumeUsdt = await adapter.fetch24hVol();
      session.volCache = { ts: Date.now(), volumeUsdt };
    } catch {}
  };
  await refreshVol();
  volIv = setInterval(refreshVol, VOL_CACHE_MS);

  const schedule = () => {
    if (ctx.stopped) return;
    const delay = lastResult.phase === 'BOUGHT' ? ctx.strategy.fastPollMs : ctx.strategy.pollMs;
    ctx.timer = setTimeout(run, delay);
  };

  const run = async () => {
    if (ctx.stopped) return;
    try {
      lastResult = await tick(ctx.rowId, adapter, ctx.strategy, log, session);
    } catch (err) {
      log(`❌ Tick error: ${err.message}`);
    }
    schedule();
  };

  await run();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  // Gate.io sincroniza o próprio relógio sozinha ao carregar o módulo (ver
  // backend/gate/getGateClient.js) — só a Binance precisa ser sincronizada aqui.
  await syncExchangeClocks();
  setInterval(syncExchangeClocks, 60 * 60_000);

  const symbolFilter = process.argv.includes('--symbol')
    ? process.argv[process.argv.indexOf('--symbol') + 1]?.toUpperCase()
    : null;

  let rows = await loadMaCrossRows();
  rows = (rows ?? []).filter(r => isMaCrossStrategy(r.strategy_id));
  if (symbolFilter) {
    rows = rows.filter(r => r.symbol.toUpperCase() === symbolFilter);
  }

  startMultitradeWatch({
    sbReq,
    strategyIds: STRATEGY_IDS,
    symbolFilter,
    resolveStrategy,
    onStartSymbol: (row) => {
      const idx = row.symbol.charCodeAt(0) + (row.strategy_id?.length ?? 0);
      return startSymbol(row, COLORS[idx % COLORS.length]);
    },
    log: console.log,
  });

  // Screener de exaustão BB+VWAP (4h) só roda no processo "full" (todas as moedas
  // do painel) — o modo --symbol é usado pra debugar uma moeda específica.
  if (!symbolFilter) {
    startExhaustionScreener({ sbReq, log: console.log });
  }

  // Volume baixo é só informativo — nunca impede o bot de comprar ou vender.
  const toStart = [];
  const lowVolRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const color   = COLORS[i % COLORS.length];
    const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
    const strategy = resolveStrategy(row);
    const minVol = strategy?.config.minVolumeUsdt ?? 1_000_000;

    let volOk = true;
    try {
      const vol = await adapter.fetch24hVol();
      volOk  = vol >= minVol;
    } catch {}

    if (!volOk && !symbolFilter) {
      lowVolRows.push(row);
    }
    toStart.push({ row, color });
  }

  if (lowVolRows.length) {
    console.log(`   ${Y}⚠️${X} Volume abaixo do mínimo (não impede compra/venda):`);
    lowVolRows.forEach(row => console.log(`      - ${row.symbol} [${row.strategy_id}]`));
  }

  if (!toStart.length) {
    await new Promise(() => {});
    return;
  }

  await Promise.all(toStart.map(({ row, color }) => startSymbol(row, color)));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
