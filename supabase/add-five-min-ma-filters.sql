-- Filtros MA para entrada do bot 5m Trade
-- Se rsi_buy/rsi_sell também faltarem, rode supabase/add-five-min-bot-columns.sql (migration completa).

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS ma_filters JSONB DEFAULT '{"enabled":false,"filters":[{"id":"ma50-1h","enabled":true,"period":50,"interval":"1h","mode":"above","tolerancePct":0}]}'::jsonb;

NOTIFY pgrst, 'reload schema';
