-- Desliga o filtro entryEmaApproach (EMA9 x EMA21 4h) so para a BANKUSDT
-- (strategy_id = 'ma-cross').
--
-- Motivo: BANKUSDT esta em pump continuo ha ~2 dias (preco saltou de 0.11 para
-- 0.28+), com o gap EMA9/EMA21(4h) entre 16% e 37% o tempo todo, sem nenhum
-- pullback recente perto da EMA21. O filtro exige um "fundo" da EMA9 perto da
-- EMA21 (dentro de approachPct) seguido de retomada de alta -- em um rali
-- direto como esse nunca ha esse fundo, entao o sinal de cruzamento MA9/21
-- 15m (que ja confirmou, ex.: 20/jul ~05:45 BRT) fica bloqueado pra sempre
-- com reason EMA_APPROACH_NOT_FOUND (ver diagnostico rodado com
-- strategyEngine.js contra candles reais da Binance).
--
-- Demais guardas de entrada (entryTrendMa EMA9>EMA21 1h, filtro adaptativo
-- MA50 1h, entryReversalGuard) permanecem ativos -- so o requisito de
-- "pullback recente no 4h" sai do caminho pra essa moeda.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{entryEmaApproach,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross' AND symbol = 'BANKUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{entryEmaApproach,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross' AND symbol = 'BANKUSDT';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entryEmaApproach' AS ema_approach,
--        trade_config->'entryTrendMa' AS entry_trend_ma,
--        trade_config->'entryReversalGuard' AS entry_reversal_guard
-- FROM rsi_multi_bot_state WHERE symbol = 'BANKUSDT' AND strategy_id = 'ma-cross';
