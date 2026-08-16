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
--
-- IMPORTANTE: jsonb_set so cria UM nivel que nao existe. Como "entry" existe mas
-- "entry.permFilter" nao, tentar setar "{entry,permFilter,enabled}" direto exigiria criar 2
-- niveis de uma vez (permFilter + enabled) -- o Postgres nao da erro nesse caso, so ignora
-- silenciosamente e devolve o JSON sem alterar nada (foi o que aconteceu na primeira versao
-- deste script). Aqui, em vez disso, construimos o objeto permFilter inteiro e fazemos merge
-- dentro de "entry" (que ja existe) -- so 1 nivel novo, sempre funciona. O merge com "||"
-- preserva todos os outros campos de entry (period, stdDev, interval, pullback, emaFilter,
-- medianTrendFilter etc.), so adiciona/sobrescreve a chave permFilter.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{entry}',
      COALESCE(trade_config->'entry', '{}'::jsonb)
        || jsonb_build_object('permFilter', jsonb_build_object('enabled', true, 'interval', '1h'))
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{entry}',
      COALESCE(trade_config->'entry', '{}'::jsonb)
        || jsonb_build_object('permFilter', jsonb_build_object('enabled', true, 'interval', '1h'))
    ),
    updated_at = now()
WHERE strategy_id = 'bollinger-bands';

COMMIT;

-- Verificacao:
-- SELECT symbol, exchange, trade_config->'entry'->'permFilter' AS perm_filter
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'bollinger-bands'
-- ORDER BY symbol;
