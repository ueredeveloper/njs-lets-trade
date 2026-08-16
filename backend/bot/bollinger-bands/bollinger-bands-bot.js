'use strict';

/**
 * Bollinger Bands Bot — o bot mais simples do painel:
 *   1. A mínima do candle toca a banda inferior BB(period,stdDev) do intervalo escolhido
 *      (pullback opcional: exige tocar `belowPct`% ainda mais abaixo dela) → compra (ordem
 *      limite no preço exato da banda/pullback).
 *   2. Coloca bracket TP/SL resting na corretora: alvo = banda superior ao vivo (ou % de
 *      lucro fixo manual, se exit.restingBracket.targetMode === 'fixed'), stop = piso
 *      percentual (stopLoss.maxLossPct) — recriada quando o alvo ou o stop desviarem
 *      driftPct% do preço em que foi colocada. Mesma mecânica do vwap-bands-bot.js.
 *
 * Sem fase PENDING/escada — só WATCHING → BOUGHT.
 *
 * strategy_id: bollinger-bands
 *
 * Uso:
 *   node backend/bot/bollinger-bands/bollinger-bands-bot.js
 *   node backend/bot/bollinger-bands/bollinger-bands-bot.js --symbol BTCUSDT
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const registry = require('../multitradeRegistry');
const { startMultitradeWatch, configFingerprint } = require('../multitradeWatch');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isBollingerBandsStrategy } = require('./strategyPresets');
const {
  getRequiredSpecs, evaluateEntrySignal, evaluateExit, computeBracketPrices, computeStopLossFloor,
  checkEntryLimitExpired, checkReentryCooldown, describeNearMiss,
} = require('./strategyEngine');
const { refreshMedianTrendThreshold } = require('../../utils/bollingerMedianTrendConfig');
const { detectOrphanPosition } = require('../shared/orphanPosition');

// Componentes genéricos (compra/venda/execução), compartilhados com os outros bots de
// trade — ver backend/bot/shared/*.
const { buildAdapter, syncExchangeClocks } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const { createTradeExecution } = require('../shared/tradeExecution');
const { sendWhatsApp } = require('../whatsapp');

const BOT_LABEL = 'BOLLINGER-BANDS';
const VOL_CACHE_MS = 5 * 60_000;

// ── Notificação de "sinal possível" (tocou a banda, mas barrado por um filtro) ─────────────
// Manda em lote de NEAR_MISS_BATCH_SIZE pra não inundar o WhatsApp — cada toque na banda que
// falhar no mesmo candle (mesmo signalOpenTime) só entra na fila uma vez.
const NEAR_MISS_BATCH_SIZE = 5;
const nearMissQueue = [];
const lastNearMissByKey = new Map(); // `${symbol}|${strategyId}` -> signalOpenTime já registrado

// Evita reenviar o alerta de saldo inesperado (ver detectOrphanPosition) a cada tick — uma
// vez por símbolo/estratégia já basta pro usuário ver e decidir.
const orphanWarnedKeys = new Set();

function fmtBRTDateTime(ms) {
  const d = Number.isFinite(ms) ? new Date(ms) : new Date();
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

function flushNearMissQueue() {
  const batch = nearMissQueue.splice(0, nearMissQueue.length);
  if (!batch.length) return;
  const blocks = batch.map((e, i) => (
    `${i + 1}) ${e.symbol} [${e.interval}] ${fmtBRTDateTime(e.time)}\n`
    + `   ✅ Passou: ${e.passed.length ? e.passed.join(', ') : '—'}\n`
    + `   ❌ Não passou: ${e.failed}`
  ));
  sendWhatsApp(`🟡 ${BOT_LABEL} — ${batch.length} sinais possíveis sem confirmação\n\n${blocks.join('\n\n')}`);
}

function recordNearMiss({ symbol, strategyId, interval, time, passed, failed }) {
  const key = `${symbol}|${strategyId}`;
  if (lastNearMissByKey.get(key) === time) return; // já registrado nesse mesmo candle
  lastNearMissByKey.set(key, time);
  nearMissQueue.push({ symbol, interval, time, passed, failed });
  if (nearMissQueue.length >= NEAR_MISS_BATCH_SIZE) flushNearMissQueue();
}

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

/** Só quem está favoritado e ativo em multitrade_favorites — sem isso, toda linha que já
 *  existiu em rsi_multi_bot_state (inclusive removida do painel há muito tempo) começava a
 *  rodar no boot, e só era encerrada minutos depois pelo ciclo periódico do
 *  startMultitradeWatch (mesmo fix aplicado em vwap-bands-bot.js). */
async function loadEnabledFavoriteKeys() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  const favorites = await sbReq('GET', 'multitrade_favorites', null, `?or=(${ids})&enabled=eq.true&select=symbol,strategy_id`);
  return new Set((favorites ?? []).map(f => registry.sessionKey(f.symbol, f.strategy_id)));
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  if (x < 0.01) return x.toFixed(6);
  if (x < 1) return x.toFixed(4);
  return x.toFixed(2);
}

/** Descreve a tendência da mediana da BB no momento da compra (mesmo filtro de
 *  entry.medianTrendFilter — ver checkMedianTrendFilter em strategyEngine.js). `avgDiffPct`
 *  é a variação % candle-a-candle da linha mediana, já normalizada pelo preço em
 *  checkMedianTrendFilter, pra ficar legível independente da escala do ativo. Retorna null se
 *  o filtro estiver desligado ou sem dados (ex.: sinal preenchido pelo fallback do reteste,
 *  sem entryMeta completo). */
function medianTrendDesc(trend) {
  if (!trend || trend.avgDiffPct == null) return null;
  const dir = trend.avgDiffPct >= 0 ? '📈 subindo/estável' : '📉 caindo';
  return `${dir} (${trend.avgDiffPct >= 0 ? '+' : ''}${trend.avgDiffPct.toFixed(3)}%/candle, lookback ${trend.lookback})`;
}

// Tom (verde/vermelha) e rótulo de cada estado da nuvem PERM — espelha STATE_META de
// frontend-react/src/utils/emaCrossPersistenceCloud.js, só que resumido pro log/WhatsApp.
const PERM_STATE_TONE = {
  fallAccel: 'vermelha', fallDecel: 'vermelha', turnDown: 'vermelha', riseDecel: 'vermelha',
  fallFlat: 'verde', turnUp: 'verde', riseAccel: 'verde', riseFlat: 'verde',
};
const PERM_STATE_LABEL = {
  fallAccel: 'queda forte', fallDecel: 'queda perdendo força', turnDown: 'EMA9 virando pra baixo',
  riseDecel: 'alta perdendo força', fallFlat: 'quase estabilizando', turnUp: 'EMA9 virando pra cima',
  riseAccel: 'alta forte', riseFlat: 'alta quase no topo',
};

/** Estado de UM intervalo da cascata PERM em texto — "neutra (sem dado)" quando a nuvem
 *  estava vazia nesse intervalo (cascata caiu pro próximo), senão "verde (alta forte)" etc. */
function permStateDesc(state) {
  if (state == null) return 'neutra (sem dado)';
  const tone = PERM_STATE_TONE[state] ?? state;
  const label = PERM_STATE_LABEL[state];
  return label ? `${tone} (${label})` : tone;
}

/** Descreve a cascata inteira da nuvem PERM checada na compra (1h → 30m → 15m, por exemplo):
 *  um trecho por intervalo visitado, na ordem, até o que decidiu — ver checked em
 *  checkPermFilter (strategyEngine.js). null se o filtro estiver desligado ou sem contexto
 *  (ex.: sinal preenchido pelo fallback do reteste, sem entryMeta completo). */
function permDesc(perm) {
  if (!perm) return null;
  if (Array.isArray(perm.checked) && perm.checked.length) {
    return perm.checked.map(c => `${c.interval} ${permStateDesc(c.state)}`).join(', ');
  }
  if (!perm.state) return null;
  const sign = perm.slopePct != null && perm.slopePct >= 0 ? '+' : '';
  const slope = perm.slopePct != null ? ` (${sign}${Number(perm.slopePct).toFixed(2)}%)` : '';
  return `🟢 verde em ${perm.interval}${slope}`;
}

function buildEntryReasonLines(config, entryMeta) {
  const lines = [`${entryMeta.entryDesc} @ ${fmtPrice(entryMeta.close)}`];
  if (config.entry?.medianTrendFilter?.enabled) {
    const desc = medianTrendDesc(entryMeta.medianTrend);
    if (desc) lines.push(`Tendência mediana BB: ${desc}`);
  }
  if (config.entry?.permFilter?.enabled) {
    const desc = permDesc(entryMeta.perm);
    if (desc) lines.push(`Nuvem PERM: ${desc}`);
  }
  return lines;
}

/** Espelha no log/WhatsApp de VENDA a tendência da mediana que estava vigente na COMPRA
 *  (snapshot gravado em rules_state.entryMedianTrend por extraInitialRulesState abaixo) —
 *  contexto de "a tendência que liberou essa entrada era essa" na hora de revisar o trade. */
function buildExitReasonLines(config, state) {
  if (!config.entry?.medianTrendFilter?.enabled) return [];
  const trend = parseRulesState(state).entryMedianTrend;
  const desc = medianTrendDesc(trend);
  return desc ? [`Tendência mediana BB na compra: ${desc}`] : [];
}

// executeBuy/executeSell/saveState/hasOpenPosition/resetOrphanPosition/parseRulesState são
// genéricos — ver backend/bot/shared/tradeExecution.js.
const {
  saveState, hasOpenPosition, resetOrphanPosition,
  parseRulesState, executeBuy, executeSell, recordBracketFill, recordBuyFill,
  resolveLastExitTime, resolveLastExitReason,
} = createTradeExecution({
  botLabel: BOT_LABEL,
  buildReasonLines: buildEntryReasonLines,
  buildExitReasonLines,
  computeStopLossFloor,
  // Alvo e stop continuam recalculados ao vivo a cada tick (computeBracketPrices) — não há
  // "degrau" pra lembrar entre ticks como no vwap-bands. Só o snapshot da tendência mediana
  // na compra precisa sobreviver até a venda, pra aparecer na mensagem de VENDA.
  extraInitialRulesState: ({ config, entryMeta }) => {
    if (!config.entry?.medianTrendFilter?.enabled || entryMeta?.medianTrend?.avgDiffPct == null) return null;
    return {
      entryMedianTrend: {
        avgDiffPct: entryMeta.medianTrend.avgDiffPct,
        lookback: entryMeta.medianTrend.lookback,
      },
    };
  },
});

/** Rótulo do alvo (TP) da bracket pra logs/WhatsApp — 'banda superior' (padrão) ou
 *  '% manual' quando exit.restingBracket.targetMode === 'fixed'. */
function targetLabel(config) {
  const rb = config.exit?.restingBracket;
  return rb?.targetMode === 'fixed' ? `manual +${rb.targetPct}%` : 'banda superior';
}

/** Mensagem explicando que a Binance rejeitaria o alvo/stop calculado pela estratégia (longe
 *  demais do preço atual, filtro PERCENT_PRICE_BY_SIDE) e por isso o bot prendeu (clamp) o
 *  valor na borda permitida pra OCO ainda assim ser aceita — ver binancePlaceOcoSell. */
function describeClamp(bracket) {
  const parts = [];
  if (bracket.clamped?.stop) {
    parts.push(`stop ${fmtPrice(bracket.requestedStopPrice)} → ${fmtPrice(bracket.stopPrice)} (fora da distância máxima permitida pela Binance)`);
  }
  if (bracket.clamped?.target) {
    parts.push(`alvo ${fmtPrice(bracket.requestedTargetPrice)} → ${fmtPrice(bracket.targetPrice)} (fora da distância máxima permitida pela Binance)`);
  }
  return `Bracket colocada com ajuste: ${parts.join('; ')}`;
}

// Falha ao colocar a bracket não manda WhatsApp a cada tentativa (spam) — só na 1ª falha e
// depois a cada N tentativas, enquanto o retry automático (ver bloco BOUGHT) continua tentando.
const BRACKET_RETRY_ALERT_EVERY = 10;

/** Grava a falha em rules_state.exitBracketError (attempts/firstAt/lastAt) — antes só ia pro
 *  WhatsApp e se perdia, sem dar pra consultar depois qual foi o motivo real da rejeição. */
async function recordBracketError({ rowId, session, log, symbol, strategyId, message, retry }) {
  const prev = session.rulesState?.exitBracketError ?? null;
  const attempt = (prev?.attempts ?? 0) + 1;
  const exitBracketError = {
    message, attempts: attempt,
    firstAt: prev?.firstAt ?? new Date().toISOString(),
    lastAt: new Date().toISOString(),
  };
  session.rulesState = { ...(session.rulesState ?? {}), exitBracket: null, exitBracketError };
  await saveState(rowId, { rules_state: session.rulesState }, log);
  log(`${Y}⚠️  Falha ao colocar bracket TP/SL (${message}) — tentativa ${attempt}${retry ? ', retry automático segue tentando' : ''}${X}`);
  if (attempt === 1 || attempt % BRACKET_RETRY_ALERT_EVERY === 0) {
    sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nFalha ao colocar bracket TP/SL na corretora (tentativa ${attempt}): ${message}\nPosição sem proteção na corretora — bot segue tentando automaticamente a cada tick; saída também depende do candle fechado (evaluateExit) enquanto isso.`);
  }
}

/**
 * Coloca a bracket TP/SL resting na corretora logo após a compra confirmar (só se
 * `exit.restingBracket.enabled`). Se falhar, grava o erro em rules_state.exitBracketError em
 * vez de desistir — o bloco BOUGHT do tick chama de novo com `retry: true` a cada ciclo
 * enquanto exitBracket continuar null (ver linha ~546). Enquanto isso, a saída continua
 * funcionando via evaluateExit no candle (venda a mercado).
 */
async function placeInitialBracket({ rowId, adapter, config, cMap, session, log, filledQty, buyPrice, symbol, strategyId, retry = false }) {
  if (!config.exit.restingBracket?.enabled) return;
  const { targetPrice, stopPrice } = computeBracketPrices(config, cMap, buyPrice, buyPrice);
  if (targetPrice == null || stopPrice == null) {
    await recordBracketError({
      rowId, session, log, symbol, strategyId, retry,
      message: `alvo (${targetLabel(config)}) indisponível ainda`,
    });
    return;
  }
  const prevError = session.rulesState?.exitBracketError ?? null;
  try {
    const bracket = await adapter.placeExitBracket(filledQty, targetPrice, stopPrice);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, placedAt: new Date().toISOString() }, exitBracketError: null };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    log(`${G}🎯 Bracket TP/SL colocada na corretora${retry ? ' (retry)' : ''} — alvo (${targetLabel(config)}) ${fmtPrice(bracket.targetPrice)} / stop ${fmtPrice(bracket.stopPrice)}${X}`);
    if (bracket.clamped) {
      const clampMsg = describeClamp(bracket);
      log(`${Y}⚠️  ${clampMsg}${X}`);
      sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\n${clampMsg}`);
    }
    if (retry && prevError) {
      sendWhatsApp(`✅ ${BOT_LABEL} [${strategyId}] ${symbol}\nBracket TP/SL colocada na corretora após ${prevError.attempts} tentativa(s) falha(s) (primeira falha ${prevError.firstAt}).`);
    }
  } catch (err) {
    await recordBracketError({ rowId, session, log, symbol, strategyId, retry, message: err.message });
  }
}

/** true/false se há ordem de venda aberta na corretora pro símbolo; `true` também quando a
 *  consulta falha (não dá pra confirmar que está livre) — mais seguro tratar como "pode ter
 *  ordem" e não mexer do que agir sobre um estado incerto. Usado pelo rulesState.externalOrders
 *  (posição com ordem colocada fora do painel, ver reconciliação de órfã acima). */
async function hasOpenSellOrder(adapter, log) {
  if (typeof adapter.getOpenOrders !== 'function') return true;
  try {
    const orders = await adapter.getOpenOrders();
    return Array.isArray(orders) && orders.some(o => String(o.side ?? '').toLowerCase() === 'sell');
  } catch (err) {
    log(`${Y}⚠️  Erro ao consultar ordens abertas (externalOrders): ${err.message}${X}`);
    return true;
  }
}

/** Reconstrói qty/preço médio de saída pelos trades de venda recentes desde a compra — mesma
 *  ideia de reconstructOpenLotFifo (orphanPosition.js), só que pro lado da venda. Usado quando
 *  uma ordem externa (fora do painel) fecha a posição, pra registrar o PnL real em vez de
 *  estimar pelo preço do candle. */
async function reconstructExternalExit(adapter, state) {
  if (typeof adapter.getOwnTrades !== 'function') return null;
  const trades = await adapter.getOwnTrades(50);
  const buyTimeMs = new Date(state.buy_time).getTime();
  const sells = trades.filter(t => t.side === 'sell' && t.time >= buyTimeMs);
  const qty = sells.reduce((s, t) => s + t.qty, 0);
  if (!(qty > 0)) return null;
  const usdtOut = sells.reduce((s, t) => s + t.qty * t.price, 0);
  return { soldQty: qty, usdtOut, exitPrice: usdtOut / qty };
}

/** Recalcula alvo/stop vigentes e recria a bracket se algum desviou ≥driftPct% do preço em
 *  que foi colocada (a banda superior se move a cada candle novo). */
async function maybeReplaceBracket({ rowId, adapter, config, cMap, session, log, exitBracket, buyPrice, buyQty, peakPrice }) {
  // Bracket colocada manualmente pelo botão de vender (OCO com TP/SL escolhidos pelo usuário)
  // — não mexe até preencher ou o usuário trocar de novo, senão o valor manual seria
  // substituído de volta pro cálculo automático da estratégia no próximo tick.
  if (exitBracket.manual) return;
  const driftPct = config.exit.restingBracket?.driftPct ?? 3;
  const { targetPrice: liveTarget, stopPrice: liveStop } = computeBracketPrices(config, cMap, buyPrice, peakPrice);
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
    log(`🔁 Bracket TP/SL recriada (deriva ≥${driftPct}%) — alvo (${targetLabel(config)}) ${fmtPrice(bracket.targetPrice)} / stop ${fmtPrice(bracket.stopPrice)}`);
    if (bracket.clamped) log(`${Y}⚠️  ${describeClamp(bracket)}${X}`);
  } catch (err) {
    if (cancelled) {
      // A bracket antiga já foi cancelada na corretora antes da nova falhar — limpa
      // exitBracket pra o próximo tick cair no fallback de saída via candle (evaluateExit).
      session.rulesState = { ...(session.rulesState ?? {}), exitBracket: null };
      await saveState(rowId, { rules_state: session.rulesState }, log);
      log(`${Y}⚠️  Falha ao recriar bracket TP/SL (${err.message}) — bracket antiga já cancelada, voltando pra saída via candle${X}`);
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

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase !== 'BOUGHT') {
    const orphanKey = `${symbol}|${strategyId}`;
    const liveCandles = cMap[config.entry.interval] ?? [];
    const lastPrice = liveCandles.length ? parseFloat(liveCandles[liveCandles.length - 1].close) : null;
    const orphan = await detectOrphanPosition({ adapter, lastPrice }).catch(() => null);
    if (orphan?.confident) {
      log(`${Y}⚠️  Posição órfã na corretora (${orphan.qty} ${symbol}, sem registro no Supabase) — reconciliando pela compra que os trades recentes confirmam...${X}`);
      const entryMeta = {
        entryDesc: 'posição órfã reconciliada (saldo na corretora sem registro no Supabase)',
        close: orphan.avgPrice, signalPrice: orphan.avgPrice, signalOpenTime: null, limitPrice: null,
      };
      const bought = await recordBuyFill({
        rowId, strategy, log, session, entryMeta, capital, strategyId, symbol,
        result: { filledQty: orphan.qty, quoteQty: orphan.qty * orphan.avgPrice, avgPrice: orphan.avgPrice },
      });
      if (bought && orphan.hasOpenOrders) {
        // Já existe ordem de venda aberta na corretora (colocada fora do painel) — não coloca
        // bracket em cima dela. Só adota a posição (pra não tentar comprar de novo) e marca
        // externalOrders: o bloco BOUGHT do tick (linha ~530) para de mexer em bracket/venda
        // e só observa o saldo até a ordem do usuário fechar sozinha.
        session.rulesState = { ...(session.rulesState ?? {}), externalOrders: true };
        await saveState(rowId, { rules_state: session.rulesState }, log);
        log(`${Y}⚠️  Ordem de venda já aberta na corretora pra ${symbol} — bot NÃO vai colocar bracket nem vender, só observando o saldo${X}`);
        sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nPosição órfã reconciliada, mas já existe ordem de venda aberta na corretora (fora do painel). Bot NÃO vai colocar bracket nem vender por conta própria — só observa o saldo até você fechar manualmente.`);
      } else if (bought) {
        await placeInitialBracket({
          rowId, adapter, config, cMap, session, log,
          filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
        });
        sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nPosição órfã detectada e reconciliada automaticamente (processo provavelmente caiu entre a compra e o registro). Preço médio ${fmtPrice(orphan.avgPrice)}, qty ${orphan.qty}.`);
      }
      return { phase: bought ? 'BOUGHT' : 'WATCHING' };
    }
    if (orphan && !orphan.confident && !orphanWarnedKeys.has(orphanKey)) {
      orphanWarnedKeys.add(orphanKey);
      log(`${Y}⚠️  Saldo inesperado na corretora (${orphan.qty} ${symbol}) sem trade recente confirmando a origem — NÃO reconciliado automaticamente, confira manualmente${X}`);
      sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nSaldo inesperado na corretora (${orphan.qty}) sem trade recente (24h) confirmando a origem — não reconciliei sozinho pra não adotar uma posição que pode não ser do bot. Confira manualmente.`);
    }

    const lastExitTime = resolveLastExitTime(state, session);
    const lastExitReason = resolveLastExitReason(state, session);
    const cooldown = checkReentryCooldown(config, cMap, lastExitTime, lastExitReason);
    if (cooldown.waiting) {
      // Só após STOP_LOSS: espera N candles fechados do intervalo da BB antes de
      // reavaliar compra (evita reentrar no mesmo dump, como BMT #347→#348).
      return { phase: 'WATCHING', reentryCooldown: cooldown };
    }

    const rulesWatch = { ...parseRulesState(state), ...(session.rulesState ?? {}) };

    // Ordem limite GTC já armada no toque da BB: espera fill (reteste) ou expira após
    // limitWaitCandles — não cancela em 20s como o limitBuy bloqueante antigo.
    if (rulesWatch.entryLimit && typeof adapter.pollRestingLimitBuy === 'function') {
      let poll;
      try {
        poll = await adapter.pollRestingLimitBuy(rulesWatch.entryLimit);
      } catch (err) {
        log(`${Y}⚠️  Erro ao consultar ordem limite de entrada: ${err.message}${X}`);
        return { phase: 'WATCHING' };
      }

      if (poll.filled) {
        log(`${G}✅ Limite @ ${fmtPrice(rulesWatch.entryLimit.price)} preenchida (reteste)${X}`);
        const bought = await recordBuyFill({
          rowId, strategy, log, session,
          entryMeta: rulesWatch.entryLimit.entryMeta ?? {
            entryDesc: rulesWatch.entryLimit.entryDesc,
            close: poll.avgPrice,
            limitPrice: rulesWatch.entryLimit.price,
            signalOpenTime: rulesWatch.entryLimit.signalOpenTime,
            signalPrice: rulesWatch.entryLimit.signalPrice,
          },
          capital, strategyId, symbol,
          result: {
            filledQty: poll.filledQty,
            quoteQty: poll.quoteQty,
            avgPrice: poll.avgPrice,
          },
        });
        if (bought) {
          await placeInitialBracket({
            rowId, adapter, config, cMap, session, log,
            filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
          });
        }
        return { phase: bought ? 'BOUGHT' : 'WATCHING' };
      }

      // Mediana da BB só é checada no momento do sinal (evaluateEntrySignal) — enquanto a
      // ordem limite espera reteste, não recheca: com pullback ligado o preço cair mais é
      // esperado (é o próprio gatilho), então rechecar tendência aqui cancelaria entradas
      // que a estratégia queria justamente esperar.
      const expiry = checkEntryLimitExpired(config, cMap, rulesWatch.entryLimit);
      if (expiry.expired || poll.open === false) {
        try {
          if (poll.open !== false) await adapter.cancelRestingLimitBuy(rulesWatch.entryLimit);
        } catch (err) {
          log(`${Y}⚠️  Falha ao cancelar limite expirada: ${err.message}${X}`);
        }
        const kept = {};
        if (rulesWatch.lastExitTime) kept.lastExitTime = rulesWatch.lastExitTime;
        if (rulesWatch.lastExitReason) kept.lastExitReason = rulesWatch.lastExitReason;
        session.rulesState = Object.keys(kept).length ? kept : null;
        await saveState(rowId, { rules_state: session.rulesState ?? {} }, log);
        const cancelReason = expiry.expired
          ? `${expiry.need} candles ${expiry.interval} sem fill` : `status ${poll.status}`;
        log(`${Y}⏳ Limite @ ${fmtPrice(rulesWatch.entryLimit.price)} cancelada (${cancelReason})${X}`);
        return { phase: 'WATCHING' };
      }

      return { phase: 'WATCHING', entryLimit: { waiting: true, ...expiry } };
    }

    const signal = evaluateEntrySignal(config, cMap);
    if (!signal.allowed) {
      const nearMiss = describeNearMiss(signal.reason);
      if (nearMiss) {
        recordNearMiss({
          symbol, strategyId, interval: config.entry.interval, time: signal.signalOpenTime,
          passed: nearMiss.passed, failed: nearMiss.failed,
        });
      }
      return { phase: 'WATCHING' };
    }

    // instantFill: ignora reteste — compra a mercado assim que o sinal confirma (evita
    // perder o movimento quando o preço toca a banda e não volta mais até lá).
    if (config.entry.instantFill) {
      log(`${G}📍 Sinal (${signal.entryDesc}) — comprando ${parseFloat(capital).toFixed(2)} USDT a mercado (instantFill)${X}`);
      const bought = await executeBuy({
        rowId, adapter, strategy, log, session,
        entryMeta: { ...signal, signalPrice: signal.close, limitPrice: null },
        capital, strategyId, symbol,
      });
      if (bought) {
        await placeInitialBracket({
          rowId, adapter, config, cMap, session, log,
          filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
        });
      }
      return { phase: bought ? 'BOUGHT' : 'WATCHING' };
    }

    // Prefere resting GTC (fica no book até reteste / N candles). Fallback: executeBuy antigo.
    if (typeof adapter.placeRestingLimitBuy === 'function' && signal.limitPrice != null) {
      try {
        const handle = await adapter.placeRestingLimitBuy(parseFloat(capital), signal.limitPrice);
        const waitN = config.entry.limitWaitCandles ?? 5;
        const entryLimit = {
          ...handle,
          price: handle.price ?? signal.limitPrice,
          placedAt: new Date().toISOString(),
          signalOpenTime: signal.signalOpenTime,
          signalPrice: signal.close,
          entryDesc: signal.entryDesc,
          entryMeta: { ...signal, signalPrice: signal.close },
        };
        const nextRules = {};
        if (rulesWatch.lastExitTime) nextRules.lastExitTime = rulesWatch.lastExitTime;
        if (rulesWatch.lastExitReason) nextRules.lastExitReason = rulesWatch.lastExitReason;
        nextRules.entryLimit = entryLimit;
        session.rulesState = nextRules;
        await saveState(rowId, { rules_state: nextRules }, log);
        log(`${G}📍 Sinal (${signal.entryDesc}) — limite GTC @ ${fmtPrice(entryLimit.price)} `
          + `armada (espera até ${waitN} candles ${config.entry.interval} p/ reteste)${X}`);

        // Fill imediato (preço já no/abaixo da banda no instante do envio)
        const instant = await adapter.pollRestingLimitBuy(entryLimit);
        if (instant.filled) {
          log(`${G}✅ Limite preenchida na hora${X}`);
          const bought = await recordBuyFill({
            rowId, strategy, log, session,
            entryMeta: entryLimit.entryMeta,
            capital, strategyId, symbol,
            result: {
              filledQty: instant.filledQty,
              quoteQty: instant.quoteQty,
              avgPrice: instant.avgPrice,
            },
          });
          if (bought) {
            await placeInitialBracket({
              rowId, adapter, config, cMap, session, log,
              filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
            });
          }
          return { phase: bought ? 'BOUGHT' : 'WATCHING' };
        }
        return { phase: 'WATCHING', entryLimit: { armed: true } };
      } catch (err) {
        log(`${Y}⚠️  Falha ao armar limite GTC (${err.message}) — tenta compra bloqueante${X}`);
      }
    }

    log(`${G}📍 Sinal (${signal.entryDesc}) — comprando ${parseFloat(capital).toFixed(2)} USDT a ${fmtPrice(signal.limitPrice)} (ordem limite)${X}`);
    const bought = await executeBuy({
      rowId, adapter, strategy, log, session,
      entryMeta: { ...signal, signalPrice: signal.close },
      capital, strategyId, symbol,
    });
    if (bought) {
      await placeInitialBracket({
        rowId, adapter, config, cMap, session, log,
        filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
      });
    }
    return { phase: bought ? 'BOUGHT' : 'WATCHING' };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  const rulesState = { ...parseRulesState(state), ...(session.rulesState ?? {}) };

  // Posição com ordem de venda colocada fora do painel (ver reconciliação de órfã acima) —
  // bot só observa, nunca coloca bracket nem vende a mercado por conta própria. Sai desse
  // bloco assim que a ordem sumir do book (preenchida ou cancelada pelo usuário).
  if (rulesState.externalOrders) {
    const stillOpen = await hasOpenSellOrder(adapter, log);
    if (stillOpen) return { phase: 'BOUGHT' };

    const lastPriceExt = parseFloat((cMap[config.entry.interval] ?? []).at(-1)?.close ?? buyPrice);
    const balance = typeof adapter.getBaseBalance === 'function' ? await adapter.getBaseBalance().catch(() => null) : null;
    if (balance != null && lastPriceExt > 0 && balance * lastPriceExt >= 3) {
      // Ordem sumiu mas o saldo continua lá — foi cancelada, não preenchida. Segue observando.
      return { phase: 'BOUGHT' };
    }

    const exitEst = (await reconstructExternalExit(adapter, state).catch(() => null))
      ?? { soldQty: parseFloat(state.buy_qty), usdtOut: parseFloat(state.buy_qty) * lastPriceExt, exitPrice: lastPriceExt };
    log(`${Y}⚠️  Ordem externa em ${symbol} sumiu do book e o saldo zerou — encerrando registro (venda feita fora do bot)${X}`);
    await recordBracketFill({
      rowId, strategy, log, state, session,
      exitResult: { reason: 'EXTERNAL_ORDER', exitDesc: 'Ordem de venda aberta direto na corretora (fora do painel)' },
      result: exitEst,
    });
    session.phase = 'WATCHING';
    session.rulesState = null;
    return { phase: 'WATCHING' };
  }

  // Trailing do stop percentual: acompanha o pico de preço desde a compra (usado tanto pra
  // recalcular o stop da bracket quanto pro fallback via candle).
  const storedPeak = rulesState.stopPeakPrice != null ? parseFloat(rulesState.stopPeakPrice) : buyPrice;
  const lastCandle = (cMap[config.entry.interval] ?? []).at(-1);
  const lastHigh = lastCandle?.high != null ? parseFloat(lastCandle.high) : buyPrice;
  const peakPrice = Math.max(storedPeak ?? buyPrice, lastHigh);
  if (peakPrice > (storedPeak ?? buyPrice) + 1e-12) {
    session.rulesState = { ...rulesState, stopPeakPrice: peakPrice };
    await saveState(rowId, { rules_state: session.rulesState }, log);
  }

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
        reason: kind === 'target' ? 'BB_UPPER_TARGET' : 'STOP_LOSS',
        targetLevelValue: kind === 'target' ? rulesState.exitBracket.targetPrice : rulesState.exitBracket.stopPrice,
        exitDesc: kind === 'target'
          ? 'Bracket TP na banda superior (ordem resting)'
          : 'Bracket SL no piso percentual (ordem resting)',
      };
      await recordBracketFill({ rowId, strategy, log, state, session, exitResult, result: bracketResult });
      session.phase = 'WATCHING';
      session.rulesState = null;
      return { phase: 'WATCHING' };
    }

    await maybeReplaceBracket({
      rowId, adapter, config, cMap, session, log,
      exitBracket: rulesState.exitBracket, buyPrice, buyQty: parseFloat(state.buy_qty), peakPrice,
    });

    // Bracket ainda resting na corretora — a saída é responsabilidade exclusiva dela.
    return { phase: 'BOUGHT' };
  }

  // Sem bracket resting — desligada pra esse símbolo, ou falhou ao colocar (nesse caso
  // tenta de novo aqui, a cada tick, até conseguir; ver placeInitialBracket/recordBracketError).
  // Em qualquer um dos casos, a saída cai no fallback via evaluateExit no candle em formação
  // (alvo = banda superior, stop = piso %) enquanto não houver bracket na corretora.
  if (config.exit.restingBracket?.enabled) {
    await placeInitialBracket({
      rowId, adapter, config, cMap, session, log, symbol, strategyId, buyPrice,
      filledQty: parseFloat(state.buy_qty), retry: true,
    });
  }

  const exitResult = evaluateExit(config, cMap, buyPrice, { peakPrice });
  if (!exitResult.exit) return { phase: 'BOUGHT' };

  try {
    await executeSell({
      rowId, adapter, strategy, log, state, exitResult, session,
      defaultReasonDesc: 'BB banda superior',
    });
    session.phase = 'WATCHING';
    session.rulesState = null;
  } catch {
    return { phase: 'BOUGHT' };
  }
  return { phase: 'WATCHING' };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color, startupIndex = null) {
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
    phase: row.phase === 'BOUGHT' ? 'BOUGHT' : null,
    rulesState: null,
    lastExitTime: rs.lastExitTime ?? null,
    lastExitReason: rs.lastExitReason ?? null,
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
    if (!next) {
      log(`${Y}⚠️  trade_config inválido após sync — mantendo config anterior${X}`);
      return;
    }
    ctx.strategy = next;
    log(`🔄 ${row.symbol} — config atualizada do painel (BB ${next.config.entry.interval} ${next.config.entry.period}/${next.config.entry.stdDev})`);
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

  if (startupIndex !== null) {
    // Espalha a primeira leitura de estado de cada símbolo no boot — sem isso, o
    // Promise.all abaixo dispara todos os GET em rsi_multi_bot_state em rajada simultânea.
    await new Promise(resolve => setTimeout(resolve, startupIndex * 400 + Math.floor(Math.random() * 300)));
    if (ctx.stopped) return;
  }
  await run();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  // Marca de versão do código carregado neste processo — confirma no boot que o filtro
  // de tendência mediana (checkMedianTrendFilter, strategyEngine.js) está no ar, sem
  // precisar reconstruir candles manualmente pra descobrir se o bot pegou o código novo.
  console.log('🚀 bollinger-bands-bot iniciado — filtro de tendência mediana da BB (medianTrendFilter) ativo');

  // Gate.io sincroniza o próprio relógio sozinha ao carregar o módulo (ver
  // backend/gate/getGateClient.js) — só a Binance precisa ser sincronizada aqui.
  await syncExchangeClocks();
  setInterval(syncExchangeClocks, 60 * 60_000);

  await refreshMedianTrendThreshold();
  setInterval(refreshMedianTrendThreshold, VOL_CACHE_MS);

  const symbolFilter = process.argv.includes('--symbol')
    ? process.argv[process.argv.indexOf('--symbol') + 1]?.toUpperCase()
    : null;

  let rows = await loadRows();
  rows = (rows ?? []).filter(r => isBollingerBandsStrategy(r.strategy_id));
  if (symbolFilter) {
    // --symbol força uma moeda específica pra teste manual, mesmo que não esteja favoritada.
    rows = rows.filter(r => r.symbol.toUpperCase() === symbolFilter);
  } else {
    const enabledKeys = await loadEnabledFavoriteKeys();
    rows = rows.filter(r => enabledKeys.has(registry.sessionKey(r.symbol, r.strategy_id)));
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

  await Promise.all(rows.map((row, i) => startSymbol(row, COLORS[i % COLORS.length], i)));
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { runBollingerBandsBot: main };
