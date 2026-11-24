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
 *            'candle_close': espera o candle do pedido fechar (close_condition.closeAt); fechou
 *            num padrão de baixa (shooting star / inverted hammer / gravestone doji / hanging man /
 *            bearish engulfing / tweezer top — bearishClosePattern) → CLOSED (não comprou, aviso
 *            no WhatsApp); senão compra a mercado → FILLED. Migração
 *            supabase/add-manual-oco-close-condition.sql. Com close_condition.entryDiscount
 *            (Explosão automática) não compra no fechamento: vira 'limit' X% abaixo do fechamento
 *            com prazo (limitExpiresAt → CLOSED) e a OCO usa o candle fechado (exitCandle).
 *            Alvo/stop da OCO = os % desenhados aplicados ao preço REAL da compra (bracketLevels).
 *            Linhas antigas com buy_handle (LIMIT GTC armada na corretora): poll da limite.
 *   CANCEL_REQUESTED → (só linhas antigas) cancela a limite; fill parcial vira FILLED → CANCELLED
 *   FILLED → coloca a OCO de venda (placeExitBracket, alvo/stop absolutos) → BRACKETED, ou
 *            OCO_FAILED (posição sem proteção — aviso no WhatsApp)
 *   BRACKETED → poll da OCO; uma perna executou → CLOSED_TARGET / CLOSED_STOP (+ exit). Com
 *            close_condition.exit.onDrop (Explosão automática, v1.193.0): caiu X% do preço comprado →
 *            o alvo da OCO vai pro preço de entrada ('breakeven') e, no 'martingale', compra de novo
 *            e grava a 2ª compra como ordem FILHA (FILLED, OCO própria) — ver processOnDrop. Aviso de
 *            venda no WhatsApp DURÁVEL (exit.notified, re-tenta até entregar — notifyExit), inclusive
 *            o do "Vender agora" (SOLD).
 *            Stop PRENDIDO pela faixa da Binance (pediu −30%, aceitou ~−20% — bracket.clamped.stop):
 *            maybeLowerStop rebaixa a OCO conforme o preço cai, até o stop pedido (desiredStopPrice),
 *            sem passar na frente da regra de queda/martingale.
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
const { fetchClosedCandle, bearishClosePattern, bullishClosePattern, intervalMs } = require('../shared/candleCloseCondition');
const fetchKlines = require('../../binance/fetchKlines');
const { evaluateBullishBreakout } = require('../../market/bullishBreakoutScanner');
const { exitLevels } = require('../breakout-auto/bullishBreakoutAuto');
const { checkMarketRegime } = require('../breakout-auto/marketRegime');
const { applyMinStop } = require('../shared/manualOcoStop');
const { binanceLowestOcoStop } = require('../../binance/ocoClient');
const { sendWhatsApp } = require('../whatsapp');
const { sendText } = require('../whatsappApiClient');
const { writePriceActionPart } = require('../shared/priceActionStatusJournal');

const TABLE = 'manual_oco_orders';
const POLL_MS = 15_000;
const ACTIVE_STATUSES = ['NEW', 'OPEN', 'CANCEL_REQUESTED', 'FILLED', 'BRACKETED'];

/** Dica no fim do aviso de compra que falhou — par não liberado pra conta (bStock etc.) não é saldo. */
function buyFailHint(err) {
  const m = String(err?.message || '');
  if (/not permitted for this account/i.test(m)) return 'par não liberado pra esta conta (ex.: ação/ETF tokenizado)';
  if (/insufficient balance/i.test(m)) return 'saldo USDT livre insuficiente';
  return 'saldo?';
}

function fmt(p) {
  return Number.isFinite(Number(p)) ? String(Number(Number(p).toPrecision(6))) : '—';
}

/** "−9.80%" do preço atual vs. o preço comprado. */
function fmtDropPct(price, avg) {
  const pct = ((price - avg) / avg) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** PATCH condicionado ao status lido — devolve false se o painel mudou a linha no meio
 *  (ex.: cancelou um NEW enquanto a limite era armada). */
async function patchIf(row, fields, extraFilter = '') {
  const rows = await sbReq('PATCH', TABLE, { ...fields, updated_at: new Date().toISOString() },
    `?id=eq.${row.id}&status=eq.${row.status}${extraFilter}`);
  return Array.isArray(rows) && rows.length > 0;
}

function notify(text, log) {
  sendWhatsApp(text).catch(err => log(`⚠️  [OCO manual] WhatsApp falhou: ${err.message}`));
}

/** Alvo/stop da OCO. Compra feita pelo bot (limit/trigger, a mercado quando o preço chega na
 *  entrada): mantém os % desenhados (alvo/entrada, stop/entrada) e aplica sobre o preço REAL da
 *  compra — entrada 10, stop −5%, comprou a 8 (gap) → stop 7,60, não 9,50. Linhas antigas com
 *  LIMIT na corretora (buy_handle) e "Comprar agora" ('market') ficam nos preços absolutos. Em
 *  todos os casos o stop fica a no mínimo MIN_STOP_PCT% do preço comprado (applyMinStop). */
function bracketLevels(row, fill) {
  const target = Number(row.target_price);
  const stop = Number(row.stop_price);
  const entry = Number(row.entry_price);
  const avg = Number(fill.avgPrice);
  if (row.entry_kind === 'market' || row.buy_handle || !(entry > 0) || !(avg > 0)) return { target, stop: applyMinStop(stop, avg) };
  return { target: avg * (target / entry), stop: applyMinStop(avg * (stop / entry), avg) };
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

function fmtBrt(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const KNOWN_ENTRY_KINDS = new Set(['limit', 'trigger', 'market', 'candle_close']);
const unknownKindWarned = new Set();

// Folga depois do fechamento antes de ler o candle — a corretora leva alguns segundos pra fechá-lo.
const CANDLE_CLOSE_GRACE_MS = 5_000;

async function processCandleClose(row, adapter, log) {
  const tag = `${row.symbol} #${row.id}`;
  const cc = row.close_condition;
  if (!cc?.closeAt) {
    await patchIf(row, { status: 'FAILED', error: 'close_condition ausente' });
    return;
  }
  if (Date.now() < cc.closeAt + CANDLE_CLOSE_GRACE_MS) return;

  const candle = await fetchClosedCandle(row.exchange, row.symbol, cc.interval, cc.candleOpenTime);
  if (!candle) {
    // Só some dos últimos 5 candles se o bot ficou fora tempo demais — não compra "de atrasado".
    if (Date.now() > cc.closeAt + 4 * intervalMs(cc.interval)) {
      const why = `candle ${cc.interval} de ${fmtBrt(cc.candleOpenTime)} não encontrado (bot ficou fora?)`;
      await patchIf(row, { status: 'FAILED', error: why });
      log(`⚠️  [OCO manual] ${tag}: ${why} — compra abortada`);
      notify(`⚠️ OCO manual ${row.symbol}: ${why} — compra abortada`, log);
    }
    return;
  }

  const closeTxt = `candle ${cc.interval} fechou às ${fmtBrt(cc.closeAt)} em ${fmt(candle.close)}`;
  const pattern = bearishClosePattern(candle, candle.prev);
  if (pattern) {
    const why = `${closeTxt} formando ${pattern} (padrão de baixa)`;
    if (!await patchIf(row, { status: 'CLOSED', error: why })) return;
    log(`⏹️  [OCO manual] ${tag}: ${why} — não comprou`);
    notify(`⏹️ OCO manual ${row.symbol}: ${why} — NÃO comprou (a alta não se manteve).`, log);
    return;
  }

  // Ordens da Explosão de Alta automática (breakout-auto/bullishBreakoutAuto.js): o scanner achou a
  // explosão com o candle ABERTO — confere se ela continuou valendo no candle fechado.
  let bullish = null;
  // Registro do fechamento (só Explosão automática): qual regra autorizou e o padrão de alta do
  // candle — a seta do gráfico (GET /bullish-breakout/signals) mostra "entrou por martelo" etc.
  let closeCheck = null;
  if (cc.confirmBreakout) {
    const opts = { ...cc.confirmBreakout, interval: cc.interval, closedOnly: false };
    const history = (await fetchKlines(row.symbol, cc.interval, opts.lookback + 6))
      .filter((k) => Number(k.openTime) <= cc.candleOpenTime);
    const isCandle = Number(history[history.length - 1]?.openTime) === cc.candleOpenTime;
    let confirmed = isCandle && evaluateBullishBreakout(history, opts);
    // v1.187.0: fechou num padrão de ALTA (martelo, engolfo, estrela da manhã…) → o corpo mínimo
    // (minBodyPct, 5%) deixa de valer; volume, fechamento no alto e rompimento continuam exigidos.
    if (!confirmed && isCandle) {
      bullish = bullishClosePattern(candle, candle.prev, cc.bullishPatterns ?? null);
      confirmed = !!bullish && evaluateBullishBreakout(history, { ...opts, minBodyPct: 0 });
    }
    const bodyPct = ((candle.close - candle.open) / candle.open) * 100;
    const authorizedBy = !confirmed ? null : (bullish ? 'pattern' : 'body');
    closeCheck = {
      authorizedBy,
      bullishPattern: bullish ?? bullishClosePattern(candle, candle.prev, cc.bullishPatterns ?? null),
      bodyPct: Math.round(bodyPct * 100) / 100,
    };
    if (!confirmed) {
      const why = `${closeTxt} (corpo ${bodyPct >= 0 ? '+' : ''}${bodyPct.toFixed(2)}%${bullish ? `, ${bullish}` : ''}) — a explosão não se confirmou no fechamento`;
      if (!await patchIf(row, { status: 'CLOSED', error: why, close_condition: { ...cc, closeCheck } })) return;
      log(`⏹️  [OCO manual] ${tag}: ${why} — não comprou`);
      notify(`⏹️ Explosão de Alta ${row.symbol}: ${why} — NÃO comprou.`, log);
      return;
    }
  }

  // Filtros de mercado (v1.191.0, close_condition.regime — Configurações → Price action): BTC 4h >
  // EMA50, moeda > EMA20 1d, MACD 4h > 0, EMA20 1d do BTC subindo, top N altas 24h — no FECHAMENTO
  // do candle, só com candles 4h/1d já fechados. Ordens antigas sem `regime` não passam por aqui.
  if (cc.regime) {
    const rg = await checkMarketRegime(row.symbol, cc.closeAt, cc.regime);
    closeCheck = { ...(closeCheck ?? {}), regime: { ok: rg.ok, reason: rg.reason ?? null, ...rg.details } };
    if (!rg.ok) {
      const why = `${closeTxt} — filtro de mercado barrou: ${rg.reason}`;
      if (!await patchIf(row, { status: 'CLOSED', error: why, close_condition: { ...cc, closeCheck } })) return;
      log(`⏹️  [OCO manual] ${tag}: ${why} — não comprou`);
      notify(`⏹️ Explosão de Alta ${row.symbol}: ${why} — NÃO comprou.`, log);
      return;
    }
  }

  // Entrada com desconto (Explosão automática, close_condition.entryDiscount): não compra agora —
  // vira entry_kind 'limit' X% abaixo do fechamento, vigiada pelo ramo 'limit' de processRow até
  // limitExpiresAt. O candle fechado vai junto (exitCandle) pra OCO usar a metade DELE no fill.
  const disc = cc.entryDiscount;
  if (disc && Number(disc.discountPct) > 0) {
    const limitPrice = Number(candle.close) * (1 - Number(disc.discountPct) / 100);
    const expiresAt = cc.closeAt + Number(disc.waitHours || 12) * 3600_000;
    const exitCandle = { high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) };
    const lv = discountLevels(row, limitPrice, exitCandle);
    const ok = await patchIf(row, {
      entry_kind: 'limit', entry_price: limitPrice, target_price: lv.target, stop_price: lv.stop,
      close_condition: { ...cc, exitCandle, limitExpiresAt: expiresAt, ...(closeCheck && { closeCheck }) },
    });
    if (!ok) return;
    const label = cc.source ? 'Explosão de Alta' : 'OCO manual';
    const txt = `${closeTxt}, ${cc.confirmBreakout ? 'explosão confirmada' : 'sem padrão de baixa'} — entrada armada ${disc.discountPct}% abaixo, em ${fmt(limitPrice)}, até ${fmtBrt(expiresAt)}`;
    log(`🎯 [OCO manual] ${tag}: ${txt}`);
    notify(`🎯 ${label} ${row.symbol}: ${txt} · alvo ${fmt(lv.target)} / stop ${fmt(lv.stop)} (relativos ao preço comprado).`, log);
    return;
  }

  if (closeCheck) {
    // Status OPEN → o próprio PATCH condicional evita gravar por cima de um cancelamento no meio.
    if (!await patchIf(row, { close_condition: { ...cc, closeCheck } })) return;
  }
  const usdt = Number(row.usdt);
  log(`✅ [OCO manual] ${tag}: ${closeTxt}, sem padrão de baixa${bullish ? ` — fechou em ${bullish} (corpo < mínimo, autorizado pelo padrão de alta)` : ''} — comprando ${usdt} USDT a mercado`);
  let fill;
  try {
    fill = await adapter.marketBuy(usdt);
  } catch (err) {
    await patchIf(row, { status: 'FAILED', error: err.message });
    log(`❌ [OCO manual] ${tag}: compra a mercado falhou — ${err.message}`);
    notify(`❌ OCO manual ${row.symbol}: ${closeTxt} (segurou o preço) mas a compra de ${usdt} USDT falhou (${err.message}) — ${buyFailHint(err)}`, log);
    return;
  }
  await recordFill(await withExitRule(row, fill, candle), adapter, fill, log);
}

/** Níveis da OCO ao armar a entrada com desconto. Com close_condition.exit (Explosão automática):
 *  regra própria (alvo +X%, stop na metade do candle). Sem ela (OCO manual do gráfico): os MESMOS %
 *  que o usuário desenhou (alvo/stop ÷ entrada da linha), agora sobre o preço da limite — antes caía
 *  no padrão do automático e sobrescrevia o alvo/stop desenhados. */
function discountLevels(row, limitPrice, exitCandle) {
  const cc = row.close_condition;
  if (cc?.exit) return exitLevels(limitPrice, exitCandle, cc.exit);
  const entry = Number(row.entry_price);
  const target = Number(row.target_price);
  const stop = Number(row.stop_price);
  if (!(entry > 0 && target > entry && stop > 0 && stop < entry)) return exitLevels(limitPrice, exitCandle);
  return { target: limitPrice * (target / entry), stop: applyMinStop(limitPrice * (stop / entry), limitPrice) };
}

/** Regra de saída própria (Explosão automática): alvo +X% e stop na metade do candle de explosão,
 *  com distância mínima, sobre o preço REAL comprado. Grava como entrada = preço comprado, então
 *  bracketLevels devolve os níveis exatos — e um restart no meio (FILLED) recoloca a MESMA OCO. */
async function withExitRule(row, fill, candle) {
  const cc = row.close_condition;
  if (!cc?.exit || !candle || !(Number(fill.avgPrice) > 0)) return row;
  const lv = exitLevels(Number(fill.avgPrice), candle, cc.exit);
  const levels = { entry_price: Number(fill.avgPrice), target_price: lv.target, stop_price: lv.stop };
  await sbReq('PATCH', TABLE, levels, `?id=eq.${row.id}`);
  return { ...row, ...levels };
}

const MARTINGALE_SOURCE = 'bullish_breakout_martingale';

// Dono de cada passo do processOnDrop. Caso AIGENSYN #300 (22/11/2026): DOIS processos do bot
// rodando juntos executaram o "Martingale agora" ao mesmo tempo — 2 OCOs na 1ª compra, 2 compras
// de martingale e a 2ª filha sem saldo pra OCO (OCO_FAILED). Agora cada passo é REIVINDICADO com
// PATCH condicionado ao estágio atual (+ dono): só um processo avança; o outro desiste. Um passo
// em andamento ('moving'/'buying') de OUTRO processo só é retomado depois de DROP_LEASE_MS sem
// avanço (restart de verdade), nunca enquanto o outro ainda pode estar no meio.
const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const DROP_LEASE_MS = 3 * 60_000;

/** Filtro PostgREST: dropState no banco ainda é o que este processo leu (estágio + dono). */
function dropStateFilter(st) {
  if (!st) return '&close_condition->dropState=is.null';
  let f = `&close_condition->dropState->>stage=eq.${encodeURIComponent(st.stage)}`;
  if (st.owner) f += `&close_condition->dropState->>owner=eq.${encodeURIComponent(st.owner)}`;
  return f;
}

/** Uma perna da OCO executou → CLOSED_TARGET / CLOSED_STOP + aviso de venda. */
async function closeBracketed(row, r, log) {
  const exit = { kind: r.filled, soldQty: r.soldQty, usdtOut: r.usdtOut, exitPrice: r.exitPrice, at: new Date().toISOString(), notified: false };
  const status = r.filled === 'target' ? 'CLOSED_TARGET' : 'CLOSED_STOP';
  const ok = await patchIf(row, { status, exit });
  if (!ok) return;
  await notifyExit({ ...row, status, exit }, log);
}

/**
 * Regra de queda da Explosão automática (close_condition.exit.onDrop — Configurações → Price action,
 * espelho da caixa Price action do gráfico). Com a posição BRACKETED, o preço caiu `dropPct`% abaixo
 * do preço comprado:
 *   1. alvo → entrada: cancela a OCO e recoloca com alvo = preço comprado, MESMO stop;
 *   2. 'martingale': compra mais `martingaleUsdt` a mercado e grava uma ordem FILHA (status FILLED,
 *      entry_kind 'market', source MARTINGALE_SOURCE, parentId) com alvo = preço da 1ª compra e stop
 *      −martingaleStopPct% do preço da 2ª — o fluxo normal coloca a OCO dela, vigia e avisa.
 * Crash-safety: cada passo grava `close_condition.dropState.stage` ANTES de mexer na corretora:
 *   moving → (cancela + recoloca a OCO) → moved → buying → (compra + filha) → done.
 *   Restart em 'moving' refaz (cancelar é idempotente; se uma perna executou no meio, fecha normal).
 *   Restart em 'buying' NÃO recompra (a compra pode ter saído) → 'failed' + aviso pra conferir.
 */
async function processOnDrop(row, adapter, log) {
  const cc = { ...(row.close_condition ?? {}) };
  const od = cc.exit?.onDrop;
  if (!od || !['breakeven', 'martingale'].includes(od.mode) || !row.bracket) return;
  // Rebaixamento do stop trocando a OCO agora (maybeLowerStop, segundos): espera ele terminar e
  // roda no próximo passe com o bracket novo — a regra (−dropPct% / "Martingale agora") não muda.
  if (cc.stopLower) return;
  const tag = `${row.symbol} #${row.id}`;
  const avg = Number(row.fill?.avgPrice);
  const qty = Number(row.fill?.filledQty);
  if (!(avg > 0) || !(qty > 0)) return;
  let st = cc.dropState ?? null;
  const dropTxt = () => (st?.forced ? 'martingale adiantado no gráfico' : `caiu ${od.dropPct}%`);
  if (st && ['done', 'failed'].includes(st.stage)) return;
  // Grava o próximo passo, condicionado ao status (o "Vender agora" no meio interrompe) E ao
  // dropState lido (outro processo que avançou antes faz este desistir — ver INSTANCE_ID).
  const save = async (next, extra = {}) => {
    const claimed = { ...next, owner: INSTANCE_ID, ownedAt: new Date().toISOString() };
    const close_condition = { ...cc, dropState: claimed };
    // + nenhum rebaixamento de stop começou em outro processo depois da leitura (stopLower).
    if (!await patchIf(row, { ...extra, close_condition }, `${dropStateFilter(st)}&close_condition->stopLower=is.null`)) {
      log(`⏸️  [OCO manual] ${tag}: passo '${next.stage}' da queda já foi pego por outro processo — este desiste`);
      return false;
    }
    next = claimed;
    cc.dropState = next;
    row = { ...row, ...extra, close_condition };
    st = next;
    return true;
  };

  if (!st) {
    const trigger = avg * (1 - Number(od.dropPct) / 100);
    const price = await fetchLivePrice(row.exchange, row.symbol);
    // forceDrop = "Martingale agora" do gráfico (POST /manual-oco-orders/:id/drop-now): dispara sem
    // esperar os −dropPct%, desde que o preço ainda esteja abaixo da compra (alvo vai pra entrada).
    const forced = !!cc.forceDrop;
    if (forced && !(price < avg)) {
      const { forceDrop, ...rest } = cc;
      await patchIf(row, { close_condition: rest });
      log(`⏭️  [OCO manual] ${tag}: martingale adiantado ignorado — preço ${fmt(price)} voltou pra cima da compra ${fmt(avg)}`);
      notify(`⏭️ Explosão de Alta ${row.symbol}: o adiantamento do ${od.mode === 'martingale' ? 'martingale' : 'alvo na entrada'} foi ignorado — o preço (${fmt(price)}) voltou pra cima da compra (${fmt(avg)}). A regra normal (−${od.dropPct}%) segue valendo.`, log);
      return;
    }
    if (!forced && !(price <= trigger)) return;
    // origTarget: o gráfico segue desenhando a OCO completa (verde até ele) depois do alvo ir pra entrada.
    const origTarget = Number(row.bracket.targetPrice ?? row.target_price) || null;
    if (!await save({ stage: 'moving', at: new Date().toISOString(), price, origTarget, ...(forced && { forced: true }) })) return;
    const why = forced
      ? `ADIANTADO pelo gráfico a ${fmtDropPct(price, avg)} (regra: −${od.dropPct}%)`
      : `caiu ${od.dropPct}% (${fmt(price)} ≤ ${fmt(trigger)})`;
    log(`📉 [OCO manual] ${tag}: ${why} — movendo o alvo pra entrada ${fmt(avg)}${od.mode === 'martingale' ? ' + martingale' : ''}`);
  } else if (['moving', 'buying'].includes(st.stage) && st.owner !== INSTANCE_ID) {
    // Passo em andamento gravado por OUTRO processo: enquanto o prazo não vence, ele pode estar no
    // meio (cancelando/recolocando a OCO, comprando) — não mexe. Venceu (restart) → reivindica e retoma.
    const age = Date.now() - Date.parse(st.ownedAt ?? st.at ?? 0);
    if (st.owner && age < DROP_LEASE_MS) return;
    if (!await save({ ...st })) return;
  }

  if (st.stage === 'moving') {
    await adapter.cancelExitBracket(row.bracket);
    const r = await adapter.pollExitBracket(row.bracket).catch(() => null);
    if (r?.filled) { await closeBracketed(row, r, log); return; }
    const stop = Number(row.bracket.stopPrice ?? row.stop_price);
    let bracket;
    try {
      bracket = await adapter.placeExitBracket(qty, avg, stop);
    } catch (err) {
      // Não deu pra recolocar com o alvo na entrada → volta a OCO original (a posição não fica sem stop).
      let orig;
      try {
        orig = await adapter.placeExitBracket(qty, Number(row.bracket.targetPrice ?? row.target_price), stop);
      } catch (err2) {
        await patchIf(row, {
          status: 'OCO_FAILED', error: `queda de ${od.dropPct}%: OCO cancelada e não recolocada (${err2.message})`,
          close_condition: { ...cc, dropState: { ...st, stage: 'failed', error: err2.message } },
        });
        log(`❌ [OCO manual] ${tag}: OCO cancelada pra mover o alvo e NÃO recolocada — ${err2.message}`);
        notify(`🚨 Explosão de Alta ${row.symbol}: ${dropTxt()}, a OCO foi cancelada pra mover o alvo e NÃO foi recolocada (${err2.message}) — posição SEM stop/alvo, proteja manualmente.`, log);
        return;
      }
      await sbReq('PATCH', TABLE, {
        bracket: orig, close_condition: { ...cc, dropState: { ...st, stage: 'failed', error: err.message } }, updated_at: new Date().toISOString(),
      }, `?id=eq.${row.id}`);
      log(`⚠️  [OCO manual] ${tag}: não deu pra pôr o alvo na entrada (${err.message}) — OCO original recolocada`);
      notify(`⚠️ Explosão de Alta ${row.symbol}: ${dropTxt()} mas não deu pra mover o alvo pra entrada (${err.message}) — OCO original recolocada, sem martingale.`, log);
      return;
    }
    // Guarda o stop DESEJADO (pedido antes do clamp da Binance) pro rebaixamento seguir depois.
    const want = desiredStop(row);
    if (want) bracket = { ...bracket, desiredStopPrice: want };
    const next = { ...st, stage: od.mode === 'martingale' ? 'moved' : 'done', movedAt: new Date().toISOString(), ownedAt: new Date().toISOString(), target: bracket.targetPrice };
    const close_condition = { ...cc, dropState: next };
    // Incondicional (como o fill): a OCO nova JÁ está na corretora — perder o handle a deixaria órfã.
    await sbReq('PATCH', TABLE, { bracket, target_price: bracket.targetPrice, close_condition, updated_at: new Date().toISOString() }, `?id=eq.${row.id}`);
    cc.dropState = next;
    st = next;
    row = { ...row, bracket, target_price: bracket.targetPrice, close_condition };
    log(`🎯 [OCO manual] ${tag}: alvo movido pra entrada — OCO alvo ${fmt(bracket.targetPrice)} / stop ${fmt(bracket.stopPrice)}`);
    notify(`📉 Explosão de Alta ${row.symbol}: ${dropTxt()} — alvo movido pra entrada (${fmt(bracket.targetPrice)}), stop segue em ${fmt(bracket.stopPrice)}.`, log);
    if (od.mode !== 'martingale') return;
  }

  if (st.stage === 'buying') {
    // Caiu no meio da compra do martingale: não sabe se a compra saiu → não recompra.
    await save({ ...st, stage: 'failed', error: 'reinício no meio da compra do martingale' });
    log(`⚠️  [OCO manual] ${tag}: reinício no meio da compra do martingale — confira o saldo na corretora (2ª compra pode estar sem OCO)`);
    notify(`⚠️ Explosão de Alta ${row.symbol}: o bot reiniciou no meio da compra do martingale — confira na corretora se a 2ª compra saiu (pode estar SEM OCO).`, log);
    return;
  }

  if (st.stage === 'moved') {
    const usdt2 = Number(od.martingaleUsdt);
    if (!await save({ ...st, stage: 'buying' })) return;
    let fill2;
    try {
      fill2 = await adapter.marketBuy(usdt2);
    } catch (err) {
      await save({ ...st, stage: 'failed', error: err.message });
      log(`❌ [OCO manual] ${tag}: martingale de ${usdt2} USDT falhou — ${err.message}`);
      notify(`❌ Explosão de Alta ${row.symbol}: martingale de ${usdt2} USDT falhou (${err.message}) — ${buyFailHint(err)}. A 1ª compra segue com o alvo na entrada.`, log);
      return;
    }
    const clean = { filledQty: fill2.filledQty, quoteQty: fill2.quoteQty, avgPrice: fill2.avgPrice, at: new Date().toISOString() };
    const avg2 = Number(fill2.avgPrice);
    const stop2 = avg2 * (1 - Number(od.martingaleStopPct) / 100);
    let child = null;
    try {
      [child] = await sbReq('POST', TABLE, {
        symbol: row.symbol, exchange: row.exchange, usdt: usdt2,
        entry_price: avg2, target_price: avg, stop_price: stop2,
        entry_kind: 'market', status: 'FILLED', fill: clean,
        close_condition: {
          source: MARTINGALE_SOURCE, parentId: row.id,
          interval: cc.interval, candleOpenTime: cc.candleOpenTime,
          martingale: { dropPct: od.dropPct, stopPct: od.martingaleStopPct, parentEntry: avg },
        },
      }) ?? [];
    } catch (err) {
      log(`❌ [OCO manual] ${tag}: martingale comprou mas a ordem filha não foi gravada — ${err.message}`);
    }
    // Incondicional: a compra já saiu na corretora.
    const done = { ...st, stage: 'done', childId: child?.id ?? null, fill: clean };
    await sbReq('PATCH', TABLE, { close_condition: { ...cc, dropState: done }, updated_at: new Date().toISOString() }, `?id=eq.${row.id}`);
    log(`➕ [OCO manual] ${tag}: martingale comprou ${fmt(clean.filledQty)} a ~${fmt(avg2)} (${usdt2} USDT) — ordem #${child?.id ?? '?'}: alvo ${fmt(avg)} / stop ${fmt(stop2)}`);
    if (!child) {
      notify(`🚨 Explosão de Alta ${row.symbol}: martingale COMPROU ${fmt(clean.filledQty)} a ~${fmt(avg2)} mas a ordem não foi gravada — 2ª compra SEM OCO, proteja manualmente.`, log);
      return;
    }
    await placeBracket({ ...child, status: 'FILLED' }, adapter, clean, log);
  }
}

/**
 * Stop DESEJADO da OCO quando a Binance prendeu o pedido na faixa PERCENT_PRICE_BY_SIDE (perna de
 * venda ≥ askMultiplierDown × preço médio de 5 min — 0,8 nos pares USDT, ou seja, no máx. ~−20%
 * do preço atual): pediu −30%, ficou em −20%. null = stop já é o pedido (nada pra rebaixar).
 */
function desiredStop(row) {
  const b = row.bracket;
  if (!b) return null;
  if (Number(b.desiredStopPrice) > 0) return Number(b.desiredStopPrice);
  return b.clamped?.stop && Number(b.requestedStopPrice) > 0 ? Number(b.requestedStopPrice) : null;
}

const LOWER_STOP_EVERY_MS = 60_000; // no máx. 1 tentativa/min por ordem
const LOWER_STOP_MIN_STEP_PCT = 2; // só troca a OCO se o stop desce ≥ 2% do preço comprado (ou chega no desejado)
const LOWER_STOP_LEASE_MS = 3 * 60_000;
const lowerStopLastTry = new Map(); // id → ms

/**
 * Rebaixa o stop PRENDIDO conforme o preço cai: a faixa da Binance é relativa ao preço ATUAL, então
 * um stop de −30% da compra, recusado logo depois dela, passa a caber quando o preço cai ~12,5%.
 * Enquanto o stop gravado estiver acima do desejado, a cada minuto: stop possível agora
 * (binanceLowestOcoStop) → se desce ≥ LOWER_STOP_MIN_STEP_PCT% (ou chega no desejado), cancela a
 * OCO e recoloca com o MESMO alvo e o stop novo. Nunca sobe o stop. Só Binance.
 *
 * Martingale tem PRIORIDADE e as regras dele não mudam: não age com a regra de queda em andamento
 * (dropState ≠ done/failed), com "Martingale agora" pedido (forceDrop) nem com o preço já no gatilho
 * (−dropPct%) — o martingale roda primeiro. Exclusão entre processos: reivindica com PATCH
 * condicionado (close_condition.stopLower is null + dropState lido), e o processOnDrop só reivindica
 * com stopLower vazio. Crash no meio (marca velha, de outro processo, > LOWER_STOP_LEASE_MS): confere
 * a OCO antiga e recoloca se ela sumiu.
 * @returns true se trocou a OCO (ou reconciliou) neste passe.
 */
async function maybeLowerStop(row, adapter, log) {
  if (row.exchange === 'gate' || !row.bracket?.orderListId) return false;
  const cc = row.close_condition ?? {};
  const tag = `${row.symbol} #${row.id}`;
  const avg = Number(row.fill?.avgPrice);
  const qty = Number(row.fill?.filledQty);
  if (!(avg > 0) || !(qty > 0)) return false;
  const want = desiredStop(row);
  const target = Number(row.bracket.targetPrice ?? row.target_price);

  // Marca de rebaixamento em andamento.
  if (cc.stopLower) {
    const age = Date.now() - Date.parse(cc.stopLower.at ?? 0);
    if (cc.stopLower.owner === INSTANCE_ID || age < LOWER_STOP_LEASE_MS) return false;
    // Outro processo caiu no meio: a OCO antiga pode ter sido cancelada sem a nova.
    const r = await adapter.pollExitBracket(row.bracket).catch(() => null);
    if (r?.filled) {
      const { stopLower, ...rest } = cc;
      await closeBracketed({ ...row, close_condition: rest }, r, log);
      return true;
    }
    try {
      const bracket = await adapter.placeExitBracket(qty, target, want ?? Number(row.bracket.stopPrice));
      await sbReq('PATCH', TABLE, {
        bracket: { ...bracket, ...(want && { desiredStopPrice: want }) },
        close_condition: (({ stopLower, ...rest }) => rest)(cc), updated_at: new Date().toISOString(),
      }, `?id=eq.${row.id}`);
      log(`🔧 [OCO manual] ${tag}: rebaixamento do stop interrompido — OCO recolocada (alvo ${fmt(bracket.targetPrice)} / stop ${fmt(bracket.stopPrice)})`);
    } catch (err) {
      // Provavelmente a OCO nova SAIU (saldo travado nela) — o "Revisar OCO" adota/corrige.
      await sbReq('PATCH', TABLE, {
        status: 'OCO_FAILED', error: `rebaixamento do stop interrompido: ${err.message} — use "Revisar OCO"`,
        close_condition: (({ stopLower, ...rest }) => rest)(cc), updated_at: new Date().toISOString(),
      }, `?id=eq.${row.id}`);
      log(`❌ [OCO manual] ${tag}: rebaixamento do stop interrompido e a OCO não foi recolocada — ${err.message}`);
      notify(`🚨 OCO manual ${row.symbol}: o rebaixamento do stop foi interrompido e a OCO não pôde ser recolocada (${err.message}). Confira no gráfico com "Revisar OCO".`, log);
    }
    return true;
  }

  const cur = Number(row.bracket.stopPrice);
  if (!(want > 0) || !(cur > want)) return false;
  const st = cc.dropState;
  if (cc.forceDrop || (st && !['done', 'failed'].includes(st.stage))) return false; // martingale primeiro
  const now = Date.now();
  if (now - (lowerStopLastTry.get(row.id) ?? 0) < LOWER_STOP_EVERY_MS) return false;
  lowerStopLastTry.set(row.id, now);

  const od = cc.exit?.onDrop;
  if (!st && od && ['breakeven', 'martingale'].includes(od.mode)) {
    const price = await fetchLivePrice(row.exchange, row.symbol);
    if (price <= avg * (1 - Number(od.dropPct) / 100)) return false; // gatilho do martingale: ele vai antes
  }
  const floor = await binanceLowestOcoStop(row.symbol);
  if (!(floor > 0)) return false;
  const next = Math.max(want, floor);
  const reachesWant = next <= want * 1.0005;
  if (!(next < cur)) return false;
  if (!reachesWant && ((cur - next) / avg) * 100 < LOWER_STOP_MIN_STEP_PCT) return false;

  // Reivindica (exclusão com outro processo e com o processOnDrop).
  const mark = { owner: INSTANCE_ID, at: new Date().toISOString(), fromListId: row.bracket.orderListId };
  const claimed = await patchIf(row, { close_condition: { ...cc, stopLower: mark } },
    `&close_condition->stopLower=is.null${dropStateFilter(st ?? null)}&bracket->>orderListId=eq.${row.bracket.orderListId}`);
  if (!claimed) return false;
  const clearMark = (({ stopLower, ...rest }) => rest)(cc);

  await adapter.cancelExitBracket(row.bracket);
  const r = await adapter.pollExitBracket(row.bracket).catch(() => null);
  if (r?.filled) { await closeBracketed({ ...row, close_condition: clearMark }, r, log); return true; }
  let bracket;
  try {
    bracket = await adapter.placeExitBracket(qty, target, want);
  } catch (err) {
    // Não coube → volta a OCO de antes (a posição não fica sem stop).
    try {
      bracket = await adapter.placeExitBracket(qty, target, cur);
    } catch (err2) {
      await sbReq('PATCH', TABLE, {
        status: 'OCO_FAILED', error: `rebaixando o stop: OCO cancelada e não recolocada (${err2.message})`,
        close_condition: clearMark, updated_at: new Date().toISOString(),
      }, `?id=eq.${row.id}`);
      log(`❌ [OCO manual] ${tag}: OCO cancelada pra rebaixar o stop e NÃO recolocada — ${err2.message}`);
      notify(`🚨 OCO manual ${row.symbol}: a OCO foi cancelada pra rebaixar o stop e NÃO foi recolocada (${err2.message}) — posição SEM stop/alvo, proteja manualmente.`, log);
      return true;
    }
    await sbReq('PATCH', TABLE, {
      bracket: { ...bracket, desiredStopPrice: want }, close_condition: clearMark, updated_at: new Date().toISOString(),
    }, `?id=eq.${row.id}`);
    lowerStopLastTry.set(row.id, Date.now() + 9 * 60_000); // próxima tentativa em ~10 min
    log(`⚠️  [OCO manual] ${tag}: não deu pra rebaixar o stop (${err.message}) — OCO anterior recolocada`);
    return true;
  }
  // Incondicional: a OCO nova JÁ está na corretora — perder o handle a deixaria órfã.
  const saved = { ...bracket, desiredStopPrice: want };
  await sbReq('PATCH', TABLE, {
    bracket: saved, close_condition: clearMark, updated_at: new Date().toISOString(),
  }, `?id=eq.${row.id}`);
  const pctTxt = `${(((bracket.stopPrice - avg) / avg) * 100).toFixed(1)}%`;
  const done = !(saved.clamped?.stop);
  log(`⤵️  [OCO manual] ${tag}: stop rebaixado ${fmt(cur)} → ${fmt(bracket.stopPrice)} (${pctTxt} da compra)${done ? ' — chegou no stop pedido' : ` — segue até ${fmt(want)}`}`);
  notify(`⤵️ OCO manual ${row.symbol}: stop rebaixado de ${fmt(cur)} pra ${fmt(bracket.stopPrice)} (${pctTxt} da compra)${done ? ' — chegou no stop pedido.' : `; a Binance ainda limita, segue descendo até ${fmt(want)} se o preço cair.`} Alvo segue em ${fmt(bracket.targetPrice)}.`, log);
  return true;
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
    // Mudando a OCO no meio (queda → alvo na entrada / rebaixando o stop): a OCO gravada pode já
    // estar cancelada.
    if (row.close_condition?.dropState?.stage !== 'moving' && !row.close_condition?.stopLower) {
      const r = await adapter.pollExitBracket(row.bracket);
      if (r?.filled) { await closeBracketed(row, r, log); return; }
    }
    // Rebaixou o stop neste passe → a regra de queda roda no próximo, já com o bracket novo.
    if (await maybeLowerStop(row, adapter, log)) return;
    await processOnDrop(row, adapter, log);
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
    const cc = row.close_condition;
    log(row.entry_kind === 'candle_close' && cc
      ? `👀 [OCO manual] ${tag}: espera o candle ${cc.interval} fechar às ${fmtBrt(cc.closeAt)} — compra a mercado se não fechar em padrão de baixa (${usdt} USDT)`
      : `👀 [OCO manual] ${tag}: vigiando ${row.entry_kind === 'trigger' ? 'rompimento' : 'queda'} até ${fmt(entry)} (${usdt} USDT)`);
    return;
  }

  // Compra no fechamento do candle: espera o candle do pedido fechar e compra a mercado só se ele
  // NÃO fechou num padrão de baixa (a alta se manteve). Padrão de baixa → CLOSED.
  if (row.entry_kind === 'candle_close') {
    await processCandleClose(row, adapter, log);
    return;
  }

  // Tipo de entrada que esta versão não conhece (painel mais novo que o bot): NÃO compra. Antes caía
  // no ramo 'limit' abaixo — a ADX #141 ('candle_close' criada antes do bot ser atualizado) comprou
  // na hora em vez de esperar o fechamento.
  if (!KNOWN_ENTRY_KINDS.has(row.entry_kind)) {
    if (!unknownKindWarned.has(row.id)) {
      unknownKindWarned.add(row.id);
      log(`⚠️  [OCO manual] ${tag}: entry_kind '${row.entry_kind}' desconhecido — atualize o bot; ordem ignorada até lá`);
    }
    return;
  }

  // OPEN sem buy_handle: nada na corretora — o bot vigia o preço e compra A MERCADO quando ele
  // chega na entrada ('trigger' sobe até ela, 'limit' cai até ela). Assim o saldo só é usado na
  // hora da compra e dá pra ter mais ordens pendentes do que saldo.
  if (!row.buy_handle) {
    // Entrada com prazo (Explosão automática com desconto): passou de limitExpiresAt sem encher → CLOSED.
    const expiresAt = Number(row.close_condition?.limitExpiresAt);
    if (expiresAt > 0 && Date.now() > expiresAt) {
      const why = `entrada em ${fmt(entry)} expirou às ${fmtBrt(expiresAt)} sem o preço cair até ela`;
      if (!await patchIf(row, { status: 'CLOSED', error: why })) return;
      log(`⌛ [OCO manual] ${tag}: ${why} — não comprou`);
      notify(`⌛ ${row.close_condition?.source ? 'Explosão de Alta' : 'OCO manual'} ${row.symbol}: ${why} — NÃO comprou.`, log);
      return;
    }
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
      notify(`❌ OCO manual ${row.symbol}: preço chegou na entrada (${fmt(entry)}) mas a compra de ${usdt} USDT falhou (${err.message}) — ${buyFailHint(err)}`, log);
      return;
    }
    await recordFill(await withExitRule(row, fill, row.close_condition?.exitCandle), adapter, fill, log);
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

/** Ordens vivas → price-action-status.json (o /log do WhatsApp resume daqui). Best-effort. */
function journalOrders(rows) {
  writePriceActionPart('orders', {
    list: rows.map((r) => {
      const cc = r.close_condition ?? {};
      return {
        id: r.id, symbol: r.symbol, status: r.status, source: cc.source ?? 'manual', entryKind: r.entry_kind,
        usdt: Number(r.usdt) || null,
        entry: Number(r.fill?.avgPrice ?? r.entry_price) || null,
        boughtAt: r.fill?.at ?? null,
        target: Number(r.bracket?.targetPrice ?? r.target_price) || null,
        stop: Number(r.bracket?.stopPrice ?? r.stop_price) || null,
        closeAt: cc.closeAt ?? null,
        parentId: cc.parentId ?? null,
        dropStage: cc.dropState?.stage ?? null,
        forceDrop: !!cc.forceDrop,
      };
    }),
  });
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
      journalOrders(rows ?? []);
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

module.exports = { startManualOcoWatcher, MARTINGALE_SOURCE, _test: { processRow, bracketLevels, discountLevels, processOnDrop } };
