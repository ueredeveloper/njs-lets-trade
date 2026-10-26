'use strict';

/**
 * OCO manual com entrada arrastada no gráfico (linha amarela — ChartOcoTool.jsx). O painel só
 * GRAVA o pedido em `manual_oco_orders` (POST /services/manual-oco-orders); quem executa é este
 * watcher, rodando dentro do processo do rsi-momentum-bot (ver main() lá) — assim a ordem segue
 * sendo vigiada no Termux mesmo com o PC/painel desligado.
 *
 * Ciclo (a cada POLL_MS, uma passada por vez):
 *   NEW    → 'limit': LIMIT BUY GTC no entry_price (placeRestingLimitBuy) → OPEN + buy_handle
 *            'trigger': só vira OPEN (vigia o preço)
 *   OPEN   → 'limit': poll da limite; preencheu → FILLED; sumiu sem fill → CLOSED
 *            'trigger': preço ≥ entrada → compra a mercado → FILLED
 *   CANCEL_REQUESTED → cancela a limite (fill parcial no cancelamento vira FILLED) → CANCELLED
 *   FILLED → coloca a OCO de venda (placeExitBracket, alvo/stop absolutos) → BRACKETED, ou
 *            OCO_FAILED (posição sem proteção — aviso no WhatsApp)
 *   BRACKETED → poll da OCO; uma perna executou → CLOSED_TARGET / CLOSED_STOP (+ exit, WhatsApp).
 *            Inclui as do "Comprar agora" (entry_kind 'market'). "Vender agora" do gráfico tira a
 *            linha daqui (SELLING) antes de mexer na OCO — ver /manual-oco-orders/:id/sell.
 * Preços são REFERÊNCIA: a corretora pode exigir ajuste e ele é feito sem perguntar — tick/precisão
 * (entrada, alvo e stop arredondados), OCO da Binance presa na faixa PERCENT_PRICE (ocoClient.js,
 * `bracket.clamped`), e limite funda demais espera o preço chegar perto (ver NEW). Os preços
 * efetivos ficam em buy_handle.price / bracket.targetPrice / bracket.stopPrice.
 * O fill é gravado (FILLED) ANTES da OCO: se o processo cair no meio, a OCO é tentada de novo no
 * restart. Ordem avulsa — nenhuma linha em rsi_multi_bot_state; o bot não gerencia a posição.
 * Tabela ausente (migração supabase/add-manual-oco-orders-table.sql não rodada) só loga uma vez.
 */

const { buildAdapter } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const { fetchLivePrice } = require('../shared/livePrice');
const { sendWhatsApp } = require('../whatsapp');
const { getSymbolFilters, getAvgPrice } = require('../../binance/ocoClient');

const TABLE = 'manual_oco_orders';
const POLL_MS = 15_000;
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'CANCEL_REQUESTED', 'FILLED', 'BRACKETED'];

function fmt(p) {
  return Number.isFinite(Number(p)) ? String(Number(Number(p).toPrecision(6))) : '—';
}

/** PATCH condicionado ao status lido — devolve false se o painel mudou a linha no meio
 *  (ex.: cancelou um NEW enquanto a limite era armada). */
async function patchIf(row, fields) {
  const rows = await sbReq('PATCH', TABLE, { ...fields, updated_at: new Date().toISOString() },
    `?id=eq.${row.id}&status=eq.${row.status}`);
  return Array.isArray(rows) && rows.length > 0;
}

function notify(text, log) {
  sendWhatsApp(text).catch(err => log(`⚠️  [OCO manual] WhatsApp falhou: ${err.message}`));
}

async function placeBracket(row, adapter, fill, log) {
  const tag = `${row.symbol} #${row.id}`;
  try {
    const bracket = await adapter.placeExitBracket(Number(fill.filledQty), Number(row.target_price), Number(row.stop_price));
    await patchIf(row, { status: 'BRACKETED', bracket, error: null });
    log(`✅ [OCO manual] ${tag}: OCO colocada — alvo ${fmt(bracket.targetPrice)} / stop ${fmt(bracket.stopPrice)}`);
    notify(`✅ OCO manual ${row.symbol}: comprado ${fmt(fill.filledQty)} a ~${fmt(fill.avgPrice)} · alvo ${fmt(bracket.targetPrice)} / stop ${fmt(bracket.stopPrice)}`, log);
  } catch (err) {
    await patchIf(row, { status: 'OCO_FAILED', error: err.message });
    log(`❌ [OCO manual] ${tag}: comprou mas a OCO FALHOU — ${err.message}`);
    notify(`🚨 OCO manual ${row.symbol}: COMPROU ${fmt(fill.filledQty)} a ~${fmt(fill.avgPrice)} mas a OCO FALHOU (${err.message}) — posição SEM stop/alvo, proteja manualmente.`, log);
  }
}

async function recordFill(row, adapter, fill, log) {
  const clean = { filledQty: fill.filledQty, quoteQty: fill.quoteQty, avgPrice: fill.avgPrice, at: new Date().toISOString() };
  // Incondicional: o fill é fato na corretora, vale mesmo que o painel tenha pedido cancelamento
  // no meio (senão o próximo passe tentaria cancelar/comprar de novo e a 2ª OCO falharia).
  await sbReq('PATCH', TABLE, { status: 'FILLED', fill: clean, updated_at: new Date().toISOString() }, `?id=eq.${row.id}`);
  log(`🟢 [OCO manual] ${row.symbol} #${row.id}: compra preenchida — ${fmt(clean.filledQty)} a ~${fmt(clean.avgPrice)}`);
  await placeBracket({ ...row, status: 'FILLED' }, adapter, clean, log);
}

async function processRow(row, log) {
  const adapter = buildAdapter(row.exchange === 'gate' ? 'gate' : 'binance', row.symbol);
  const tag = `${row.symbol} #${row.id}`;
  const usdt = Number(row.usdt);
  const entry = Number(row.entry_price);

  if (row.status === 'FILLED') {
    await placeBracket(row, adapter, row.fill ?? {}, log);
    return;
  }

  if (row.status === 'BRACKETED') {
    if (!row.bracket) return;
    const r = await adapter.pollExitBracket(row.bracket);
    if (!r?.filled) return;
    const exit = { kind: r.filled, soldQty: r.soldQty, usdtOut: r.usdtOut, exitPrice: r.exitPrice, at: new Date().toISOString() };
    const ok = await patchIf(row, { status: r.filled === 'target' ? 'CLOSED_TARGET' : 'CLOSED_STOP', exit });
    if (!ok) return;
    const spent = Number(row.fill?.quoteQty);
    const pnl = Number.isFinite(spent) && Number.isFinite(r.usdtOut) ? r.usdtOut - spent : null;
    const pnlTxt = pnl != null ? ` · P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (${((pnl / spent) * 100).toFixed(2)}%)` : '';
    log(`${r.filled === 'target' ? '🎯' : '🛑'} [OCO manual] ${tag}: ${r.filled === 'target' ? 'ALVO' : 'STOP'} executado a ~${fmt(r.exitPrice)}${pnlTxt}`);
    notify(`${r.filled === 'target' ? '🎯' : '🛑'} OCO manual ${row.symbol}: ${r.filled === 'target' ? 'alvo' : 'stop'} executado a ~${fmt(r.exitPrice)}${pnlTxt}`, log);
    return;
  }

  if (row.status === 'CANCEL_REQUESTED') {
    if (row.entry_kind === 'limit' && row.buy_handle) {
      const r = await adapter.cancelRestingLimitBuy(row.buy_handle);
      if (r?.filled) { await recordFill(row, adapter, r, log); return; }
    }
    await patchIf(row, { status: 'CANCELLED' });
    log(`🚫 [OCO manual] ${tag}: cancelada`);
    return;
  }

  if (row.status === 'NEW') {
    if (row.entry_kind === 'trigger') {
      await patchIf(row, { status: 'OPEN' });
      log(`👀 [OCO manual] ${tag}: vigiando rompimento em ${fmt(entry)} (${usdt} USDT)`);
      return;
    }
    // Binance só aceita LIMIT BUY até X% abaixo do preço médio (PERCENT_PRICE_BY_SIDE, lado bid).
    // Entrada mais funda que isso: em vez de falhar, fica NEW e tenta de novo quando o preço
    // chegar perto. Tick/precisão são ajustados dentro do placeRestingLimitBuy (Binance e Gate).
    if (row.exchange !== 'gate') {
      const [{ bidMultiplierDown }, avgPrice] = await Promise.all([getSymbolFilters(row.symbol), getAvgPrice(row.symbol)]);
      const minBid = bidMultiplierDown != null && avgPrice > 0 ? avgPrice * bidMultiplierDown * 1.002 : null;
      if (minBid != null && entry < minBid) {
        const note = `aguardando o preço se aproximar — Binance só aceita limite a partir de ~${fmt(minBid)}`;
        if (row.error !== note) await patchIf(row, { error: note });
        return;
      }
    }
    let handle;
    try {
      handle = await adapter.placeRestingLimitBuy(usdt, entry);
    } catch (err) {
      await patchIf(row, { status: 'FAILED', error: err.message });
      log(`❌ [OCO manual] ${tag}: corretora recusou a limite — ${err.message}`);
      notify(`❌ OCO manual ${row.symbol}: corretora recusou a compra limite em ${fmt(entry)} (${err.message})`, log);
      return;
    }
    const ok = await patchIf(row, { status: 'OPEN', buy_handle: handle, error: null });
    if (!ok) {
      // Painel cancelou enquanto a limite era armada — desfaz na corretora.
      const r = await adapter.cancelRestingLimitBuy(handle);
      if (r?.filled) await recordFill({ ...row, buy_handle: handle }, adapter, r, log);
      return;
    }
    log(`📌 [OCO manual] ${tag}: LIMIT BUY ${usdt} USDT @ ${fmt(handle.price ?? entry)} armada`);
    return;
  }

  // OPEN
  if (row.entry_kind === 'trigger') {
    const price = await fetchLivePrice(row.exchange, row.symbol);
    if (!(price >= entry)) return;
    if (price >= Number(row.target_price)) {
      await patchIf(row, { status: 'FAILED', error: `preço (${fmt(price)}) passou do alvo antes da compra` });
      log(`⚠️  [OCO manual] ${tag}: preço ${fmt(price)} já acima do alvo — compra abortada`);
      return;
    }
    let fill;
    try {
      fill = await adapter.marketBuy(usdt);
    } catch (err) {
      await patchIf(row, { status: 'FAILED', error: err.message });
      log(`❌ [OCO manual] ${tag}: compra no rompimento falhou — ${err.message}`);
      notify(`❌ OCO manual ${row.symbol}: compra no rompimento (${fmt(entry)}) falhou (${err.message})`, log);
      return;
    }
    await recordFill(row, adapter, fill, log);
    return;
  }
  if (!row.buy_handle) return;
  const poll = await adapter.pollRestingLimitBuy(row.buy_handle);
  if (poll.filled) { await recordFill(row, adapter, poll, log); return; }
  if (poll.open === false) {
    await patchIf(row, { status: 'CLOSED', error: `limite sumiu da corretora sem fill (status ${poll.status})` });
    log(`⚠️  [OCO manual] ${tag}: limite fechada sem fill (status ${poll.status})`);
  }
}

function startManualOcoWatcher({ log = console.log } = {}) {
  let running = false;
  let lastErr = null;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await sbReq('GET', TABLE, null,
        `?status=in.(${ACTIVE_STATUSES.join(',')})&order=id.asc&limit=50`);
      lastErr = null;
      for (const row of rows ?? []) {
        try {
          await processRow(row, log);
        } catch (err) {
          log(`⚠️  [OCO manual] ${row.symbol} #${row.id}: ${err.message}`);
        }
      }
    } catch (err) {
      if (err.message !== lastErr) log(`⚠️  [OCO manual] leitura de ${TABLE} falhou: ${err.message}`);
      lastErr = err.message;
    } finally {
      running = false;
    }
  };
  pass();
  return setInterval(pass, POLL_MS);
}

module.exports = { startManualOcoWatcher };
