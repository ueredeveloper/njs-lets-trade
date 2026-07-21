-- Desliga o teto "Max % acima da MA2 (param2)" do cruzamento de entrada do
-- MA-Cross (entry.maxAboveMaPct: 0 = desligado), em todas as moedas com
-- strategy_id = 'ma-cross'. Nao esta sendo usado -- mantem o padrao 0.
--
-- So altera o campo entry.maxAboveMaPct -- preserva ma1/ma2/direction/
-- tolerancePct e os demais filtros intactos.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{entry,maxAboveMaPct}', '0'::jsonb, true),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{entry,maxAboveMaPct}', '0'::jsonb, true),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'entry'->'maxAboveMaPct' AS max_above_ma2
-- FROM rsi_multi_bot_state WHERE strategy_id = 'ma-cross' ORDER BY symbol;
