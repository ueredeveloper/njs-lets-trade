-- Coluna rules_state (stop trailing, regras AMAP/MA-Cross) — já no amap-bot.sql local.
-- Rode no SQL Editor do Supabase se PATCH com rules_state falhar.

ALTER TABLE public.rsi_multi_bot_state
  ADD COLUMN IF NOT EXISTS rules_state JSONB;
