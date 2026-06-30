-- Caminhos de entrada (RSI / MA50 5m) e RSI de saída dedicado para entradas MA50 5m
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS entry_paths JSONB DEFAULT '{"rsi":{"enabled":true},"ma50_5m":{"enabled":true,"trigger":"touch"},"combine":"any","pathCooldownHours":2.2,"pathCooldownSource":"ma"}'::jsonb;

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS rsi_sell_ma5m NUMERIC(8,2);

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS entry_path TEXT;

NOTIFY pgrst, 'reload schema';
