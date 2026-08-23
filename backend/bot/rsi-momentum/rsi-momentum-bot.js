'use strict';

/**
 * RSI Momentum Bot — DIFERENTE dos outros bots (bollinger-bands, ma-cross): o usuário não
 * favorita moeda nenhuma de antemão. Um scanner varre o mercado inteiro (ver marketScanner.js)
 * e, quando uma moeda dispara o sinal, o PRÓPRIO bot cria o favorito automaticamente e passa a
 * gerenciar aquela moeda. Quando o ciclo termina (comprou e vendeu, ou o pullback nunca
 * preencheu), o favorito é removido — a lista de favoritos rsi-momentum é sempre "moedas com
 * sinal ativo agora" (pending/comprada/falha), nunca uma lista curada manualmente.
 *
 *   1. RSI(14) do entry.interval (ex.: 15m) cruza para CIMA de entry.rsiThreshold (ex.: 70,
 *      sobrecompra — aposta de CONTINUAÇÃO, não reversão) → sinal. Pullback opcional (ordem
 *      limite `belowPct`% abaixo do preço do sinal) é avaliado minuto a minuto, não no
 *      candle do entry.interval — ver PULLBACK_INTERVAL em strategyEngine.js.
 *   2. Coloca bracket TP/SL resting na corretora logo após a compra confirmar (Binance: OCO
 *      real; Gate.io: emulado) — alvo e stop FIXOS a partir do preço de entrada, sem
 *      trailing/deriva (diferente do bollinger-bands: aqui não há banda/EMA pra perseguir, o
 *      nível nunca muda depois de colocado).
 *
 * Fases persistidas em rsi_multi_bot_state.phase: WATCHING (transitório, só entre a criação da
 * linha e a primeira tentativa de entrada) → PENDING (ordem limite de pullback armada na
 * corretora, aguardando reteste) → BOUGHT (posição aberta) → some da lista quando fecha.
 * FAILED = tentativa de compra/ordem rejeitada pela corretora (ex.: saldo insuficiente) — fica
 * visível na lista com o motivo até ser removida manualmente (não tenta de novo sozinho, pra
 * não martelar a corretora repetindo o mesmo erro a cada ciclo).
 *
 * Mesmo esqueleto/infra do bollinger-bands-bot.js (compra/venda/OCO/persistência/reconciliação
 * de órfã — ver backend/bot/shared/*), sem os filtros específicos de banda
 * (medianTrendFilter/emaFilter/permFilter) nem a recriação de bracket por deriva.
 *
 * strategy_id: rsi-momentum
 *
 * Uso:
 *   node backend/bot/rsi-momentum/rsi-momentum-bot.js
 *   node backend/bot/rsi-momentum/rsi-momentum-bot.js --symbol BTCUSDT   (só gerencia essa
 *     moeda se ela já tiver uma linha pending/comprada — não restringe o scanner)
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const registry = require('../multitradeRegistry');
const { startMultitradeWatch, configFingerprint } = require('../multitradeWatch');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, getStrategyPresetBody } = require('./strategyPresets');
const { startMarketScanner } = require('./marketScanner');
const {
  getRequiredSpecs, evaluateEntrySignal, evaluateExit, computeBracketPrices,
  checkEntryLimitExpired,
} = require('./strategyEngine');
const { detectOrphanPosition } = require('../shared/orphanPosition');

// Componentes genéricos (compra/venda/execução/OCO), compartilhados com os outros bots de
// trade (bollinger-bands, ma-cross, vwap-bands) — ver backend/bot/shared/*.
const { buildAdapter, syncExchangeClocks } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const { createTradeExecution } = require('../shared/tradeExecution');
const { sendWhatsApp } = require('../whatsapp');

const BOT_LABEL = 'RSI-MOMENTUM';
const VOL_CACHE_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 60_000;
// Sem form por moeda ainda (favorito é criado pelo próprio bot) — capital fixo por trade até
// existir uma tela de configuração global no painel.
const DEFAULT_CAPITAL_USDT = 40;
const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';

const orphanWarnedKeys = new Set();

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', X = '\x1b[0m';
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

/** Linhas resumíveis no boot: pending (ordem armada) ou comprada — nunca FAILED (sem ordem
 *  ativa, não há nada a retomar) nem WATCHING (transitório, não deveria sobreviver a um
 *  restart; se sobreviver por algum erro raro, cai no bloco WATCHING do tick e se resolve
 *  sozinho no próximo ciclo). */
async function loadResumableRows() {
  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?strategy_id=eq.rsi-momentum&phase=in.(PENDING,BOUGHT)&order=id.asc`);
  return rows ?? [];
}

/** Símbolos que já têm QUALQUER linha rsi-momentum (pending/comprada/falha) — usado pelo
 *  scanner de mercado pra não reavaliar/re-sinalizar quem já está sendo rastreado. */
async function loadTrackedSymbols() {
  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?strategy_id=eq.rsi-momentum&select=symbol`);
  return (rows ?? []).map(r => r.symbol);
}

/**
 * Cria o favorito + a linha de estado assim que o scanner de mercado encontra um sinal novo
 * (ver marketScanner.js). A partir daqui a moeda segue o ciclo normal do tick() — o próprio
 * bot decide, no primeiro tick, se compra a mercado, arma pullback ou falha.
 */
async function createAutoFavorite(symbol) {
  const presetBody = getStrategyPresetBody('rsi-momentum');
  await sbReq('POST', 'multitrade_favorites', {
    user_id: DEFAULT_USER_ID, symbol, exchange: 'binance', strategy_id: 'rsi-momentum',
    enabled: true, capital: DEFAULT_CAPITAL_USDT, trade_config: presetBody,
  });
  const [row] = await sbReq('POST', 'rsi_multi_bot_state', {
    symbol, exchange: 'binance', strategy_id: 'rsi-momentum',
    initial_capital: DEFAULT_CAPITAL_USDT, capital: DEFAULT_CAPITAL_USDT,
    trade_config: presetBody, phase: 'WATCHING',
  });
  return row;
}

/** Remove o favorito automático (multitrade_favorites + rsi_multi_bot_state) e encerra a
 *  sessão — chamado quando o ciclo termina sem posição aberta: trade fechado (alvo/stop),
 *  pullback expirou sem preencher, ou o sinal não se confirmou mais no primeiro tick. A moeda
 *  volta pro "pool" — o scanner pode sinalizá-la de novo no futuro, do zero. */
async function retireAutoFavorite({ rowId, symbol, log, stopSelf, reason }) {
  if (reason) log(`🗑️  ${symbol} removido do favorito automático (${reason})`);
  try {
    await sbReq('DELETE', 'rsi_multi_bot_state', null, `?id=eq.${rowId}`);
  } catch (err) {
    log(`${Y}⚠️  Falha ao remover estado do favorito automático: ${err.message}${X}`);
  }
  try {
    await sbReq('DELETE', 'multitrade_favorites', null, `?symbol=eq.${symbol}&strategy_id=eq.rsi-momentum`);
  } catch (err) {
    log(`${Y}⚠️  Falha ao remover favorito automático: ${err.message}${X}`);
  }
  if (stopSelf) await stopSelf();
  return { phase: 'RETIRED' };
}

/** Marca a linha como FAILED (visível na lista, com o motivo) e encerra a sessão — não tenta
 *  de novo sozinho (ex.: saldo insuficiente continuaria falhando a cada tick, martelando a
 *  corretora). Fica registrada até o usuário remover manualmente. */
async function markFailed({ rowId, session, log, symbol, strategyId, message, stopSelf }) {
  session.phase = 'FAILED';
  session.rulesState = { ...(session.rulesState ?? {}), entryFailure: { message, at: new Date().toISOString() } };
  await saveState(rowId, { phase: 'FAILED', rules_state: session.rulesState }, log);
  log(`${R}❌ Entrada falhou (${symbol}): ${message}${X}`);
  sendWhatsApp(`❌ ${BOT_LABEL} ${symbol}\nFalha ao entrar: ${message}\nA moeda fica marcada como "falha" na lista — não vou tentar de novo sozinho.`);
  if (stopSelf) await stopSelf();
  return { phase: 'FAILED' };
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  if (x < 0.01) return x.toFixed(6);
  if (x < 1) return x.toFixed(4);
  return x.toFixed(2);
}

function buildEntryReasonLines(config, entryMeta) {
  const lines = [`${entryMeta.entryDesc} @ ${fmtPrice(entryMeta.close)}`];
  if (config.entry?.bandWidth?.enabled && entryMeta.bandWidth?.avgWidthPct != null) {
    lines.push(`Largura de banda média: ${entryMeta.bandWidth.avgWidthPct}% (mín ${entryMeta.bandWidth.minPct}%)`);
  }
  return lines;
}

// saveState/hasOpenPosition/resetOrphanPosition/parseRulesState/executeSell/recordBracketFill/
// recordBuyFill são genéricos — ver backend/bot/shared/tradeExecution.js.
const {
  saveState, hasOpenPosition, resetOrphanPosition,
  parseRulesState, executeSell, recordBracketFill, recordBuyFill,
} = createTradeExecution({
  botLabel: BOT_LABEL,
  buildReasonLines: buildEntryReasonLines,
});

/** Mensagem explicando que a Binance rejeitaria o alvo/stop calculado (longe demais do preço
 *  atual, filtro PERCENT_PRICE_BY_SIDE) e por isso o bot prendeu (clamp) o valor na borda
 *  permitida pra OCO ainda assim ser aceita — ver binancePlaceOcoSell. */
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

const BRACKET_RETRY_ALERT_EVERY = 10;

/** Grava a falha em rules_state.exitBracketError (attempts/firstAt/lastAt) — o bloco BOUGHT do
 *  tick chama de novo com retry:true a cada ciclo enquanto exitBracket continuar null. */
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
 * Coloca a bracket TP/SL resting na corretora logo após a compra confirmar. Alvo/stop são
 * FIXOS a partir do preço de entrada (computeBracketPrices) — diferente do bollinger-bands,
 * nunca precisa ser recriada por deriva (o nível não se move).
 */
async function placeInitialBracket({ rowId, adapter, config, session, log, filledQty, buyPrice, symbol, strategyId, retry = false }) {
  if (!config.exit.restingBracket?.enabled) return;
  const { targetPrice, stopPrice } = computeBracketPrices(config, buyPrice);
  if (targetPrice == null || stopPrice == null) {
    await recordBracketError({ rowId, session, log, symbol, strategyId, retry, message: 'alvo/stop indisponível' });
    return;
  }
  const prevError = session.rulesState?.exitBracketError ?? null;
  try {
    const bracket = await adapter.placeExitBracket(filledQty, targetPrice, stopPrice);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, placedAt: new Date().toISOString() }, exitBracketError: null };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    log(`${G}🎯 Bracket TP/SL colocada na corretora${retry ? ' (retry)' : ''} — alvo +${config.exit.restingBracket.targetPct}% ${fmtPrice(bracket.targetPrice)} / stop ${fmtPrice(bracket.stopPrice)}${X}`);
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

/** true/false se há ordem de venda aberta na corretora pro símbolo — usado pra observar sem
 *  mexer quando a posição foi reconciliada com uma ordem externa já aberta (fora do painel). */
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
async function tick(rowId, adapter, strategy, log, session, stopSelf) {
  const { config } = strategy;
  const specs = getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);

  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) return { phase: 'WATCHING' };

  const { symbol, strategy_id: strategyId, capital } = state;
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
        session.rulesState = { ...(session.rulesState ?? {}), externalOrders: true };
        await saveState(rowId, { rules_state: session.rulesState }, log);
        log(`${Y}⚠️  Ordem de venda já aberta na corretora pra ${symbol} — bot NÃO vai colocar bracket nem vender, só observando o saldo${X}`);
        sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nPosição órfã reconciliada, mas já existe ordem de venda aberta na corretora (fora do painel). Bot NÃO vai colocar bracket nem vender por conta própria — só observa o saldo até você fechar manualmente.`);
      } else if (bought) {
        await placeInitialBracket({
          rowId, adapter, config, session, log,
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

    const rulesWatch = { ...parseRulesState(state), ...(session.rulesState ?? {}) };

    // Ordem limite GTC já armada no sinal: espera fill (reteste, checado minuto a minuto) ou
    // expira após limitWaitCandles candles de 1m — ver checkEntryLimitExpired.
    if (rulesWatch.entryLimit && typeof adapter.pollRestingLimitBuy === 'function') {
      let poll;
      try {
        poll = await adapter.pollRestingLimitBuy(rulesWatch.entryLimit);
      } catch (err) {
        log(`${Y}⚠️  Erro ao consultar ordem limite de entrada: ${err.message}${X}`);
        return { phase: 'WATCHING' };
      }

      if (poll.filled) {
        log(`${G}✅ Limite @ ${fmtPrice(rulesWatch.entryLimit.price)} preenchida (pullback)${X}`);
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
          result: { filledQty: poll.filledQty, quoteQty: poll.quoteQty, avgPrice: poll.avgPrice },
        });
        if (bought) {
          await placeInitialBracket({
            rowId, adapter, config, session, log,
            filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
          });
        }
        return { phase: bought ? 'BOUGHT' : 'WATCHING' };
      }

      const expiry = checkEntryLimitExpired(config, cMap, rulesWatch.entryLimit);
      if (expiry.expired || poll.open === false) {
        try {
          if (poll.open !== false) await adapter.cancelRestingLimitBuy(rulesWatch.entryLimit);
        } catch (err) {
          log(`${Y}⚠️  Falha ao cancelar limite expirada: ${err.message}${X}`);
        }
        const cancelReason = expiry.expired
          ? `${expiry.need} candles ${expiry.interval} sem fill` : `status ${poll.status}`;
        return retireAutoFavorite({ rowId, symbol, log, stopSelf, reason: `pullback não preencheu — ${cancelReason}` });
      }

      return { phase: 'WATCHING', entryLimit: { waiting: true, ...expiry } };
    }

    const signal = evaluateEntrySignal(config, cMap);
    if (!signal.allowed) {
      // Raríssimo (janela entre o scanner detectar e esta sessão rodar o 1º tick) — o sinal
      // não se confirma mais nesta checagem fresca. Sem posição/ordem nenhuma envolvida, só
      // devolve a moeda pro pool em vez de deixar uma linha WATCHING zumbi.
      return retireAutoFavorite({ rowId, symbol, log, stopSelf, reason: `sinal não se confirmou mais (${signal.reason})` });
    }

    // Sem pullback: compra a mercado assim que o sinal confirma (limitPrice null). Chama
    // adapter.marketBuy direto (em vez do executeBuy compartilhado) pra poder capturar a
    // mensagem de erro real (ex.: saldo insuficiente) e gravar em FAILED — executeBuy só
    // loga e devolve false, sem expor o motivo pro chamador.
    if (signal.limitPrice == null) {
      log(`${G}📍 Sinal (${signal.entryDesc}) — comprando ${parseFloat(capital).toFixed(2)} USDT a mercado${X}`);
      let buyResult;
      try {
        buyResult = await adapter.marketBuy(parseFloat(capital));
      } catch (err) {
        return markFailed({ rowId, session, log, symbol, strategyId, message: err.message, stopSelf });
      }
      if (buyResult?.filled === false) {
        return markFailed({ rowId, session, log, symbol, strategyId, message: 'ordem a mercado não preenchida', stopSelf });
      }
      const bought = await recordBuyFill({
        rowId, strategy, log, session,
        entryMeta: { ...signal, signalPrice: signal.close, limitPrice: null },
        capital, strategyId, symbol, result: buyResult,
      });
      if (bought) {
        await placeInitialBracket({
          rowId, adapter, config, session, log,
          filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
        });
      }
      return { phase: bought ? 'BOUGHT' : 'FAILED' };
    }

    // Com pullback: arma ordem limite GTC no preço do sinal − belowPct%, esperando reteste
    // minuto a minuto (fill checado a cada tick de polling.pollMs, tipicamente 1min). Se a
    // corretora rejeitar a ordem (ex.: saldo insuficiente), marca FAILED — sem fallback pra
    // compra bloqueante (o mesmo motivo da rejeição provavelmente rejeitaria de novo).
    let handle;
    try {
      handle = await adapter.placeRestingLimitBuy(parseFloat(capital), signal.limitPrice);
    } catch (err) {
      return markFailed({ rowId, session, log, symbol, strategyId, message: err.message, stopSelf });
    }
    const waitN = config.entry.limitWaitCandles ?? 20;
    const entryLimit = {
      ...handle,
      price: handle.price ?? signal.limitPrice,
      placedAt: new Date().toISOString(),
      signalOpenTime: signal.signalOpenTime,
      signalPrice: signal.close,
      entryDesc: signal.entryDesc,
      entryMeta: { ...signal, signalPrice: signal.close },
    };
    session.rulesState = { entryLimit };
    await saveState(rowId, { phase: 'PENDING', rules_state: session.rulesState }, log);
    log(`${G}📍 Sinal (${signal.entryDesc}) — limite GTC @ ${fmtPrice(entryLimit.price)} `
      + `armada (espera até ${waitN} candles de 1min p/ reteste)${X}`);

    const instant = await adapter.pollRestingLimitBuy(entryLimit);
    if (instant.filled) {
      log(`${G}✅ Limite preenchida na hora${X}`);
      const bought = await recordBuyFill({
        rowId, strategy, log, session,
        entryMeta: entryLimit.entryMeta,
        capital, strategyId, symbol,
        result: { filledQty: instant.filledQty, quoteQty: instant.quoteQty, avgPrice: instant.avgPrice },
      });
      if (bought) {
        await placeInitialBracket({
          rowId, adapter, config, session, log,
          filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
        });
      }
      return { phase: bought ? 'BOUGHT' : 'FAILED' };
    }
    return { phase: 'PENDING', entryLimit: { armed: true } };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  const rulesState = { ...parseRulesState(state), ...(session.rulesState ?? {}) };
  const buyPrice = state.buy_price ? parseFloat(state.buy_price) : null;

  // Posição com ordem de venda colocada fora do painel — bot só observa, nunca coloca bracket
  // nem vende a mercado por conta própria.
  if (rulesState.externalOrders) {
    const stillOpen = await hasOpenSellOrder(adapter, log);
    if (stillOpen) return { phase: 'BOUGHT' };

    const lastPriceExt = parseFloat((cMap[config.entry.interval] ?? []).at(-1)?.close ?? buyPrice);
    const balance = typeof adapter.getBaseBalance === 'function' ? await adapter.getBaseBalance().catch(() => null) : null;
    if (balance != null && lastPriceExt > 0 && balance * lastPriceExt >= 3) {
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
    return retireAutoFavorite({ rowId, symbol, log, stopSelf, reason: 'venda executada fora do bot' });
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
        reason: kind === 'target' ? 'RSI_TARGET' : 'STOP_LOSS',
        targetLevelValue: kind === 'target' ? rulesState.exitBracket.targetPrice : rulesState.exitBracket.stopPrice,
        exitDesc: kind === 'target'
          ? 'Bracket TP no alvo fixo (ordem resting)'
          : 'Bracket SL no stop fixo (ordem resting)',
      };
      await recordBracketFill({ rowId, strategy, log, state, session, exitResult, result: bracketResult });
      return retireAutoFavorite({ rowId, symbol, log, stopSelf, reason: `trade fechado (${exitResult.reason})` });
    }

    // Bracket é FIXA (sem trailing/deriva) — nada a recriar, só espera preencher.
    return { phase: 'BOUGHT' };
  }

  // Sem bracket resting (desligada ou falhou ao colocar) — tenta de novo aqui a cada tick até
  // conseguir; enquanto isso, a saída cai no fallback via evaluateExit no candle em formação.
  if (config.exit.restingBracket?.enabled) {
    await placeInitialBracket({
      rowId, adapter, config, session, log, symbol, strategyId, buyPrice,
      filledQty: parseFloat(state.buy_qty), retry: true,
    });
  }

  const exitResult = evaluateExit(config, cMap, buyPrice);
  if (!exitResult.exit) return { phase: 'BOUGHT' };

  try {
    await executeSell({
      rowId, adapter, strategy, log, state, exitResult, session,
      defaultReasonDesc: 'Alvo/stop fixo RSI Momentum',
    });
  } catch {
    return { phase: 'BOUGHT' };
  }
  return retireAutoFavorite({ rowId, symbol, log, stopSelf, reason: `trade fechado (${exitResult.reason})` });
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
    log(`🔄 ${row.symbol} — config atualizada do painel (RSI ${next.config.entry.interval} > ${next.config.entry.rsiThreshold})`);
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
      lastResult = await tick(ctx.rowId, adapter, ctx.strategy, log, session, stop);
    } catch (err) {
      log(`❌ Tick error: ${err.message}`);
    }
    schedule();
  };

  if (startupIndex !== null) {
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

  console.log('🚀 rsi-momentum-bot iniciado — scanner de mercado + pullback/OCO avaliados minuto a minuto');

  await syncExchangeClocks();
  setInterval(syncExchangeClocks, 60 * 60_000);

  const symbolFilter = process.argv.includes('--symbol')
    ? process.argv[process.argv.indexOf('--symbol') + 1]?.toUpperCase()
    : null;

  // Retoma linhas pending/comprada de um restart — nunca perde uma posição/ordem já aberta na
  // corretora só porque o processo caiu e voltou.
  let resumable = await loadResumableRows();
  if (symbolFilter) resumable = resumable.filter(r => r.symbol.toUpperCase() === symbolFilter);
  await Promise.all(resumable.map((row, i) => startSymbol(row, COLORS[i % COLORS.length], i)));
  if (resumable.length) {
    console.log(`🔁 ${resumable.length} moeda(s) retomada(s) do restart (pending/comprada)`);
  }

  // Sync manual: se o usuário desativar/apagar o favorito automático de uma moeda pending/
  // comprada direto no painel ou via SQL, encerra a sessão (não cancela ordem/vende sozinho —
  // mesmo comportamento genérico dos outros bots, ver multitradeWatch.js).
  startMultitradeWatch({
    sbReq,
    strategyIds: STRATEGY_IDS,
    symbolFilter,
    resolveStrategy,
    onStartSymbol: () => Promise.resolve(), // criação de linha nova é só via createAutoFavorite/scanner
    log: console.log,
  });

  if (symbolFilter) {
    // --symbol só restringe a retomada acima — não faz sentido rodar o scanner de mercado
    // inteiro filtrado numa única moeda (o scanner já ignora quem tem linha existente).
    await new Promise(() => {});
    return;
  }

  let colorCursor = resumable.length;
  startMarketScanner({
    config: resolveStrategy({ strategy_id: 'rsi-momentum', trade_config: getStrategyPresetBody('rsi-momentum') }).config,
    loadTrackedSymbols,
    onSignal: async (symbol) => {
      if (registry.getByKey(symbol, 'rsi-momentum')) return; // corrida: sessão já rodando
      const row = await createAutoFavorite(symbol);
      if (!row) return;
      await startSymbol(row, COLORS[colorCursor++ % COLORS.length]);
    },
    log: console.log,
    intervalMs: SCAN_INTERVAL_MS,
  });

  await new Promise(() => {});
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { runRsiMomentumBot: main };
