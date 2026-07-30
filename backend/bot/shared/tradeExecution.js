'use strict';

/**
 * Execução de ordem + bookkeeping (Supabase: rsi_multi_bot_state / rsi_multi_bot_trades)
 * compartilhados entre bots de trade — extraído de ma-cross-bot.js, que tinha
 * executeBuy/executeSell/saveState/insertTrade coladas no próprio arquivo.
 *
 * A mecânica (chamar adapter.marketBuy/marketSell, calcular PnL, persistir estado,
 * notificar WhatsApp) é igual pra qualquer estratégia — só o que muda de bot pra bot é:
 *   - botLabel: texto usado no log/WhatsApp (ex.: "MA-CROSS", "EMA-RECLAIM")
 *   - buildReasonLines(config, entryMeta): como descrever o motivo da entrada no log
 *   - computeStopLossFloor(entryPrice, peakPrice, stopLoss): fórmula do piso de stop
 *     (default = percentual/trailing de backend/bot/shared/stopLossFloor.js; um bot novo
 *     pode injetar outra, ex. stop estrutural = abertura do candle de sinal)
 *
 * Uso (por bot):
 *   const { executeBuy, executeSell, ... } = createTradeExecution({
 *     botLabel: 'MA-CROSS',
 *     buildReasonLines: buildEntryReasonLines,
 *   });
 */

const { sbReq } = require('./supabaseRest');
const { sendWhatsApp } = require('../whatsapp');
const { isGateDustResult, estimateDustClosePnl } = require('../gate/gateMarketSell');
const { computeStopLossFloor: defaultComputeStopLossFloor } = require('./stopLossFloor');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';
const DEFAULT_ENTRY_COOLDOWN_HOURS = 4;

function entryCooldownHours(config) {
  const h = Number(config?.entryCooldownHours);
  return Number.isFinite(h) && h >= 0 ? h : DEFAULT_ENTRY_COOLDOWN_HOURS;
}

function parseRulesState(row) {
  let rs = row?.rules_state;
  if (typeof rs === 'string') {
    try { rs = JSON.parse(rs); } catch { rs = null; }
  }
  return rs && typeof rs === 'object' ? rs : {};
}

function postExitRulesState(exitTime) {
  return { lastExitTime: exitTime };
}

function resolveLastExitTime(state, session) {
  const fromRow = parseRulesState(state).lastExitTime;
  if (fromRow) return fromRow;
  return session?.lastExitTime ?? null;
}

function hasOpenPosition(state) {
  const qty   = parseFloat(state?.buy_qty);
  const price = parseFloat(state?.buy_price);
  return Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0;
}

function createTradeExecution({
  botLabel, buildReasonLines, computeStopLossFloor = defaultComputeStopLossFloor,
  extraBuyLogLines, extraInitialRulesState,
}) {
  let rulesStateColumnOk = true;

  async function saveState(id, update, log) {
    const payload = { ...update, updated_at: new Date().toISOString() };
    if (!rulesStateColumnOk && payload.rules_state !== undefined) {
      delete payload.rules_state;
    }
    try {
      await sbReq('PATCH', 'rsi_multi_bot_state', payload, `?id=eq.${id}`);
    } catch (err) {
      const msg = String(err.message ?? err);
      if (payload.rules_state !== undefined && /rules_state/.test(msg)) {
        rulesStateColumnOk = false;
        const { rules_state, ...rest } = payload;
        await sbReq('PATCH', 'rsi_multi_bot_state', rest, `?id=eq.${id}`);
        log?.(`${Y}⚠️  Coluna rules_state ausente — rode supabase/add-rules-state-column.sql (stop trailing só em memória)${X}`);
        return;
      }
      throw err;
    }
  }

  async function insertTrade(trade) {
    try { await sbReq('POST', 'rsi_multi_bot_trades', trade); } catch { /* ignore */ }
  }

  async function resetOrphanPosition(rowId, log, session, state, reason) {
    log(`${Y}⚠️  Posição órfã (${reason}) — resetando para WATCHING${X}`);
    if (session) {
      session.phase = 'WATCHING';
      session.rulesState = null;
    }
    if (state.phase === 'BOUGHT') {
      const exitTime = resolveLastExitTime(state, session) ?? new Date().toISOString();
      await saveState(rowId, {
        phase: 'WATCHING',
        buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
        rules_state: postExitRulesState(exitTime),
      }, log);
    }
    return { phase: 'WATCHING' };
  }

  async function executeBuy({
    rowId, adapter, strategy, log, session, entryMeta, capital, strategyId, symbol, totalCapital,
  }) {
    let result;
    try {
      result = await adapter.marketBuy(parseFloat(capital));
    } catch (err) {
      log(`❌ Erro na compra: ${err.message}`);
      return false;
    }

    const { filledQty, quoteQty, avgPrice } = result;
    const initialFloor = computeStopLossFloor(avgPrice, avgPrice, strategy.config.stopLoss);
    const buyTime = new Date().toISOString();
    session.phase = 'BOUGHT';
    session.pendingPullback = null;
    const dcaCfg = strategy.config.entryMultiDca;
    const extraRulesState = extraInitialRulesState
      ? extraInitialRulesState({ config: strategy.config, entryMeta, result, capital, totalCapital })
      : null;
    session.rulesState = {
      stopPeakPrice: avgPrice,
      stopFloor: initialFloor,
      ...(dcaCfg?.enabled
        ? { dca: { entries: [{ price: avgPrice, qty: filledQty, usdt: quoteQty, time: buyTime }] } }
        : {}),
      ...(extraRulesState ?? {}),
    };
    await saveState(rowId, {
      phase: 'BOUGHT', buy_price: avgPrice, buy_qty: filledQty,
      buy_usdt: quoteQty, buy_time: buyTime,
      rsi_entry: entryMeta.ma1,
      rules_state: session.rulesState,
    }, log);

    const reasonLines = buildReasonLines ? buildReasonLines(strategy.config, entryMeta) : [];

    log(`${'─'.repeat(60)}`);
    log(`${G}🟢 COMPRA EXECUTADA${X}`);
    log(`   Preço : ${avgPrice.toFixed(6)}  Qty: ${filledQty}  USDT: ${quoteQty.toFixed(4)}`);
    const extraLines = extraBuyLogLines
      ? extraBuyLogLines({ config: strategy.config, entryMeta, result, capital, totalCapital })
      : null;
    for (const line of extraLines ?? []) log(`   ${line}`);
    if (entryMeta.pullbackVsMa2Pct != null) {
      log(`   Pullback MA21: ${entryMeta.pullbackVsMa2Pct.toFixed(1)}pp  close +${entryMeta.aboveMa2Pct?.toFixed(1) ?? '?'}% MA21`);
    } else if (entryMeta.pullbackPct != null) {
      log(`   Pullback: ${entryMeta.pullbackPct.toFixed(1)}%  MA2: +${entryMeta.aboveMa2Pct?.toFixed(1) ?? '?'}%`);
    }
    if (reasonLines.length) {
      log(`   Motivos da entrada:`);
      for (const line of reasonLines) log(`     • ${line}`);
    }
    log(`${'─'.repeat(60)}`);
    sendWhatsApp(
      `🟢 ${botLabel} COMPRA [${strategyId}] ${symbol}\nPreço: ${avgPrice}\nUSDT: ${quoteQty.toFixed(4)}`
      + (reasonLines.length ? `\n\nMotivos:\n${reasonLines.map(l => `• ${l}`).join('\n')}` : ''),
    );
    return true;
  }

  async function executeSell({ rowId, adapter, strategy, log, state, exitResult, reasonLabel, session, defaultReasonDesc }) {
    const { config } = strategy;
    const { symbol, strategy_id: strategyId, capital } = state;
    const buyPrice = parseFloat(state.buy_price);

    const reason = reasonLabel ?? (exitResult.reason === 'STOP_LOSS'
      ? (exitResult.dropPct >= 0
        ? `stop trailing +${exitResult.dropPct.toFixed(2)}% (piso ${exitResult.stopFloor?.toFixed(6)})`
        : `stop-loss ${exitResult.dropPct?.toFixed(2)}%`)
      : (exitResult.exitDesc ?? exitResult.reason ?? defaultReasonDesc ?? 'sinal de saída'));

    const sellQty = parseFloat(state.buy_qty);
    if (!hasOpenPosition(state)) {
      log(`${Y}⚠️  Sinal de saída sem qty registrada — posição órfã${X}`);
      await resetOrphanPosition(rowId, log, session, state, 'buy_qty ausente');
      return { phase: 'WATCHING' };
    }

    log(`${R}📈 ${reason} — vendendo ${sellQty} ${symbol}${X}`);

    const exitTime = new Date().toISOString();
    const sellOpts = adapter.name === 'Gate.io' ? { aggressive: true } : {};
    let result;
    try {
      result = await adapter.marketSell(sellQty, log, sellOpts);
    } catch (err) {
      log(`❌ Erro na venda: ${err.message}`);
      throw err;
    }

    if (isGateDustResult(result)) {
      const est = estimateDustClosePnl(state, result);
      const capitalBefore = parseFloat(capital);
      const pnlSign = est.pnlUsdt >= 0 ? '+' : '';

      await insertTrade({
        symbol, exchange: state.exchange, strategy_id: strategyId,
        entry_time: state.buy_time, exit_time: exitTime,
        entry_price: buyPrice, exit_price: est.exitPrice,
        qty: est.soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: est.usdtOut,
        pnl_usdt: est.pnlUsdt, pnl_pct: parseFloat(est.pnlPct.toFixed(2)),
        capital_before: capitalBefore, capital_after: est.capitalAfter,
        rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: exitResult?.ma1 ?? 0,
        exit_reason: 'DUST',
      });

      if (session) session.lastExitTime = exitTime;
      await saveState(rowId, {
        capital: est.capitalAfter, phase: 'WATCHING',
        buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
        rules_state: postExitRulesState(exitTime),
      }, log);

      log(`${'─'.repeat(60)}`);
      log(`${Y}🟡 POSIÇÃO ENCERRADA (dust residual ${result.dustQty} ≈ $${result.dustUsdt.toFixed(4)})${X}`);
      log(`   PnL estimado: ${pnlSign}${est.pnlUsdt.toFixed(4)} USDT (${pnlSign}${est.pnlPct.toFixed(2)}%)`);
      log(`   Capital: ${capitalBefore.toFixed(4)} → ${est.capitalAfter.toFixed(4)} USDT`);
      log(`${'─'.repeat(60)}`);
      return { phase: 'WATCHING' };
    }

    const { soldQty, usdtOut, exitPrice } = result;
    const capitalBefore = parseFloat(capital);
    const pnlUsdt       = usdtOut - parseFloat(state.buy_usdt);
    const pnlPct        = (pnlUsdt / capitalBefore) * 100;
    const capitalAfter  = capitalBefore + pnlUsdt;
    const pnlSign       = pnlUsdt >= 0 ? '+' : '';

    await insertTrade({
      symbol, exchange: state.exchange, strategy_id: strategyId,
      entry_time: state.buy_time, exit_time: exitTime,
      entry_price: buyPrice, exit_price: exitPrice,
      qty: soldQty, usdt_in: parseFloat(state.buy_usdt), usdt_out: usdtOut,
      pnl_usdt: pnlUsdt, pnl_pct: parseFloat(pnlPct.toFixed(2)),
      capital_before: capitalBefore, capital_after: capitalAfter,
      rsi_entry: parseFloat(state.rsi_entry ?? 0), rsi_exit: exitResult?.ma1 ?? 0,
      exit_reason: exitResult?.reason ?? reasonLabel ?? 'PANEL_REMOVED',
    });

    if (session) session.lastExitTime = exitTime;
    const cooldownH = entryCooldownHours(config);
    await saveState(rowId, {
      capital: capitalAfter, phase: 'WATCHING',
      buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
      rules_state: postExitRulesState(exitTime),
    }, log);
    if (cooldownH > 0) {
      log(`${Y}⏳ Cooldown de entrada: ${cooldownH}h${X}`);
    }

    log(`${'─'.repeat(60)}`);
    log(`${R}🔴 VENDA EXECUTADA${X}`);
    log(`   PnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)`);
    log(`   Capital: ${capitalBefore.toFixed(4)} → ${capitalAfter.toFixed(4)} USDT`);
    log(`${'─'.repeat(60)}`);
    sendWhatsApp(`🔴 ${botLabel} VENDA [${strategyId}] ${symbol}\nMotivo: ${reason}\nPnL: ${pnlSign}${pnlUsdt.toFixed(4)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)`);
    return { phase: 'WATCHING' };
  }

  return {
    saveState, insertTrade, hasOpenPosition, resetOrphanPosition,
    parseRulesState, postExitRulesState, resolveLastExitTime,
    executeBuy, executeSell,
  };
}

module.exports = {
  createTradeExecution,
  parseRulesState,
  postExitRulesState,
  resolveLastExitTime,
  hasOpenPosition,
};
