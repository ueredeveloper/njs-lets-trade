-- Adiciona um símbolo pro bot vwap-bands (strategy_id = 'vwap-bands').
-- Execute no SQL Editor do Supabase. Não cria tabela nova — reaproveita
-- multitrade_favorites e rsi_multi_bot_state (schema base em
-- backend/bot/amap/amap-bot.sql), usadas por todos os bots multi-trade.
--
-- trade_config = {"kind":"vwap_bands"} é suficiente: configFromRow() em
-- backend/bot/vwap-bands/tradeConfigSchema.js sempre re-normaliza com os
-- defaults (entry.interval=1h, vwapInterval=4h, session=weekly,
-- minBandDistancePct=3, reclaimLookbackCandles=24, pullback.waitCandles=10,
-- pullback.tolerancePct=1, pullback.pollInterval=15m, stopLoss.mode=ladder,
-- exit.fastCheck.proximityPct=1) a cada tick — não precisa escrever os
-- campos todos aqui. Pra customizar algum, sobrescreva só o campo desejado
-- no JSON abaixo (os demais continuam vindo do default).
--
-- Ajuste SYMBOL, CAPITAL e o e-mail antes de rodar. Depois é só iniciar o
-- bot: node backend/bot/vwap-bands/vwap-bands-bot.js
--   (ou --symbol OPUSDT pra rodar só essa moeda)

BEGIN;

WITH usr AS (
  SELECT id FROM profiles WHERE email = 'ueredeveloper@gmail.com'
)
INSERT INTO multitrade_favorites (user_id, symbol, exchange, strategy_id, capital, trade_config, enabled)
SELECT usr.id, 'OPUSDT', 'binance', 'vwap-bands', 100, '{"kind":"vwap_bands"}'::jsonb, true
FROM usr
ON CONFLICT (user_id, symbol, strategy_id) DO UPDATE
SET trade_config = EXCLUDED.trade_config,
    enabled      = true,
    updated_at   = now();

INSERT INTO rsi_multi_bot_state (symbol, exchange, strategy_id, initial_capital, capital, phase, trade_config)
VALUES ('OPUSDT', 'binance', 'vwap-bands', 100, 100, 'WATCHING', '{"kind":"vwap_bands"}'::jsonb)
ON CONFLICT (symbol, strategy_id) DO UPDATE
SET trade_config = EXCLUDED.trade_config,
    updated_at   = now();

COMMIT;

-- Verificação pós-insert:
-- SELECT symbol, strategy_id, phase, trade_config FROM rsi_multi_bot_state WHERE strategy_id = 'vwap-bands';
-- SELECT symbol, strategy_id, enabled, trade_config FROM multitrade_favorites WHERE strategy_id = 'vwap-bands';
