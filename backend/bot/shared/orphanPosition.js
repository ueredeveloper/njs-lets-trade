'use strict';

/**
 * Detecta posições "órfãs": a corretora tem saldo do ativo mas o Supabase acha que o bot
 * está WATCHING (buy_price/buy_qty null). Acontece quando o processo cai/reinicia entre o
 * fill da compra e o saveState que marca phase=BOUGHT — recordBuyFill (tradeExecution.js)
 * grava `session.phase = 'BOUGHT'` em memória ANTES do await saveState(...); se o processo
 * reiniciar nesse meio-tempo, a marca em memória some e o Supabase nunca chegou a ser
 * atualizado. Sem essa checagem o bot esquece que já comprou e tenta comprar de novo no
 * próximo sinal (caso real: 龙虾USDT comprou duas vezes em 63s no bollinger-bands-bot, sem
 * nunca virar BOUGHT nem colocar a bracket TP/SL — só percebido porque o usuário notou).
 *
 * Reconstrói o preço médio da posição aberta via FIFO sobre os trades próprios recentes
 * (compra entra numa fila, venda consome do início dela — mais correto que média simples
 * quando há round-trips já fechados misturados no histórico recente).
 *
 * Só devolve `confident: true` (o chamador deve adotar a posição de verdade — marcar BOUGHT
 * e colocar a bracket) quando a reconstrução via trades bate com o saldo real. Sem essa
 * confirmação, devolve `confident: false` — o saldo pode ser uma posição manual do usuário
 * sem relação com o bot (comprada fora daquele símbolo favoritado, meses atrás etc.), então
 * o chamador deve só alertar, nunca adotar às cegas usando o preço atual como "preço de
 * compra" inventado.
 */

const OWN_TRADES_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h — cobre o caso comum (processo caiu
                                                     // pouco depois da compra) sem paginar
                                                     // histórico indefinidamente

/** FIFO: cada venda consome do início da fila de compras. O que sobra é a posição aberta. */
function reconstructOpenLotFifo(trades) {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const queue = [];
  for (const t of sorted) {
    if (t.side === 'buy') {
      if (t.qty > 0) queue.push({ qty: t.qty, price: t.price });
      continue;
    }
    let remaining = t.qty;
    while (remaining > 1e-12 && queue.length) {
      const lot = queue[0];
      const consumed = Math.min(lot.qty, remaining);
      lot.qty -= consumed;
      remaining -= consumed;
      if (lot.qty <= 1e-12) queue.shift();
    }
  }
  const qty = queue.reduce((s, l) => s + l.qty, 0);
  if (qty <= 1e-12) return null;
  const cost = queue.reduce((s, l) => s + l.qty * l.price, 0);
  return { qty, avgPrice: cost / qty };
}

/**
 * @param {object} opts
 * @param {object} opts.adapter       adapter da corretora (buildAdapter) — precisa expor
 *                                     getBaseBalance()/getOwnTrades(limit); getOpenOrders()
 *                                     é opcional (ver hasOpenOrders abaixo)
 * @param {number} opts.lastPrice     preço atual, pra converter saldo em USDT
 * @param {number} [opts.minOrphanUsdt=3]  saldo abaixo disso é poeira (taxa/arredondamento),
 *                                     não posição órfã
 * @returns {Promise<null|{confident:boolean, qty:number, avgPrice?:number, hasOpenOrders?:boolean}>}
 */
async function detectOrphanPosition({ adapter, lastPrice, minOrphanUsdt = 3 }) {
  if (typeof adapter.getBaseBalance !== 'function') return null;
  const balance = await adapter.getBaseBalance();
  if (!Number.isFinite(balance) || balance <= 0) return null;
  if (!(lastPrice > 0) || balance * lastPrice < minOrphanUsdt) return null;

  // Se já existe ordem de venda aberta pro símbolo direto na corretora (fora do painel), o
  // chamador não deve colocar bracket automática em cima — o usuário está gerenciando a saída
  // sozinho. `true` também quando a consulta falha (não dá pra confirmar que está livre): mais
  // seguro tratar como "pode ter ordem" do que arriscar duplicar/conflitar com uma que existe.
  let hasOpenOrders = false;
  if (typeof adapter.getOpenOrders === 'function') {
    try {
      const orders = await adapter.getOpenOrders();
      hasOpenOrders = Array.isArray(orders) && orders.some(o => String(o.side ?? '').toLowerCase() === 'sell');
    } catch {
      hasOpenOrders = true;
    }
  }

  if (typeof adapter.getOwnTrades === 'function') {
    try {
      const trades = await adapter.getOwnTrades(200);
      const recent = trades.filter(t => t.time >= Date.now() - OWN_TRADES_LOOKBACK_MS);
      const lot = reconstructOpenLotFifo(recent);
      // Só confia na reconstrução se ela bater com o saldo real (~5% de folga pra taxas).
      if (lot && Math.abs(lot.qty - balance) / balance <= 0.05) {
        return { confident: true, qty: balance, avgPrice: lot.avgPrice, hasOpenOrders };
      }
    } catch { /* segue pro caso não-confiável abaixo */ }
  }

  return { confident: false, qty: balance, hasOpenOrders };
}

module.exports = { detectOrphanPosition, reconstructOpenLotFifo };
