-- Duas mudancas no ma-cross, aplicadas em todas as moedas com
-- strategy_id = 'ma-cross':
--
-- 1) entryTrendMa.tolerancePct -> 1% (era 0.03%, ver
--    set-macross-entrytrendma-tolerance-min.sql). Mantem ma1/ma2 em EMA9/EMA21
--    4h -- so afrouxa quanto a EMA9(4h) pode estar abaixo da EMA21(4h) e ainda
--    liberar a entrada.
--
-- 2) volume.minVolumeUsdt -> 1_000_000 (era 3_000_000, ver
--    set-default-macross-entry-filters.sql). Reduz o piso de volume 24h
--    aceitavel pra nao filtrar moedas de volume mais baixo.
--
-- So altera os campos entryTrendMa.tolerancePct e volume.minVolumeUsdt --
-- preserva os demais filtros intactos.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{entryTrendMa,tolerancePct}', '1'::jsonb, true),
      '{volume,minVolumeUsdt}', '1000000'::jsonb, true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{entryTrendMa,tolerancePct}', '1'::jsonb, true),
      '{volume,minVolumeUsdt}', '1000000'::jsonb, true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'entryTrendMa' AS entry_trend_ma,
--        trade_config->'volume' AS volume
-- FROM rsi_multi_bot_state WHERE strategy_id = 'ma-cross' ORDER BY symbol;
