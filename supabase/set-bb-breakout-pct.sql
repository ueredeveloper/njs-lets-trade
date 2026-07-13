-- Exige que o preço fique 2% acima da banda superior da Bollinger (4h) antes de
-- vender pelo sinal bbUpper, em vez de vender ao só tocar/fechar na banda.
-- Motivo: o sinal foi ajustado para reagir ao preço ao vivo (nao mais so ao
-- fechamento do candle 4h); breakoutPct evita vender por um toque raso na banda.
-- Aplicado a TODAS as moedas ma-cross com bbUpper habilitado (nao so a NEAR).

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit,bbUpper,breakoutPct}', '2'::jsonb),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND (trade_config->'exit'->'bbUpper'->>'enabled')::boolean IS TRUE;

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit,bbUpper,breakoutPct}', '2'::jsonb),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND (trade_config->'exit'->'bbUpper'->>'enabled')::boolean IS TRUE;

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'exit'->'bbUpper' AS bb_upper
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross'
--   AND (trade_config->'exit'->'bbUpper'->>'enabled')::boolean IS TRUE
-- ORDER BY symbol;
