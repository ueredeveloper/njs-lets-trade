-- Adiciona coluna sell_interval em favorites_trade
-- NULL = usa o mesmo intervalo de entrada para a saída (comportamento atual)
ALTER TABLE favorites_trade
  ADD COLUMN IF NOT EXISTS sell_interval TEXT;
