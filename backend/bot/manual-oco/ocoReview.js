'use strict';

/**
 * "Revisar OCO" do cartão da compra (ManualOcoOrdersPanel.jsx → GET/POST
 * /services/manual-oco-orders/:id/oco-review[/fix]). Confere a FAMÍLIA da ordem — a mãe e as filhas
 * do martingale (close_condition.parentId) — contra as OCOs abertas de verdade na Binance e, no fix,
 * conserta o que der:
 *   - OCO DUPLICADA (aberta, sem linha que a conheça, mesma qtd/alvo/stop de uma da família que já
 *     tem a OCO dela aberta) → cancela. Prende saldo e impede a OCO de outra perna.
 *   - Perna SEM OCO (OCO_FAILED, FILLED, ou BRACKETED com a OCO gravada fechada sem executar):
 *       · há uma OCO aberta não rastreada que casa com ela → ADOTA (grava como bracket da linha);
 *       · senão → coloca OCO nova com o alvo/stop da linha (limitada ao saldo livre).
 *   - OCO aberta que ninguém conhece e não casa com nada → só avisa (pode ser de outro bot/manual).
 * Caso que motivou (AIGENSYN #300, 22/11/2026): dois processos do bot executaram o "Martingale agora"
 * juntos → 2 OCOs na 1ª compra, 2 compras e a #301 em OCO_FAILED por falta de saldo.
 * Só Binance (Gate: OCO emulada, sem leitura das legs). Nada de executar no meio da regra de queda.
 */

const MOUNTED = ['BRACKETED', 'OCO_FAILED', 'FILLED'];
const DROP_BUSY = ['moving', 'moved', 'buying'];

/** OCOs abertas do símbolo agrupadas por orderListId: { orderListId, qty, target, stop, legs }. */
function groupOpenOcos(openOrders) {
  const by = new Map();
  for (const o of openOrders ?? []) {
    const id = Number(o.orderListId);
    if (!(id > 0) || o.side !== 'SELL') continue;
    const g = by.get(id) ?? { orderListId: id, qty: 0, target: null, stop: null, legs: {} };
    g.qty = Math.max(g.qty, Number(o.origQty) - Number(o.executedQty || 0));
    if (o.type === 'STOP_LOSS_LIMIT' || Number(o.stopPrice) > 0) { g.stop = Number(o.stopPrice); g.legs.stop = Number(o.orderId); }
    else { g.target = Number(o.price); g.legs.target = Number(o.orderId); }
    by.set(id, g);
  }
  return [...by.values()];
}

const near = (a, b, tol) => a > 0 && b > 0 && Math.abs(a - b) / b <= tol;

/** Níveis que a OCO da linha deve ter: os efetivos da OCO gravada, senão os pedidos. */
function rowLevels(row) {
  return {
    target: Number(row.bracket?.targetPrice ?? row.target_price),
    stop: Number(row.bracket?.stopPrice ?? row.stop_price),
    qty: Number(row.fill?.filledQty),
  };
}

/** A OCO aberta `g` é a desta linha? (qtd até 1% abaixo do comprado — arredondamento de step —
 *  e alvo/stop até 0,5%). */
function matchesRow(g, row) {
  const lv = rowLevels(row);
  return g.qty > 0 && lv.qty > 0 && g.qty <= lv.qty * 1.001 && g.qty >= lv.qty * 0.99
    && near(g.target, lv.target, 0.005) && near(g.stop, lv.stop, 0.005);
}

/**
 * Diagnóstico puro. `family` = linhas da família; `trackedIds` = orderListIds que alguma linha VIVA
 * (manual_oco_orders de qualquer família / rsi_multi_bot_state) conhece; `free` = saldo livre do ativo.
 * Devolve { legs[], duplicates[], unknown[], actions[], busy, ok }.
 */
function diagnose({ family, openOrders, trackedIds, free }) {
  const groups = groupOpenOcos(openOrders);
  const openIds = new Set(groups.map((g) => g.orderListId));
  const tracked = new Set([...(trackedIds ?? [])].map(Number));
  const untracked = groups.filter((g) => !tracked.has(g.orderListId));
  const positions = family.filter((r) => MOUNTED.includes(r.status))
    .sort((a, b) => a.id - b.id);
  const busy = family.some((r) => DROP_BUSY.includes(r.close_condition?.dropState?.stage));

  const legs = positions.map((r) => {
    const lv = rowLevels(r);
    const ownId = Number(r.bracket?.orderListId);
    const ownOpen = r.status === 'BRACKETED' && ownId > 0 && openIds.has(ownId);
    return { id: r.id, status: r.status, parentId: r.close_condition?.parentId ?? null, ...lv,
      orderListId: ownOpen ? ownId : null, ok: ownOpen, row: r };
  });

  const used = new Set();
  const actions = [];
  // Perna sem OCO: adota uma não rastreada que case; senão, OCO nova.
  for (const leg of legs.filter((l) => !l.ok)) {
    const g = untracked.find((x) => !used.has(x.orderListId) && matchesRow(x, leg.row));
    if (g) { used.add(g.orderListId); actions.push({ kind: 'adopt', id: leg.id, oco: g }); }
    else actions.push({ kind: 'place', id: leg.id, qty: leg.qty, target: leg.target, stop: leg.stop });
  }
  // Não rastreada que casa com uma perna que JÁ tem a OCO dela aberta → duplicada.
  const duplicates = [];
  const unknown = [];
  for (const g of untracked.filter((x) => !used.has(x.orderListId))) {
    const twin = legs.find((l) => l.ok && matchesRow(g, l.row));
    if (twin) { duplicates.push({ ...g, twinOf: twin.id }); actions.unshift({ kind: 'cancel', oco: g, twinOf: twin.id }); }
    else unknown.push(g);
  }

  // Saldo: as OCOs novas usam o livre + o que as duplicadas canceladas liberam.
  let avail = Number(free) || 0;
  for (const a of actions) if (a.kind === 'cancel') avail += a.oco.qty;
  for (const a of actions.filter((x) => x.kind === 'place')) {
    a.qty = Math.min(a.qty, avail);
    a.short = a.qty < rowLevels(legs.find((l) => l.id === a.id).row).qty * 0.95;
    avail -= a.qty;
  }

  return {
    legs: legs.map(({ row, ...l }) => l),
    duplicates, unknown, actions, busy, free: Number(free) || 0,
    ok: actions.length === 0,
  };
}

/** Texto curto de cada ação (painel + WhatsApp). */
function describeAction(a) {
  if (a.kind === 'cancel') return `cancelar OCO duplicada ${a.oco.orderListId} (${a.oco.qty} — cópia da #${a.twinOf})`;
  if (a.kind === 'adopt') return `#${a.id}: adotar a OCO ${a.oco.orderListId} que já está aberta`;
  return `#${a.id}: colocar OCO ${a.qty} · alvo ${a.target} / stop ${a.stop}${a.short ? ' (saldo livre menor que o comprado!)' : ''}`;
}

/**
 * Lê tudo e (fix=true) executa as ações. deps: { sb (cliente supabase), adapter (Binance), log }.
 * Devolve { symbol, rootId, before, done[], errors[], after }.
 */
async function reviewOco(id, { fix = false, sb, adapter, table = 'manual_oco_orders' }) {
  const { data: rows, error } = await sb.from(table).select('*').eq('id', id).limit(1);
  if (error) throw new Error(error.message);
  const row = rows?.[0];
  if (!row) { const e = new Error('ordem não encontrada'); e.status = 404; throw e; }
  if (row.exchange === 'gate') { const e = new Error('revisão de OCO só na Binance (Gate: OCO emulada)'); e.status = 409; throw e; }
  const rootId = Number(row.close_condition?.parentId) || row.id;

  const load = async () => {
    const [fam, live, bot] = await Promise.all([
      sb.from(table).select('*').or(`id.eq.${rootId},close_condition->>parentId.eq.${rootId}`),
      sb.from(table).select('id, bracket, status').eq('symbol', row.symbol)
        .in('status', ['FILLED', 'BRACKETED', 'SELLING', 'OCO_FAILED']),
      sb.from('rsi_multi_bot_state').select('rules_state').eq('symbol', row.symbol),
    ]);
    for (const r of [fam, live]) if (r.error) throw new Error(r.error.message);
    const trackedIds = [
      ...(live.data ?? []).map((r) => r.bracket?.orderListId),
      ...(bot.data ?? []).map((r) => r.rules_state?.exitBracket?.orderListId),
    ].filter((x) => Number(x) > 0);
    const [openOrders, free] = await Promise.all([adapter.getOpenOrders(), adapter.getBaseBalance()]);
    return { family: fam.data ?? [], diag: diagnose({ family: fam.data ?? [], openOrders, trackedIds, free }) };
  };

  const { family, diag: before } = await load();
  const out = { symbol: row.symbol, rootId, before: { ...before, steps: before.actions.map(describeAction) }, done: [], errors: [] };
  if (!fix || before.ok) return out;
  if (before.busy) { const e = new Error('a regra de queda (martingale) ainda está em andamento — espere terminar e revise de novo'); e.status = 409; throw e; }

  const byId = new Map(family.map((r) => [r.id, r]));
  const now = () => new Date().toISOString();
  for (const a of before.actions) {
    const r = a.id != null ? byId.get(a.id) : null;
    try {
      if (a.kind === 'cancel') {
        await adapter.cancelExitBracket({ orderListId: a.oco.orderListId });
        out.done.push(describeAction(a));
        continue;
      }
      // Linha mudou desde a leitura (watcher agiu / vendeu) → não mexe.
      const guard = (q) => q.eq('id', r.id).eq('status', r.status).eq('updated_at', r.updated_at);
      if (a.kind === 'adopt') {
        const bracket = { exchange: 'binance', orderListId: a.oco.orderListId, legs: a.oco.legs,
          targetPrice: a.oco.target, stopPrice: a.oco.stop, clamped: null, adoptedAt: now() };
        const { data, error: e } = await guard(sb.from(table)
          .update({ status: 'BRACKETED', bracket, error: null, updated_at: now() })).select();
        if (e) throw new Error(e.message);
        if (!data?.length) throw new Error('a ordem mudou enquanto isso — revise de novo');
        out.done.push(describeAction(a));
        continue;
      }
      // 'place': OCO gravada que fechou SEM executar (cancelada) — confere antes que não foi venda.
      if (r.status === 'BRACKETED' && r.bracket) {
        const p = await adapter.pollExitBracket(r.bracket).catch(() => null);
        if (p?.filled) { out.errors.push(`#${r.id}: a OCO executou (${p.filled}) — o bot fecha a linha sozinho`); continue; }
      }
      if (!(a.qty > 0)) throw new Error('sem saldo livre do ativo pra montar a OCO');
      // Reivindica a linha (condicional ao que foi lido: "Vender agora"/watcher no meio → desiste).
      // FILLED vira OCO_FAILED antes: senão o watcher poria a OCO dele ao mesmo tempo.
      const { data: claimed, error: ce } = await guard(sb.from(table).update({
        ...(r.status === 'FILLED' && { status: 'OCO_FAILED' }), error: 'revisando OCO…', updated_at: now(),
      })).select();
      if (ce) throw new Error(ce.message);
      if (!claimed?.length) throw new Error('a ordem mudou enquanto isso — revise de novo');
      const cur = claimed[0];
      let bracket;
      try {
        bracket = await adapter.placeExitBracket(a.qty, a.target, a.stop);
      } catch (err) {
        await sb.from(table).update({ error: `revisão: OCO não colocada (${err.message})`, updated_at: now() }).eq('id', cur.id);
        throw err;
      }
      // Incondicional: a OCO já está na corretora — perder o handle a deixaria órfã.
      const { error: e } = await sb.from(table)
        .update({ status: 'BRACKETED', bracket, error: null, updated_at: now() }).eq('id', cur.id);
      if (e) throw new Error(`OCO ${bracket.orderListId} colocada mas não gravada (${e.message})`);
      out.done.push(`#${r.id}: OCO colocada ${a.qty} · alvo ${bracket.targetPrice} / stop ${bracket.stopPrice}`);
    } catch (err) {
      out.errors.push(`${describeAction(a)} — FALHOU: ${err.message}`);
    }
  }
  const { diag: after } = await load();
  out.after = { ...after, steps: after.actions.map(describeAction) };
  return out;
}

module.exports = { reviewOco, diagnose, groupOpenOcos, describeAction };
