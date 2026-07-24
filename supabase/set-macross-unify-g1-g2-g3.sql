-- Unifica as 22 moedas ma-cross dos grupos G1/G2/G3 (entrada EMA9x21 15m +
-- saida EMA9x21 30m) para as regras padrao atuais do bot (MA_CROSS_DEFAULTS
-- em backend/bot/ma-cross/tradeConfigSchema.js), removendo variacoes que
-- vinham de experimentos pontuais aplicados so a um subconjunto:
--
--   entry.maxAboveMaPct        -> 0    (G1/G2 tinham 3%, teto desligado)
--   entryTrendMa                -> EMA9(4h) > EMA21(4h), tolerancePct 1
--                                  (G1 tinha tol 0.3%; SAPIENUSDT usava 1h em vez de 4h)
--   entryEmaApproach.enabled   -> false (G1 tinha ligado, era teste)
--   entryReversalGuard.enabled -> false (G1 tinha ligado, era teste)
--   maFilters[0].mode          -> 'adaptive' (G3 estava em 'strict_above')
--   volume.minVolumeUsdt       -> 1_000_000 (G1 tinha 3_000_000)
--   execution.pullbackEntry.requirePullback -> true (G1 tinha false)
--
-- bbTakeProfit.targetPct NAO e alterado -- fica calibrado por moeda (5.63%-9%).
--
-- Ficam de fora deste update (nao fazem parte de G1/G2/G3):
--   SKYAIUSDT  -- estrategia por banda de Bollinger (entry/exit diferentes)
--   SUIUSDT, DOTUSDT, PENGUUSDT, TIAUSDT, ATOMUSDT -- grupo G4 (1h/1h, sem filtros)
--   ALLOUSDT   -- posicao aberta (fase BOUGHT); igualar agora mudaria a saida em pleno trade
--
-- So atualiza multitrade_favorites (o painel) -- rsi_multi_bot_state fica de fora
-- por escolha do usuario. O bot em producao (ma-cross-bot.js) le trade_config de
-- rsi_multi_bot_state, entao essa mudanca so chega la quando cada moeda for
-- resalva pelo painel Multi-Trade (ou no proximo sync automatico), nao no
-- momento em que este script roda.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(trade_config, '{entry,maxAboveMaPct}', '0'::jsonb, true),
                '{entryTrendMa}',
                '{"enabled":true,"ma1":{"period":9,"interval":"4h"},"ma2":{"period":21,"interval":"4h"},"tolerancePct":1}'::jsonb,
                true
              ),
              '{entryEmaApproach,enabled}', 'false'::jsonb, true
            ),
            '{entryReversalGuard,enabled}', 'false'::jsonb, true
          ),
          '{maFilters,0,mode}', '"adaptive"'::jsonb, true
        ),
        '{volume,minVolumeUsdt}', '1000000'::jsonb, true
      ),
      '{execution,pullbackEntry,requirePullback}', 'true'::jsonb, true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND symbol IN (
    'WLDUSDT','PUMPUSDT','TRUMPUSDT','INJUSDT','OPUSDT','OPNUSDT',
    'SAPIENUSDT','RENDERUSDT',
    'KITEUSDT','SNDKBUSDT','FETUSDT','AIGENSYNUSDT','RIFUSDT','SYNUSDT',
    'ETHFIUSDT','LISTAUSDT','VIRTUALUSDT','MITOUSDT','HMSTRUSDT','EIGENUSDT',
    'JTOUSDT','OPGUSDT'
  );

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol,
--        trade_config->'entry'->'maxAboveMaPct'                       AS max_above_ma2,
--        trade_config->'entryTrendMa'                                  AS trend_ma,
--        trade_config->'entryEmaApproach'->'enabled'                   AS approach_on,
--        trade_config->'entryReversalGuard'->'enabled'                 AS guard_on,
--        trade_config->'maFilters'->0->'mode'                          AS ma_filter_mode,
--        trade_config->'volume'->'minVolumeUsdt'                       AS min_vol,
--        trade_config->'execution'->'pullbackEntry'->'requirePullback' AS require_pullback,
--        trade_config->'exit'->'bbTakeProfit'->'targetPct'             AS bb_take_profit
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
