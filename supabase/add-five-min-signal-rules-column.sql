-- Opcional: coluna rules denormalizada (hoje o snapshot fica em details.rules JSONB).
-- Não é obrigatório — o frontend lê details.rules ou reconstrói de ma1h_ok, ma5m_triggered, details.*.

ALTER TABLE five_min_bot_signals
  ADD COLUMN IF NOT EXISTS rules JSONB;

COMMENT ON COLUMN five_min_bot_signals.rules IS
  'Snapshot { ma1h, ma5m, pattern, rsiPath, maPath, order } — espelho de details.rules';

COMMENT ON COLUMN five_min_bot_signals.details IS
  'Inclui rules, maChecks, pathSignal, recoveryEval, rsiBuySignal (bot >= 338c28f)';

NOTIFY pgrst, 'reload schema';
