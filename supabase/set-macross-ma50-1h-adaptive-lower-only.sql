-- Liga o filtro de preco MA50 1h (maFiltersEnabled) em todas as moedas com
-- strategy_id = 'ma-cross' (estava desligado em todas), reconfigurado pra usar
-- so a adaptativa inferior (piso 0.5% abaixo da MA50 1h) -- teto superior
-- desligado de proposito (maxAbovePct: 0), nao bloqueia entrada por preco
-- esticado acima da MA.
--
-- So altera maFiltersEnabled e o filtro de period=50/interval=1h dentro de
-- maFilters -- preserva mode, fixedDipPct/fixedAbovePct (null) e demais campos.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{maFiltersEnabled}', 'true'::jsonb, true),
      '{maFilters}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN (f->>'period')::int = 50 AND f->>'interval' = '1h'
              THEN f || jsonb_build_object('maxDipPct', 0.5, 'maxAbovePct', 0, 'mode', 'adaptive')
            ELSE f
          END
        )
        FROM jsonb_array_elements(trade_config->'maFilters') f
      ),
      true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{maFiltersEnabled}', 'true'::jsonb, true),
      '{maFilters}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN (f->>'period')::int = 50 AND f->>'interval' = '1h'
              THEN f || jsonb_build_object('maxDipPct', 0.5, 'maxAbovePct', 0, 'mode', 'adaptive')
            ELSE f
          END
        )
        FROM jsonb_array_elements(trade_config->'maFilters') f
      ),
      true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'maFiltersEnabled' AS ma_filters_enabled,
--        trade_config->'maFilters' AS ma_filters
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
