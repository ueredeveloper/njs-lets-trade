'use strict';

/**
 * Cancela a ordem TP/SL resting (OCO real na Binance, price_orders emulados na Gate.io — ver
 * buildAdapter.js) de uma posição BOUGHT antes de uma venda manual a mercado disparada pelo
 * botão "Vender" do painel Multi-Trade (ver /binance-order e /gate-order em
 * backend/services/). Sem isso a quantidade fica presa (locked) na ordem resting e a venda
 * manual só consegue vender o troco livre — ou falha por saldo insuficiente.
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

  const { data: rows, error } = await query.limit(1);
  if (error) throw new Error(`cancelRestingBracketIfAny: falha ao consultar rsi_multi_bot_state (${error.message})`);

  const row = rows?.[0];
  const exitBracket = row?.rules_state?.exitBracket;
  if (!exitBracket) return false;

  if (exchange === 'binance') await syncBinanceClock();
  const adapter = buildAdapter(exchange, symbol);
  await adapter.cancelExitBracket(exitBracket);

  const { exitBracket: _drop, ...restRules } = row.rules_state ?? {};
  await supabase.from('rsi_multi_bot_state').update({ rules_state: restRules }).eq('id', row.id);

  return true;
}

module.exports = { cancelRestingBracketIfAny };
