-- Padrão de recuperação 1h escolhido pelo usuário (5m Trade)
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS recovery_pattern JSONB DEFAULT '{"type":"none"}'::jsonb;

NOTIFY pgrst, 'reload schema';
