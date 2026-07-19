-- Reduz a tolerancia do filtro de tendencia HTF de entrada do MA-Cross
-- (entryTrendMa: EMA9 x EMA21 em 4h) de 2% para 0.03%, em todas as moedas com
-- strategy_id = 'ma-cross'. Antes, a EMA9(4h) podia estar ate 2% abaixo da
-- EMA21(4h) e ainda passar; com 0.03% a EMA9 precisa estar praticamente
-- cruzando ou ja acima da EMA21 -- filtro fica bem mais restritivo.
--
-- So altera o campo entryTrendMa.tolerancePct -- preserva enabled/ma1/ma2 e
-- os demais filtros intactos.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{entryTrendMa,tolerancePct}', '0.03'::jsonb, true),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{entryTrendMa,tolerancePct}', '0.03'::jsonb, true),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'entryTrendMa' AS entry_trend_ma
-- FROM rsi_multi_bot_state WHERE strategy_id = 'ma-cross' ORDER BY symbol;
