-- Coluna de configuração de stop loss para o bot 5m Trade.
-- Rode no SQL Editor do Supabase se POST five-m-trade-favorites falhar com "schema cache".

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS stop_loss JSONB DEFAULT '{"type":"none"}'::jsonb;

NOTIFY pgrst, 'reload schema';
