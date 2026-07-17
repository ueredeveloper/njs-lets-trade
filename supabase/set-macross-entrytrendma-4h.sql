-- Muda o filtro de tendencia HTF de entrada do MA-Cross (entryTrendMa) de
-- EMA9(1h) x EMA21(1h) tolerancia 1% para EMA9(4h) x EMA21(4h) tolerancia 2%,
-- em todas as moedas com strategy_id = 'ma-cross'.
--
-- Nao altera nenhum outro filtro (entrada 15m, saida EMA 30m, MA adaptativa 1h,
-- Bollinger, stop-loss, etc). Tambem nao mexe na regra nova entryEmaApproach
-- (aproximacao EMA9->EMA21 e alta) — essa fica desligada por padrao ate ser
-- validada; ative por moeda direto no painel Multi-Trade se quiser testar.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = trade_config
  || jsonb_build_object(
       'entryTrendMa', jsonb_build_object(
         'enabled', COALESCE(trade_config->'entryTrendMa'->'enabled', 'true'::jsonb),
         'ma1', jsonb_build_object('period', 9, 'interval', '4h'),
         'ma2', jsonb_build_object('period', 21, 'interval', '4h'),
         'tolerancePct', 2
       )
     ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = trade_config
  || jsonb_build_object(
       'entryTrendMa', jsonb_build_object(
         'enabled', COALESCE(trade_config->'entryTrendMa'->'enabled', 'true'::jsonb),
         'ma1', jsonb_build_object('period', 9, 'interval', '4h'),
         'ma2', jsonb_build_object('period', 21, 'interval', '4h'),
         'tolerancePct', 2
       )
     ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entryTrendMa' AS entry_trend_ma
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
