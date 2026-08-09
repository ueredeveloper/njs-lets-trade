-- Aumenta o slopeLookback do filtro de tendencia EMA (entry.emaFilter) do bot
-- Bollinger Bands de 5 para 10 candles, em todas as moedas com strategy_id = 'bollinger-bands'.
--
-- So altera o campo emaFilter.slopeLookback dentro de trade_config.entry -- preserva
-- os demais campos (enabled, period, interval, maxDipPct, minSlopePct) intactos.
-- Linhas que ja tinham um slopeLookback customizado (diferente de 5) tambem sao
-- sobrescritas para 10 -- remova o filtro abaixo se quiser preservar customizacoes.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      trade_config,
      '{entry,emaFilter,slopeLookback}',
      '10'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands'
  AND trade_config->'entry'->'emaFilter' ? 'slopeLookback';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      trade_config,
      '{entry,emaFilter,slopeLookback}',
      '10'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands'
  AND trade_config->'entry'->'emaFilter' ? 'slopeLookback';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'entry'->'emaFilter' AS ema_filter
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'bollinger-bands'
-- ORDER BY symbol;
