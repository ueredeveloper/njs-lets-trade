-- Padrão de recuperação e stop passam a ser opcionais (types vazio = desligado).
-- Só afeta novos INSERTs sem recovery_pattern explícito; registros existentes não mudam.

ALTER TABLE five_min_bot_state
  ALTER COLUMN recovery_pattern SET DEFAULT '{"types":[],"zones":[],"abovePct":5}'::jsonb;

COMMENT ON COLUMN five_min_bot_state.recovery_pattern IS
  '{"types":[],"zones":[],"abovePct":5} — types vazio = sem filtro de padrão 1h na entrada';

NOTIFY pgrst, 'reload schema';
