'use strict';

/**
 * OCO manual com entrada arrastada no gráfico (linha amarela — ChartOcoTool.jsx). O painel só
 * GRAVA o pedido em `manual_oco_orders` (POST /services/manual-oco-orders); quem executa é este
 * watcher, rodando dentro do processo do rsi-momentum-bot (ver main() lá) — assim a ordem segue
 * sendo vigiada no Termux mesmo com o PC/painel desligado.
 *
 * Ciclo (a cada POLL_MS, uma passada por vez):
 *   NEW    → OPEN (vigia o preço). NADA vai pra corretora antes da entrada — o saldo só é usado na
 *            compra, então dá pra ter mais ordens pendentes do que saldo.
 *   OPEN   → 'limit': preço ≤ entrada → compra a mercado → FILLED
 *            'trigger': preço ≥ entrada → compra a mercado → FILLED (passou do alvo → FAILED)
 *            Alvo/stop da OCO = os % desenhados aplicados ao preço REAL da compra (bracketLevels).
 *            Linhas antigas com buy_handle (LIMIT GTC armada na corretora): poll da limite.
 *   CANCEL_REQUESTED → (só linhas antigas) cancela a limite; fill parcial vira FILLED → CANCELLED
 *   FILLED → coloca a OCO de venda (placeExitBracket, alvo/stop absolutos) → BRACKETED, ou
 *            OCO_FAILED (posição sem proteção — aviso no WhatsApp)
 *   BRACKETED → poll da OCO; uma perna executou → CLOSED_TARGET / CLOSED_STOP (+ exit). Aviso de
 *            venda no WhatsApp DURÁVEL (exit.notified, re-tenta até entregar — notifyExit), inclusive
 *            o do "Vender agora" (SOLD).
 *            Inclui as do "Comprar agora" (entry_kind 'market'). "Vender agora" do gráfico tira a
 *            linha daqui (SELLING) antes de mexer na OCO — ver /manual-oco-orders/:id/sell.
 * Preços são REFERÊNCIA: a corretora pode exigir ajuste e ele é feito sem perguntar — tick/precisão
 * (alvo e stop arredondados) e OCO da Binance presa na faixa PERCENT_PRICE (ocoClient.js,
 * `bracket.clamped`). Os preços efetivos ficam em fill.avgPrice / bracket.targetPrice / bracket.stopPrice.
 * O fill é gravado (FILLED) ANTES da OCO: se o processo cair no meio, a OCO é tentada de novo no
 * restart. Ordem avulsa — nenhuma linha em rsi_multi_bot_state; o bot não gerencia a posição.
 * Tabela ausente (migração supabase/add-manual-oco-orders-table.sql não rodada) só loga uma vez.
 */

const { buildAdapter } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const { fetchLivePrice } = require('../shared/livePrice');
const { sendWhatsApp } = require('../whatsapp');
const { sendText } = require('../whatsappApiClient');

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

/** Alvo/stop da OCO. Compra feita pelo bot (limit/trigger, a mercado quando o preço chega na
 *  entrada): mantém os % desenhados (alvo/entrada, stop/entrada) e aplica sobre o preço REAL da
 *  compra — entrada 10, stop −5%, comprou a 8 (gap) → stop 7,60, não 9,50. Linhas antigas com
 *  LIMIT na corretora (buy_handle) e "Comprar agora" ('market') ficam nos preços absolutos. */
function bracketLevels(row, fill) {
  const target = Number(row.target_price);
  const stop = Number(row.stop_price);
  const entry = Number(row.entry_price);
  const avg = Number(fill.avgPrice);
  if (row.entry_kind === 'market' || row.buy_handle || !(entry > 0) || !(avg > 0)) return { target, stop };
  return { target: avg * (target / entry), stop: avg * (stop / entry) };
}

const EXIT_ICON = { target: '🎯', stop: '🛑', manual: '💰' };
const EXIT_LABEL = { target: 'alvo executado', stop: 'stop executado', manual: 'vendido (Vender agora)' };
const NOTIFY_RETRY_MS = 60_000;
const NOTIFY_MAX_AGE_MS = 24 * 3600_000;
const notifyLastTry = new Map(); // id → ms da última tentativa (re-tenta no máx. 1×/min)

/** Aviso de VENDA durável: a linha fechada leva `exit.notified=false` e só vira true depois que o
 *  serviço do WhatsApp aceitou a mensagem. Se ele estiver fora (reconexão do Baileys, Termux
 *  dormindo…), as próximas passadas re-tentam (pendingExitNotices) por até 24h — antes era um
 *  disparo único e a mensagem se perdia. Também cobre o "Vender agora" (rota /sell grava
 *  notified=false e o aviso sai daqui). */
async function notifyExit(row, log) {
  const exit = row.exit ?? {};
  const now = Date.now();
  if (now - (notifyLastTry.get(row.id) ?? 0) < NOTIFY_RETRY_MS) return;
  notifyLastTry.set(row.id, now);

  const spent = Number(row.fill?.quoteQty);
  const out = Number(exit.usdtOut);
  const pnl = spent > 0 && Number.isFinite(out) ? out - spent : null;
  const pnlTxt = pnl != null ? ` · P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (${((pnl / spent) * 100).toFixed(2)}%)` : '';
  const icon = EXIT_ICON[exit.kind] ?? '💰';
  const label = EXIT_LABEL[exit.kind] ?? 'vendido';
  const at = exit.at ? new Date(exit.at).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '';
  log(`${icon} [OCO manual] ${row.symbol} #${row.id}: ${label} a ~${fmt(exit.exitPrice)}${pnlTxt}`);
  try {
    await sendText(`${icon} OCO manual ${row.symbol}: ${label} a ~${fmt(exit.exitPrice)}${pnlTxt}${at ? ` (${at})` : ''}`);
  } catch (err) {
    log(`⚠️  [OCO manual] ${row.symbol} #${row.id}: aviso de venda no WhatsApp falhou (${err.message}) — re-tento em 1 min`);
    return;
  }
  notifyLastTry.delete(row.id);
  await sbReq('PATCH', TABLE, { exit: { ...exit, notified: true } }, `?id=eq.${row.id}`);
  log(`📤 [OCO manual] ${row.symbol} #${row.id}: aviso de venda enviado`);
}

/** Linhas fechadas (alvo/stop/Vender agora) com aviso ainda não entregue, das últimas 24h. */
async function pendingExitNotices() {
  const since = new Date(Date.now() - NOTIFY_MAX_AGE_MS).toISOString();
  return sbReq('GET', TABLE, null,
    `?status=in.(CLOSED_TARGET,CLOSED_STOP,SOLD)&exit->>notified=eq.false&exit->>at=gt.${since}&order=id.asc&limit=20`);
}

async function placeBracket(row, adapter, fill, log) {
  const tag = `${row.symbol} #${row.id}`;
  try {
    const lv = bracketLevels(row, fill);
    const bracket = await adapter.placeExitBracket(Number(fill.filledQty), lv.target, lv.stop);
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
    const exit = { kind: r.filled, soldQty: r.soldQty, usdtOut: r.usdtOut, exitPrice: r.exitPrice, at: new Date().toISOString(), notified: false };
    const status = r.filled === 'target' ? 'CLOSED_TARGET' : 'CLOSED_STOP';
    const ok = await patchIf(row, { status, exit });
    if (!ok) return;
    await notifyExit({ ...row, status, exit }, log);
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
    await patchIf(row, { status: 'OPEN', error: null });
    log(`👀 [OCO manual] ${tag}: vigiando ${row.entry_kind === 'trigger' ? 'rompimento' : 'queda'} até ${fmt(entry)} (${usdt} USDT)`);
    return;
  }

  // OPEN sem buy_handle: nada na corretora — o bot vigia o preço e compra A MERCADO quando ele
  // chega na entrada ('trigger' sobe até ela, 'limit' cai até ela). Assim o saldo só é usado na
  // hora da compra e dá pra ter mais ordens pendentes do que saldo.
  if (!row.buy_handle) {
    const price = await fetchLivePrice(row.exchange, row.symbol);
    const isTrigger = row.entry_kind === 'trigger';
    if (isTrigger ? !(price >= entry) : !(price <= entry)) return;
    // Queda além do stop desenhado NÃO aborta: a OCO é relativa ao preço comprado (bracketLevels).
    // Rompimento que já passou do alvo aborta — seria comprar o pico de uma alta que já aconteceu.
    const blown = isTrigger && price >= Number(row.target_price)
      && `preço (${fmt(price)}) passou do alvo antes da compra`;
    if (blown) {
      await patchIf(row, { status: 'FAILED', error: blown });
      log(`⚠️  [OCO manual] ${tag}: ${blown} — compra abortada`);
      notify(`⚠️ OCO manual ${row.symbol}: ${blown} — compra abortada`, log);
      return;
    }
    let fill;
    try {
      fill = await adapter.marketBuy(usdt);
    } catch (err) {
      await patchIf(row, { status: 'FAILED', error: err.message });
      log(`❌ [OCO manual] ${tag}: compra a mercado em ${fmt(price)} falhou — ${err.message}`);
      notify(`❌ OCO manual ${row.symbol}: preço chegou na entrada (${fmt(entry)}) mas a compra de ${usdt} USDT falhou (${err.message}) — saldo?`, log);
      return;
    }
    await recordFill(row, adapter, fill, log);
    return;
  }

  // OPEN com buy_handle: LIMIT antiga já armada na corretora (versão anterior) — segue o poll.
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
      // Posições abertas primeiro: com várias OPEN (cada uma lê o preço), a venda demorava a ser
      // vista no fim da fila.
      const firstRank = (s) => (s === 'BRACKETED' || s === 'FILLED' ? 0 : 1);
      const ordered = [...(rows ?? [])].sort((a, b) => firstRank(a.status) - firstRank(b.status));
      for (const row of ordered) {
        try {
          await processRow(row, log);
        } catch (err) {
          log(`⚠️  [OCO manual] ${row.symbol} #${row.id}: ${err.message}`);
        }
      }
      for (const row of await pendingExitNotices().catch(() => []) ?? []) {
        await notifyExit(row, log).catch(err => log(`⚠️  [OCO manual] ${row.symbol} #${row.id}: ${err.message}`));
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
