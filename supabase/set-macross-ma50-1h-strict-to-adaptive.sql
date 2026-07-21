-- Corrige o filtro de preco MA50(1h) (Tendencia MA50 1H, param3) nas moedas
-- ma-cross que ainda estao em mode='strict_above' com tolerancePct=0.1 --
-- resquicio do default antigo do formulario frontend (ja corrigido no codigo).
-- Nesse modo o checkPriceFilter ignora maxDipPct e usa tolerancePct, entao na
-- pratica essas moedas ficavam com piso de 0.1% abaixo da MA50, nao 0.5% como
-- o resto do ma-cross (bot e formulario).
--
-- Afeta ACTUSDT, BERAUSDT, CRVUSDT, FORMUSDT, GALAUSDT, PIXELUSDT, RENDERUSDT,
-- SAPIENUSDT, TURTLEUSDT, XVGUSDT (mesmas nas duas tabelas, confirmado via
-- consulta direta antes desta migracao).
--
-- So altera o elemento do array maFilters com period=50, interval='1h',
-- mode='strict_above' -- troca pra mode='adaptive', maxDipPct=0.5,
-- maxAbovePct=0, tolerancePct=0 (mesmos valores que as outras 37 moedas ja
-- tem). Preserva os demais filtros/campos intactos.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      trade_config,
      '{maFilters}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN (f->>'period')::int = 50
                 AND f->>'interval' = '1h'
                 AND f->>'mode' = 'strict_above'
              THEN f || jsonb_build_object(
                'mode', 'adaptive',
                'maxDipPct', 0.5,
                'maxAbovePct', 0,
                'tolerancePct', 0
              )
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
      trade_config,
      '{maFilters}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN (f->>'period')::int = 50
                 AND f->>'interval' = '1h'
                 AND f->>'mode' = 'strict_above'
              THEN f || jsonb_build_object(
                'mode', 'adaptive',
                'maxDipPct', 0.5,
                'maxAbovePct', 0,
                'tolerancePct', 0
              )
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
-- SELECT symbol, exchange, trade_config->'maFilters' AS ma_filters
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
