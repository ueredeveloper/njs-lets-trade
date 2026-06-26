-- Colunas do painel 5m Trade (RSI + filtros MA) em five_min_bot_state
-- Rode no SQL Editor do Supabase se POST five-m-trade-favorites falhar com "schema cache".

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS rsi_buy  NUMERIC(8,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rsi_sell NUMERIC(8,2) NOT NULL DEFAULT 70;

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS ma_filters JSONB DEFAULT '{"enabled":false,"filters":[{"id":"ma50-1h","enabled":true,"period":50,"interval":"1h","mode":"above","tolerancePct":0}]}'::jsonb;

NOTIFY pgrst, 'reload schema';
