'use strict';

/**
 * Cancela a ordem TP/SL resting (OCO real na Binance, price_orders emulados na Gate.io — ver
 * buildAdapter.js) de uma posição BOUGHT antes de uma venda manual a mercado disparada pelo
 * botão "Vender" do painel Multi-Trade (ver /binance-order e /gate-order em
 * backend/services/). Sem isso a quantidade fica presa (locked) na ordem resting e a venda
 * manual só consegue vender o troco livre — ou falha por saldo insuficiente.
 *
 * Sem strategyId (venda manual disparada do favorito AT, que não sabe qual bot é dono da
 * posição) cancela TODAS as brackets resting do símbolo+exchange — um mesmo símbolo pode ter
 * mais de uma estratégia BOUGHT ao mesmo tempo (ex.: MA-Cross e Bollinger Bands), cada uma com
 * seu próprio OCO travando parte do saldo. Cancelar só a primeira (comportamento antigo)
 * deixava as demais travadas, e uma venda manual subsequente dessa outra estratégia falhava
 * por saldo insuficiente.
 */

const supabase = require('../../supabase/client');
const { buildAdapter } = require('./buildAdapter');
const { syncBinanceClock } = require('../../binance/tradeClient');

async function cancelRestingBracketIfAny({ symbol, exchange, strategyId }) {
  let query = supabase
    .from('rsi_multi_bot_state')
    .select('id, rules_state')
    .eq('symbol', symbol)
    .eq('exchange', exchange)
    .eq('phase', 'BOUGHT');
  if (strategyId) query = query.eq('strategy_id', strategyId);

  const { data: rows, error } = await query;
  if (error) throw new Error(`cancelRestingBracketIfAny: falha ao consultar rsi_multi_bot_state (${error.message})`);

  const pending = (rows ?? []).filter(row => row.rules_state?.exitBracket);
  if (!pending.length) return false;

  if (exchange === 'binance') await syncBinanceClock();
  const adapter = buildAdapter(exchange, symbol);

  for (const row of pending) {
    await adapter.cancelExitBracket(row.rules_state.exitBracket);
    const { exitBracket: _drop, ...restRules } = row.rules_state ?? {};
    await supabase.from('rsi_multi_bot_state').update({ rules_state: restRules }).eq('id', row.id);
  }

  return true;
}

module.exports = { cancelRestingBracketIfAny };
