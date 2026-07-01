-- Cooldown entre caminhos RSI/MA após venda (persiste última via + hora)
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS last_exit_reason TEXT;

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS last_exit_time TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
