-- Restaura o cooldown de reentrada apos STOP_LOSS (entry.reentryCooldownCandles = 3)
-- no bot Bollinger Bands. Conta candles FECHADOS do intervalo da BB apos a saida;
-- saida no alvo (banda superior) nao espera (filtrado no codigo por lastExitReason).
--
-- Padrao no schema: 3. Rodar no SQL Editor do Supabase apos o deploy do codigo.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{entry,reentryCooldownCandles}',
      '3'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{entry,reentryCooldownCandles}',
      '3'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

COMMIT;

-- Verificacao:
-- SELECT symbol, exchange, trade_config->'entry'->'reentryCooldownCandles' AS reentry_cooldown
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'bollinger-bands'
-- ORDER BY symbol;
