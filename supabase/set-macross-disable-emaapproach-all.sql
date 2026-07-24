-- Desliga o filtro entryEmaApproach (EMA9 x EMA21 4h) em todas as moedas com
-- strategy_id = 'ma-cross'.
--
-- Motivo: a regra exige um "fundo" da EMA9 perto da EMA21(4h) seguido de
-- retomada de alta. Em moedas com rali continuo e sem pullback recente no 4h
-- (BANKUSDT, REUSDT), esse fundo nunca se forma e o sinal de cruzamento EMA
-- 9/21 15m fica bloqueado pra sempre com reason EMA_APPROACH_NOT_FOUND, mesmo
-- ja tendo confirmado. O ganho de qualidade que a regra trazia (evitar comprar
-- no topo de um rali) nao compensa o numero de entradas boas que ela corta.
--
-- Substitui set-bankusdt-disable-emaapproach.sql (que so cobria BANKUSDT) e
-- reverte a troca feita em set-macross-emaapproach-replaces-bb.sql.
--
-- Demais guardas de entrada (entryTrendMa EMA9>EMA21 1h, filtro adaptativo
-- MA50 1h, entryReversalGuard) permanecem ativos -- so o requisito de
-- "pullback recente no 4h" sai do caminho.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{entryEmaApproach,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{entryEmaApproach,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entryEmaApproach'->'enabled' AS ema_approach_on,
--        trade_config->'entryTrendMa' AS entry_trend_ma,
--        trade_config->'entryReversalGuard' AS entry_reversal_guard
-- FROM rsi_multi_bot_state WHERE strategy_id = 'ma-cross' ORDER BY symbol;
