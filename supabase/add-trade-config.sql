-- Adiciona trade_config JSON às tabelas multitrade / bot state
-- Execute no Supabase se ainda não rodou:

ALTER TABLE public.multitrade_favorites
  ADD COLUMN IF NOT EXISTS trade_config JSONB;

ALTER TABLE public.rsi_multi_bot_state
  ADD COLUMN IF NOT EXISTS trade_config JSONB;

-- strategy_id 'flex' = configuração livre via strategyEngine (AMAP)
