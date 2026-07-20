-- Teste desta semana: desliga a exigencia de "pullback" no ma-cross (requirePullback:
-- entrar so quando o candle de entrada estiver mais perto da MA21 do que estava no
-- candle do sinal). Mantem a janela de espera (waitCandles) e todos os outros filtros
-- (piso adaptativo MA50 1h, tendencia EMA9x21 4h, aproximacao EMA9/21 4h) intactos.
--
-- Motivacao: backtest de 14 dias (50 moedas ma-cross) mostrou NO_PULLBACK como o
-- maior bloqueio isolado (428 de 1104 sinais). Testando so essa mudanca, sem mexer
-- em mais nada, pra medir o efeito real dela ao vivo essa semana.
--
-- Usa jsonb_set num caminho especifico (so execution.pullbackEntry.requirePullback)
-- em vez de reescrever o objeto execution inteiro, pra nao mexer em waitCandles,
-- entryDiscount, pendingTimeoutMs etc.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,requirePullback}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,requirePullback}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'execution'->'pullbackEntry'->'requirePullback' AS require_pullback
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;

-- Para reverter (voltar a exigir pullback):
-- UPDATE multitrade_favorites SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,requirePullback}', 'true'::jsonb, false) WHERE strategy_id = 'ma-cross';
-- UPDATE rsi_multi_bot_state SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,requirePullback}', 'true'::jsonb, false) WHERE strategy_id = 'ma-cross';
