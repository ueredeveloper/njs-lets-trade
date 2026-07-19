-- Liga o guard de reversao por candle (1h) no ma-cross: bloqueia nova entrada quando
-- um candle de exaustao (vermelho, fecha no terco inferior do range, corpo grande)
-- apareceu apos uma perna de alta esticada (>=8%) e o preco ainda nao reconquistou a
-- maxima desse candle. Cobre o atraso do entryTrendMa/entryEmaApproach (posicao de
-- EMA), que ficam "de lado comprado" durante a propria reversao — ver estudo de
-- candles 1h em ARBUSDT (17/jul), ADAUSDT (04/jul), HOMEUSDT/ALGOUSDT/KITEUSDT (jul/2026).
--
-- Implementacao: backend/bot/ma-cross/strategyEngine.js (evaluateEntry1hReversalGuard),
-- schema/defaults: backend/bot/ma-cross/tradeConfigSchema.js (entryReversalGuard).
--
-- Habilitado em todas as moedas com strategy_id = 'ma-cross', EXCETO SKYAIUSDT
-- (mantida sem o guard a pedido explicito).
--
-- Usa jsonb_set no caminho especifico (so entryReversalGuard.enabled) — os demais
-- parametros (rallyLookbackCandles: 96, cooldownCandles: 12, minRallyPct: 8,
-- maxClosePosPct: 30, minBodyPct: 45) vem dos defaults do schema quando o campo
-- nao esta presente no JSON, entao nao precisam ser gravados aqui.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      trade_config,
      '{entryReversalGuard,enabled}',
      'true'::jsonb,
      true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND symbol <> 'SKYAIUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      trade_config,
      '{entryReversalGuard,enabled}',
      'true'::jsonb,
      true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND symbol <> 'SKYAIUSDT';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entryReversalGuard'->'enabled' AS reversal_guard_on
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
