-- Ajusta a tolerancia do filtro de tendencia HTF de entrada do MA-Cross
-- (entryTrendMa: EMA9 x EMA21) de 0.03% para 0.3%, em todas as moedas com
-- strategy_id = 'ma-cross'. Validado manualmente em BANKUSDT (cruzamento
-- EMA9x21 4h em 09/07/2026 ~21:00): com 0.03% o filtro ja passava folgado
-- (gap +0.03% no candle do cruzamento); 0.3% da uma margem um pouco maior
-- sem voltar a tolerancia antiga de 2% (considerada frouxa demais).
--
-- So altera o campo entryTrendMa.tolerancePct -- preserva enabled/ma1/ma2 e
-- os demais filtros intactos.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{entryTrendMa,tolerancePct}', '0.3'::jsonb, true),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{entryTrendMa,tolerancePct}', '0.3'::jsonb, true),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'entryTrendMa' AS entry_trend_ma
-- FROM rsi_multi_bot_state WHERE strategy_id = 'ma-cross' ORDER BY symbol;
