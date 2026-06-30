-- Padrão de recuperação 1h escolhido pelo usuário (5m Trade)
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS recovery_pattern JSONB DEFAULT '{"types":["two_green","two_one"],"zones":["above_ma","between_ma"],"abovePct":5}'::jsonb;

-- Atualiza default para novas linhas (coluna já existente)
ALTER TABLE five_min_bot_state
  ALTER COLUMN recovery_pattern SET DEFAULT '{"types":["two_green","two_one"],"zones":["above_ma","between_ma"],"abovePct":5}'::jsonb;

NOTIFY pgrst, 'reload schema';
