-- Habilita o filtro PERM (nuvem de inclinacao EMA9xEMA21 -- ver backend/utils/emaPersistCloud.js
-- e checkPermFilter em backend/bot/bollinger-bands/strategyEngine.js) em todas as moedas do bot
-- Bollinger Bands: so compra com a EMA9 ja acima da EMA21 e subindo, com cascata pro intervalo
-- menor (ex.: 1h -> 30m -> 15m) quando a nuvem do intervalo mais alto estiver vazia no momento.
-- Intervalo do PERM eh independente do intervalo da banda de Bollinger (entry.interval) -- fica
-- em '1h' por padrao aqui, editavel por moeda no formulario do painel depois.
--
-- Padrao no schema: ja nasce ligado com interval='1h' (entry.permFilter) pra configs NOVAS --
-- este script eh so pra sincronizar as linhas JA EXISTENTES no Supabase. Rodar no SQL Editor do
-- Supabase apos o deploy do codigo.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      jsonb_set(
        COALESCE(trade_config, '{}'::jsonb),
        '{entry,permFilter,enabled}',
        'true'::jsonb
      ),
      '{entry,permFilter,interval}',
      '"1h"'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      jsonb_set(
        COALESCE(trade_config, '{}'::jsonb),
        '{entry,permFilter,enabled}',
        'true'::jsonb
      ),
      '{entry,permFilter,interval}',
      '"1h"'::jsonb
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

COMMIT;

-- Verificacao:
-- SELECT symbol, exchange, trade_config->'entry'->'permFilter' AS perm_filter
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'bollinger-bands'
-- ORDER BY symbol;
