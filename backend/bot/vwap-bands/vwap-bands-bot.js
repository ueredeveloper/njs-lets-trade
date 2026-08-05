'use strict';

/**
 * VWAP Bands Bot — escada de repique nas bandas da VWAP de sessão (ver strategyEngine.js):
 *   1. Preço toca (qualquer parte do candle) a banda -2σ.
 *   2. Um candle fecha acima da -1σ → arma a compra.
 *   3. Espera até N candles o preço retornar perto da -1σ → compra a mercado.
 *   4. Vende quando o preço alcança de volta a linha principal da VWAP.
 * Mesma regra se repete em mais dois degraus acima: toque na -1σ, fechamento acima da
 * linha principal → compra na linha principal → venda na +1σ; toque na linha principal,
 * fechamento acima da +1σ → compra na +1σ → venda na +2σ (liberado pelo emaFilter — EMA200
 * 15m -2% por padrão — como guarda extra na compra).
 *
 * strategy_id: vwap-bands
 *
 * Uso:
 *   node backend/bot/vwap-bands/vwap-bands-bot.js
 *   node backend/bot/vwap-bands/vwap-bands-bot.js --symbol BTCUSDT
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const registry = require('../multitradeRegistry');
const { startMultitradeWatch, configFingerprint } = require('../multitradeWatch');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isVwapBandsStrategy } = require('./strategyPresets');
const {
  labelForLevel, getRequiredSpecs, evaluateEntrySignal, evaluatePullbackReady, evaluateExit,
  computeStopLossFloor, computeLadderLevelPrices,
} = require('./strategyEngine');

// Componentes genéricos (compra/venda/execução), compartilhados com os outros bots de
// trade — ver backend/bot/shared/*.
const { buildAdapter, syncExchangeClocks } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const { createTradeExecution, entrySignalFields } = require('../shared/tradeExecution');
const { sendWhatsApp } = require('../whatsapp');

const BOT_LABEL = 'VWAP-BANDS';
const VOL_CACHE_MS = 5 * 60_000;
const PENDING_LOG_INTERVAL_MS = 15 * 60_000;

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
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

async function loadRows() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  return sbReq('GET', 'rsi_multi_bot_state', null, `?or=(${ids})&order=id.asc`);
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  if (x < 0.01) return x.toFixed(6);
  if (x < 1) return x.toFixed(4);
  return x.toFixed(2);
}

/** Resumo em texto do motivo da entrada — mostra os dois níveis da escada envolvidos. */
function buildEntryReasonLines(config, entryMeta) {
  const lines = [`${entryMeta.entryDesc} @ ${fmtPrice(entryMeta.close)}`];
  if (entryMeta.targetLevelValue != null) {
    lines.push(`Alvo de venda: ${labelForLevel(entryMeta.targetLevel)} @ ${fmtPrice(entryMeta.targetLevelValue)}`);
  }
  return lines;
}

// executeBuy/executeSell/saveState/insertTrade/parseRulesState/resolveLastExitTime/
// hasOpenPosition/resetOrphanPosition são genéricos — ver backend/bot/shared/tradeExecution.js.
// extraInitialRulesState grava qual degrau da escada gerou a compra (activeSetup), pra
// evaluateExit saber qual nível vigiar durante a fase BOUGHT.
const {
  saveState, insertTrade, hasOpenPosition, resetOrphanPosition,
  parseRulesState, resolveLastExitTime,
  executeBuy, executeSell, recordBracketFill,
} = createTradeExecution({
  botLabel: BOT_LABEL,
  buildReasonLines: buildEntryReasonLines,
  computeStopLossFloor,
  extraInitialRulesState: ({ entryMeta }) => ({
    activeSetup: { targetLevel: entryMeta.targetLevel, touchLevel: entryMeta.touchLevel },
  }),
});

function parsePendingSetup(state, session) {
  if (session?.pendingSetup) return session.pendingSetup;
  return parseRulesState(state).pendingSetup ?? null;
}

async function cancelPending(rowId, log, session, state, reason) {
  log(`${Y}⏹️  Entrada pendente cancelada — ${reason}${X}`);
  session.phase = 'WATCHING';
  session.pendingSetup = null;
  const rs = { ...parseRulesState(state), ...(session.rulesState ?? {}) };
  delete rs.pendingSetup;
  await saveState(rowId, { phase: 'WATCHING', rules_state: rs, entry_signal_time: null, entry_signal_price: null }, log);
}

/**
 * Coloca a bracket TP/SL resting na corretora logo após a compra confirmar (só se
 * `exit.restingBracket.enabled`). Falha em silêncio (loga e segue) — sem a bracket, a saída
 * continua funcionando do jeito de sempre via `evaluateExit`/venda a mercado no tick.
 */
async function placeInitialBracket({ rowId, adapter, config, cMap, session, log, activeSetup, filledQty, buyPrice }) {
  if (!config.exit.restingBracket?.enabled) return;
  const { targetPrice, stopPrice } = computeLadderLevelPrices(config, cMap, buyPrice, activeSetup);
  if (targetPrice == null || stopPrice == null) {
    log(`${Y}⚠️  Bracket TP/SL não colocada — níveis da VWAP indisponíveis ainda${X}`);
    return;
  }
  try {
    const bracket = await adapter.placeExitBracket(filledQty, targetPrice, stopPrice);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, placedAt: new Date().toISOString() } };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    log(`${G}🎯 Bracket TP/SL colocada na corretora — alvo ${fmtPrice(bracket.targetPrice)} (${labelForLevel(activeSetup.targetLevel)}) / stop ${fmtPrice(bracket.stopPrice)} (${labelForLevel(activeSetup.touchLevel)})${X}`);
  } catch (err) {
    log(`${Y}⚠️  Falha ao colocar bracket TP/SL (${err.message}) — segue só no candle fechado${X}`);
  }
}

/** Recalcula alvo/stop vigentes e recria a bracket se algum desviou ≥driftPct% do preço em
 *  que foi colocada (bandas da VWAP se movem a cada candle novo do vwapInterval). */
async function maybeReplaceBracket({ rowId, adapter, config, cMap, session, log, activeSetup, exitBracket, buyPrice, buyQty }) {
  const driftPct = config.exit.restingBracket?.driftPct ?? 3;
  const { targetPrice: liveTarget, stopPrice: liveStop } = computeLadderLevelPrices(config, cMap, buyPrice, activeSetup);
  if (liveTarget == null || liveStop == null) return;

  const drifted = (livePrice, placedPrice) => placedPrice
    ? Math.abs((livePrice - placedPrice) / placedPrice) * 100 >= driftPct
    : false;
  if (!drifted(liveTarget, exitBracket.targetPrice) && !drifted(liveStop, exitBracket.stopPrice)) return;

  let cancelled = false;
  try {
    await adapter.cancelExitBracket(exitBracket);
    cancelled = true;
    const bracket = await adapter.placeExitBracket(buyQty, liveTarget, liveStop);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, placedAt: new Date().toISOString() } };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    log(`🔁 Bracket TP/SL recriada (deriva ≥${driftPct}%) — alvo ${fmtPrice(bracket.targetPrice)} / stop ${fmtPrice(bracket.stopPrice)}`);
  } catch (err) {
    if (cancelled) {
      // A bracket antiga já foi cancelada na corretora antes da nova falhar — a posição
      // ficou sem TP/SL resting nenhuma. Limpa exitBracket pra o próximo tick cair no
      // fallback de saída via candle fechado (evaluateExit/stop percentual) em vez de
      // achar que uma bracket morta ainda está protegendo o trade.
      session.rulesState = { ...(session.rulesState ?? {}), exitBracket: null };
      await saveState(rowId, { rules_state: session.rulesState }, log);
      log(`${Y}⚠️  Falha ao recriar bracket TP/SL (${err.message}) — bracket antiga já cancelada, voltando pra saída via candle fechado${X}`);
    } else {
      log(`${Y}⚠️  Falha ao recriar bracket TP/SL (${err.message}) — mantendo a atual${X}`);
    }
  }
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

  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) return { phase: 'WATCHING' };

  const { capital, symbol, strategy_id: strategyId } = state;
  const buyPrice = state.buy_price ? parseFloat(state.buy_price) : null;
  let phase = session.phase ?? state.phase;
  if (phase === 'BOUGHT' && !hasOpenPosition(state)) {
    return resetOrphanPosition(rowId, log, session, state, 'sem buy_qty/buy_price no Supabase');
  }
  if (session.phase === 'BOUGHT' && state.phase !== 'BOUGHT') {
    session.phase = state.phase;
    phase = state.phase;
  }

  // ── PENDING (espera retorno ao nível de confirmação) ─────────────────────
  if (phase === 'PENDING') {
    let pending = parsePendingSetup(state, session);
    if (!pending?.signalOpenTime) {
      await cancelPending(rowId, log, session, state, 'sinal pendente inválido');
      return { phase: 'WATCHING' };
    }

    // Preempção: mesmo em PENDING, confere se surgiu uma reconquista mais recente (ex.:
    // um degrau acima da escada) — sem isso, um pending antigo (ex.: aguardando retorno à
    // -1σ há várias horas) fica bloqueando pra sempre a detecção de um sinal mais novo e
    // mais relevante (ex.: reconquista fresca da própria vwap), mesmo o preço já tendo
    // subido bem além do degrau original. Troca pro sinal mais recente e reinicia a espera.
    const freshSignal = evaluateEntrySignal(config, cMap);
    if (freshSignal.allowed && Number(freshSignal.confirmOpenTime) > Number(pending.signalOpenTime)) {
      pending = {
        setupId: freshSignal.setupId,
        touchLevel: freshSignal.touchLevel,
        confirmLevel: freshSignal.confirmLevel,
        targetLevel: freshSignal.targetLevel,
        signalOpenTime: freshSignal.confirmOpenTime,
        signalClose: freshSignal.close,
      };
      session.pendingSetup = pending;
      session.rulesState = { ...parseRulesState(state), pendingSetup: pending };
      await saveState(rowId, {
        rules_state: session.rulesState,
        ...entrySignalFields({ signalOpenTime: pending.signalOpenTime, signalPrice: pending.signalClose }),
      }, log);
      log(`${G}📍 Sinal mais recente (${freshSignal.entryDesc}) — trocando pendência, aguardando retorno a ${labelForLevel(freshSignal.confirmLevel)}${X}`);
    }

    const ready = evaluatePullbackReady(config, cMap, pending);
    if (ready.cancel) {
      await cancelPending(rowId, log, session, state, ready.reason);
      return { phase: 'WATCHING' };
    }
    if (!ready.ready) {
      const now = Date.now();
      if (!session.lastPendingLogAt || now - session.lastPendingLogAt >= PENDING_LOG_INTERVAL_MS) {
        session.lastPendingLogAt = now;
        if (ready.reason === 'WAITING_CANDLES') {
          log(`${Y}⏳ Aguardando retorno a ${labelForLevel(pending.confirmLevel)} — candle ${ready.waited}/${ready.need}${X}`);
        } else if (ready.reason === 'VWAP_SLOPE_FILTER_FALLING' || ready.reason === 'VWAP_SLOPE_FILTER_NO_DATA') {
          // Preço já retornou ao nível, mas a VWAP virou pra queda durante a espera do
          // pullback (ver comentário em evaluatePullbackReady) — segura a compra sem cancelar.
          log(`${Y}🟡 Retorno alcançado, mas segurando — VWAP em queda no momento da entrada (${ready.reason})${X}`);
        }
      }
      return { phase: 'PENDING' };
    }

    log(`${G}📍 Retorno confirmado (${ready.entryDesc}) — comprando ${parseFloat(capital).toFixed(2)} USDT a ${fmtPrice(ready.targetLevelValue)} (ordem limite)${X}`);
    const bought = await executeBuy({
      rowId, adapter, strategy, log, session,
      // limitPrice = valor exato da linha (lower1/vwap) que armou o pullback — força ordem
      // limite nesse preço em vez de a mercado (ver tradeExecution.js), pra não comprar "no
      // meio" das bandas quando o candle só tocou a linha de leve.
      // signalPrice: preço do candle que tocou a banda (pending.signalClose) — entryMeta.close
      // já é o preço do candle de RETORNO (mais tarde), não o do toque original.
      entryMeta: { ...pending, ...ready, limitPrice: ready.targetLevelValue, signalPrice: pending.signalClose },
      capital, strategyId, symbol,
    });
    if (bought) {
      await placeInitialBracket({
        rowId, adapter, config, cMap, session, log,
        activeSetup: { targetLevel: pending.targetLevel, touchLevel: pending.touchLevel },
        filledQty: bought.filledQty, buyPrice: bought.avgPrice,
      });
    }
    return { phase: bought ? 'BOUGHT' : 'PENDING' };
  }

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase === 'WATCHING') {
    const signal = evaluateEntrySignal(config, cMap);

    // Aviso experimental (período de teste, ver conversa com o usuário): moeda que passaria
    // em tudo (reconquista + held + bandDist + emaFilter) e só não comprou porque o
    // vwapSlopeFilter bloqueou — não impede nada, só avisa via WhatsApp pra decidir depois se
    // vale manter o filtro ligado. Dedupe por confirmOpenTime pra não repetir a cada tick
    // enquanto o mesmo degrau continuar bloqueado.
    if (!signal.allowed && signal.vwapSlopeBlocked
        && session.lastVwapSlopeNotifyOpenTime !== signal.vwapSlopeBlocked.confirmOpenTime) {
      session.lastVwapSlopeNotifyOpenTime = signal.vwapSlopeBlocked.confirmOpenTime;
      const vb = signal.vwapSlopeBlocked;
      log(`${Y}🟡 Só não entrou pelo filtro de queda da VWAP — ${vb.entryDesc} @ ${fmtPrice(vb.close)}${X}`);
      sendWhatsApp(
        `🟡 ${BOT_LABEL} [${strategyId}] ${symbol}\nPassou em todos os filtros, mas o filtro de queda da VWAP bloqueou a entrada\n${vb.entryDesc} @ ${fmtPrice(vb.close)}`,
      );
    }

    if (!signal.allowed) return { phase };

    const pending = {
      setupId: signal.setupId,
      touchLevel: signal.touchLevel,
      confirmLevel: signal.confirmLevel,
      targetLevel: signal.targetLevel,
      signalOpenTime: signal.confirmOpenTime,
      signalClose: signal.close,
    };
    session.phase = 'PENDING';
    session.pendingSetup = pending;
    session.rulesState = { ...parseRulesState(state), pendingSetup: pending };
    await saveState(rowId, {
      phase: 'PENDING',
      rules_state: session.rulesState,
      ...entrySignalFields({ signalOpenTime: pending.signalOpenTime, signalPrice: pending.signalClose }),
    }, log);
    const wait = config.entry.pullback.waitCandles;
    log(`${G}📍 Sinal (${signal.entryDesc}) — aguardando retorno a ${labelForLevel(signal.confirmLevel)} (até ${wait} candles)${X}`);
    return { phase: 'PENDING' };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  if (phase === 'BOUGHT') {
    const rulesState = { ...parseRulesState(state), ...(session.rulesState ?? {}) };
    const activeSetup = rulesState.activeSetup ?? { targetLevel: 'vwap', touchLevel: 'lower1' };
    const stopMode = config.stopLoss?.mode ?? 'ladder';

    // Bracket TP/SL resting na corretora (se ligada pra esse símbolo) — confere ANTES de
    // tudo: se uma perna já encheu (inclusive enquanto o bot estava offline — reconciliação
    // de restart acontece de graça aqui, é o primeiro tick depois de subir), fecha o trade
    // com os valores reais da corretora sem chamar `adapter.marketSell` de novo.
    if (rulesState.exitBracket) {
      let bracketResult;
      try {
        bracketResult = await adapter.pollExitBracket(rulesState.exitBracket);
      } catch (err) {
        log(`${Y}⚠️  Erro ao consultar bracket TP/SL: ${err.message}${X}`);
        bracketResult = { filled: null };
      }

      if (bracketResult.filled) {
        const kind = bracketResult.filled;
        const exitResult = {
          reason: kind === 'target' ? 'VWAP_TARGET_LEVEL' : 'STOP_LOSS',
          targetLevel: activeSetup.targetLevel,
          targetLevelValue: kind === 'target' ? rulesState.exitBracket.targetPrice : rulesState.exitBracket.stopPrice,
          viaFastCheck: false,
          exitDesc: kind === 'target'
            ? `Bracket TP em ${labelForLevel(activeSetup.targetLevel)} (ordem resting)`
            : `Bracket SL em ${labelForLevel(activeSetup.touchLevel)} (ordem resting)`,
        };
        await recordBracketFill({ rowId, strategy, log, state, session, exitResult, result: bracketResult });
        session.phase = 'WATCHING';
        session.rulesState = null;
        return { phase: 'WATCHING' };
      }

      await maybeReplaceBracket({
        rowId, adapter, config, cMap, session, log, activeSetup,
        exitBracket: rulesState.exitBracket, buyPrice, buyQty: parseFloat(state.buy_qty),
      });

      // Bracket ainda resting na corretora — a saída é responsabilidade exclusiva dela
      // (OCO real na Binance, price_orders na Gate.io). Não roda mais o evaluateExit por
      // candle fechado em paralelo enquanto ela existir: era esse "duplo caminho" (linha
      // E bracket, cada um podendo disparar a venda) que o usuário queria eliminar — agora
      // só a bracket vende quando restingBracket está ativo pro símbolo.
      return { phase };
    }

    // Sem bracket resting (restingBracket desligado pra esse símbolo, ou falhou ao colocar
    // — ver placeInitialBracket) — mantém o comportamento antigo: venda a mercado via
    // evaluateExit no candle fechado, com stop percentual/trailing quando configurado.
    let peakPrice = buyPrice;
    if (stopMode === 'percent') {
      const storedPeak = rulesState.stopPeakPrice != null ? parseFloat(rulesState.stopPeakPrice) : buyPrice;
      const lastCandle = (cMap[config.entry.interval] ?? []).at(-1);
      const lastHigh = lastCandle?.high != null ? parseFloat(lastCandle.high) : buyPrice;
      peakPrice = Math.max(storedPeak ?? buyPrice, lastHigh);
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
    }

    const exitResult = evaluateExit(config, cMap, buyPrice, {
      peakPrice, targetLevel: activeSetup.targetLevel, touchLevel: activeSetup.touchLevel,
    });
    if (!exitResult.exit) return { phase };

    // executeSell (compartilhado) assume que reason==='STOP_LOSS' é sempre % trailing —
    // no stop estrutural (ladder) queremos mostrar qual banda foi rompida, não um %.
    const reasonLabel = exitResult.reason === 'STOP_LOSS' && exitResult.stopLevel
      ? `Stop-loss em ${labelForLevel(exitResult.stopLevel)} (piso ${exitResult.stopFloor?.toFixed(6)})`
      : undefined;

    try {
      await executeSell({
        rowId, adapter, strategy, log, state, exitResult, session, reasonLabel,
        defaultReasonDesc: `VWAP ${labelForLevel(activeSetup.targetLevel)}`,
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
  const session = {
    volCache: null,
    phase: ['BOUGHT', 'PENDING'].includes(row.phase) ? row.phase : null,
    pendingSetup: rs.pendingSetup ?? null,
    rulesState: null,
    lastExitTime: rs.lastExitTime ?? null,
    lastPendingLogAt: 0,
    lastVwapSlopeNotifyOpenTime: null,
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

  let rows = await loadRows();
  rows = (rows ?? []).filter(r => isVwapBandsStrategy(r.strategy_id));
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

  if (!rows.length) {
    await new Promise(() => {});
    return;
  }

  await Promise.all(rows.map((row, i) => startSymbol(row, COLORS[i % COLORS.length])));
}

// Rodável standalone (`node backend/bot/vwap-bands/vwap-bands-bot.js`) ou embutido em
// outro processo bot (ver backend/bot/ma-cross/ma-cross-bot.js, que chama
// runVwapBandsBot() sem `await` — cada bot agenda os próprios ticks via setTimeout, então
// não bloqueia o chamador). require.main garante que só o processo iniciado diretamente
// dispara o auto-start.
if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { runVwapBandsBot: main };
