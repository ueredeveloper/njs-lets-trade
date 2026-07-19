-- Reconfigura a SKYAIUSDT (strategy_id = 'ma-cross') pra operar so pelo modelo
-- de Bollinger Bands, independente do cruzamento EMA e do filtro MA50 1h:
--   * entryBbLower.enabled = true  -> gatilho de entrada (banda inferior 4h)
--   * maFiltersEnabled = false     -> desliga o filtro MA50 1h (nao faz sentido
--     gatear a entrada por banda inferior com uma exigencia de proximidade da MA50;
--     ver evaluateBbLowerEntry em backend/bot/ma-cross/strategyEngine.js)
--
-- Entrada por cruzamento EMA (entry.enabled), Tendencia HTF, Aproximacao EMA e
-- Filtro BB %B ja estavam desligados pra essa moeda; saida ja usa banda
-- superior BB 4h + alvo % historico (exit.bbUpper / exit.bbTakeProfit) -- nao
-- alterados aqui.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{entryBbLower,enabled}', 'true'::jsonb, true),
      '{maFiltersEnabled}', 'false'::jsonb, true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross' AND symbol = 'SKYAIUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{entryBbLower,enabled}', 'true'::jsonb, true),
      '{maFiltersEnabled}', 'false'::jsonb, true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross' AND symbol = 'SKYAIUSDT';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entry'->'enabled' AS ema_cross_entry,
--        trade_config->'entryBbLower' AS entry_bb_lower,
--        trade_config->'maFiltersEnabled' AS ma_filters_enabled,
--        trade_config->'exit'->'bbUpper' AS exit_bb_upper,
--        trade_config->'exit'->'bbTakeProfit' AS exit_bb_take_profit
-- FROM rsi_multi_bot_state WHERE symbol = 'SKYAIUSDT' AND strategy_id = 'ma-cross';
