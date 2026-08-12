-- BB(4h/1h) nao precisa da granularidade de 1m do vwap-bands: pollMs mais espacado evita
-- competir com o frontend pelas mesmas chamadas de candles na corretora. Alinha o polling do
-- bollinger-bands ao mesmo padrao do swing-bot/amap-bot (5min parado, 1min com posicao aberta)
-- em vez do 60s/30s herdado do vwap-bands.
--
-- rsi_multi_bot_state ja foi atualizado ao vivo via REST (bots ja rodando com o valor novo).
-- Este UPDATE so precisa rodar pra sincronizar multitrade_favorites (fonte lida pelo painel
-- ao editar/salvar um favorito — sem isso, o proximo save reescreveria rsi_multi_bot_state
-- de volta pro polling antigo). Rodar no SQL Editor do Supabase apos o deploy do codigo.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{polling}',
      '{"pollMs": 300000, "fastPollMs": 60000}'::jsonb,
      true
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands'
  AND COALESCE(trade_config->'polling'->>'pollMs', '') = '60000'
  AND COALESCE(trade_config->'polling'->>'fastPollMs', '') = '30000';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{polling}',
      '{"pollMs": 300000, "fastPollMs": 60000}'::jsonb,
      true
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands'
  AND COALESCE(trade_config->'polling'->>'pollMs', '') = '60000'
  AND COALESCE(trade_config->'polling'->>'fastPollMs', '') = '30000';

COMMIT;

-- Verificacao:
-- SELECT symbol, trade_config->'polling' AS polling
-- FROM multitrade_favorites
-- WHERE strategy_id = 'bollinger-bands'
-- ORDER BY symbol;
