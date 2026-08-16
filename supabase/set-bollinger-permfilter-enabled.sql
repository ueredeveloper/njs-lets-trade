-- Habilita o filtro PERM (nuvem de inclinacao EMA9xEMA21 -- ver backend/utils/emaPersistCloud.js
-- e checkPermFilter em backend/bot/bollinger-bands/strategyEngine.js) em todas as moedas do bot
-- Bollinger Bands: so compra com a EMA9 ja acima da EMA21 e subindo, com cascata pro intervalo
-- menor (ex.: 1h -> 30m -> 15m) quando a nuvem do intervalo mais alto estiver vazia no momento.
--
-- Padrao no schema: ja nasce ligado (entry.permFilter.enabled=true) pra configs NOVAS -- este
-- script eh so pra sincronizar as linhas JA EXISTENTES no Supabase. Rodar no SQL Editor do
-- Supabase apos o deploy do codigo.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{entry,permFilter,enabled}',
      'true'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{entry,permFilter,enabled}',
      'true'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

COMMIT;

-- Verificacao:
-- SELECT symbol, exchange, trade_config->'entry'->'permFilter' AS perm_filter
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'bollinger-bands'
-- ORDER BY symbol;
