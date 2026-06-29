-- Preço de entrada: mercado ou limit abaixo do preço (%)
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS entry_price JSONB DEFAULT '{"mode":"market","belowPct":0}'::jsonb;
