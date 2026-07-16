-- Reduz o dip maximo permitido pelo filtro adaptativo EMA50(1h) no MA-Cross,
-- de 4% para 1%, em todas as moedas com strategy_id = 'ma-cross'.
--
-- Exceção: SKYAIUSDT na Gate.io fica com o valor atual (nao mexe).
--
-- So altera o elemento do array maFilters com period=50, interval='1h',
-- mode='adaptive' -- preserva os demais filtros/campos intactos.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      trade_config,
      '{maFilters}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN (elem->>'period')::int = 50
                 AND elem->>'interval' = '1h'
                 AND elem->>'mode' = 'adaptive'
            THEN elem || jsonb_build_object('maxDipPct', 1)
            ELSE elem
          END
        )
        FROM jsonb_array_elements(trade_config->'maFilters') AS elem
      )
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND NOT (symbol = 'SKYAIUSDT' AND exchange = 'gate');

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      trade_config,
      '{maFilters}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN (elem->>'period')::int = 50
                 AND elem->>'interval' = '1h'
                 AND elem->>'mode' = 'adaptive'
            THEN elem || jsonb_build_object('maxDipPct', 1)
            ELSE elem
          END
        )
        FROM jsonb_array_elements(trade_config->'maFilters') AS elem
      )
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND NOT (symbol = 'SKYAIUSDT' AND exchange = 'gate');

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'maFilters' AS ma_filters
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'ma-cross'
-- ORDER BY symbol;
