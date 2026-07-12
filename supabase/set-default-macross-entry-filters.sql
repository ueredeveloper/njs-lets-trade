-- Normaliza os filtros de entrada do MA-Cross para o mesmo padrao em todas as
-- moedas favoritadas (AAVEUSDT, SKYAIUSDT, TIAUSDT, UTKUSDT, VANRYUSDT, XPLUSDT
-- estavam com um preset mais "solto"; as demais 7 ja usavam o padrao abaixo).
--
-- Padrao aplicado (igual em todas as 13 moedas apos este script):
--   maFiltersEnabled        = true   (liga o filtro de MA adaptativa 1h no pre-trade)
--   entryTrendMa.enabled    = true   (EMA9 x EMA21 1h como filtro de tendencia de entrada)
--   volume.minVolumeUsdt    = 3000000
--   execution.immediateEntry = false (usa pullback/pending em vez de entrada imediata)
--   pendingTimeoutMs        = 5400000 (90 min, tanto no nivel raiz quanto em execution)
--
-- NAO altera entrada (EMA9 x EMA21 cross_up 15m), saida por EMA (30m) nem os
-- sinais de saida por Bollinger Bands (bbUpper / bbTakeProfit).

BEGIN;

UPDATE multitrade_favorites
SET trade_config = trade_config
  || jsonb_build_object(
       'maFiltersEnabled', true,
       'minVolumeUsdt', 3000000,
       'immediateEntry', false,
       'pendingTimeoutMs', 5400000,
       'entryTrendMa', jsonb_build_object(
         'ma1', jsonb_build_object('period', 9, 'interval', '1h'),
         'ma2', jsonb_build_object('period', 21, 'interval', '1h'),
         'enabled', true,
         'tolerancePct', 1
       ),
       'volume', (trade_config->'volume') || '{"minVolumeUsdt":3000000}'::jsonb,
       'execution', (trade_config->'execution') || '{"immediateEntry":false,"pendingTimeoutMs":5400000}'::jsonb
     ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND symbol IN ('AAVEUSDT','SKYAIUSDT','TIAUSDT','UTKUSDT','VANRYUSDT','XPLUSDT');

UPDATE rsi_multi_bot_state
SET trade_config = trade_config
  || jsonb_build_object(
       'maFiltersEnabled', true,
       'minVolumeUsdt', 3000000,
       'immediateEntry', false,
       'pendingTimeoutMs', 5400000,
       'entryTrendMa', jsonb_build_object(
         'ma1', jsonb_build_object('period', 9, 'interval', '1h'),
         'ma2', jsonb_build_object('period', 21, 'interval', '1h'),
         'enabled', true,
         'tolerancePct', 1
       ),
       'volume', (trade_config->'volume') || '{"minVolumeUsdt":3000000}'::jsonb,
       'execution', (trade_config->'execution') || '{"immediateEntry":false,"pendingTimeoutMs":5400000}'::jsonb
     ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND symbol IN ('AAVEUSDT','SKYAIUSDT','TIAUSDT','UTKUSDT','VANRYUSDT','XPLUSDT');

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'maFiltersEnabled' AS ma_filters_enabled,
--        trade_config->'entryTrendMa'->'enabled' AS entry_trend_ma,
--        trade_config->'volume'->'minVolumeUsdt' AS vol_min,
--        trade_config->'execution'->'immediateEntry' AS immediate_entry,
--        trade_config->'pendingTimeoutMs' AS pending_timeout_ms
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
