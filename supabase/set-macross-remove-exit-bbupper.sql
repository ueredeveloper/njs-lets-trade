-- Desliga a saida por Bollinger Bands 4h no topo (exit.bbUpper: vende quando o
-- preco toca/rompe a banda superior), mantendo a saida por bbTakeProfit (venda
-- ao atingir o alvo % de ganho calibrado por moeda) intacta, em todas as
-- moedas com strategy_id = 'ma-cross'.
--
-- Usa jsonb_set num caminho especifico (so exit.bbUpper.enabled) em vez de
-- reescrever o objeto exit inteiro, pra nao mexer no bbTakeProfit (targetPct
-- varia por moeda, 6% a 15%), na saida por EMA (30m) nem no RSI de saida.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit,bbUpper,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit,bbUpper,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'exit'->'bbUpper'->'enabled' AS bb_upper_on,
--        trade_config->'exit'->'bbTakeProfit' AS bb_take_profit
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
