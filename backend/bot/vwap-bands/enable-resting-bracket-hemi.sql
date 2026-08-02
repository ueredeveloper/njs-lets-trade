-- Liga a bracket TP/SL resting (OCO real na Binance / emulada na Gate.io — ver
-- backend/bot/vwap-bands/vwap-bands-bot.js) só na HEMIUSDT, como piloto antes de
-- expandir pros demais símbolos do vwap-bands (ver rollout no plano da sessão).
--
-- trade_config.exit.restingBracket = { enabled: true, driftPct: 3 } — default é
-- enabled:false (tradeConfigSchema.js), então símbolos sem essa chave continuam
-- no comportamento de sempre (candle fechado → venda a mercado).
--
-- Execute no SQL Editor do Supabase (ou via REST/PATCH — não precisa de conexão
-- direta psql, é só um jsonb_set num UPDATE comum).

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{exit,restingBracket}',
      '{"enabled": true, "driftPct": 3}'::jsonb,
      true
    ),
    updated_at = now()
WHERE symbol = 'HEMIUSDT' AND strategy_id = 'vwap-bands';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      COALESCE(trade_config, '{}'::jsonb),
      '{exit,restingBracket}',
      '{"enabled": true, "driftPct": 3}'::jsonb,
      true
    ),
    updated_at = now()
WHERE symbol = 'HEMIUSDT' AND strategy_id = 'vwap-bands';

COMMIT;

-- Verificação pós-update:
-- SELECT symbol, trade_config->'exit'->'restingBracket' AS resting_bracket
-- FROM rsi_multi_bot_state WHERE symbol = 'HEMIUSDT' AND strategy_id = 'vwap-bands';

-- Pra reverter (voltar ao candle fechado / venda a mercado):
-- UPDATE multitrade_favorites SET trade_config = jsonb_set(trade_config, '{exit,restingBracket,enabled}', 'false') WHERE symbol = 'HEMIUSDT' AND strategy_id = 'vwap-bands';
-- UPDATE rsi_multi_bot_state SET trade_config = jsonb_set(trade_config, '{exit,restingBracket,enabled}', 'false') WHERE symbol = 'HEMIUSDT' AND strategy_id = 'vwap-bands';
