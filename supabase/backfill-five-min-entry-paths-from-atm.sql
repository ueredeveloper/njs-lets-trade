-- Copia entry_paths de ATMUSDT para todas as outras moedas do 5m Trade.
-- Padrão ATM: RSI + MA50 5m (OR), pathCooldown 2.2h, fonte MA.
-- Rode no SQL Editor do Supabase (uma vez).

-- Garante que ATMUSDT existe com o padrão (idempotente se já configurado)
UPDATE five_min_bot_state
SET entry_paths = '{
  "rsi": { "enabled": true },
  "combine": "any",
  "ma50_5m": { "enabled": true, "trigger": "touch" },
  "pathCooldownHours": 2.2,
  "pathCooldownSource": "ma"
}'::jsonb
WHERE symbol = 'ATMUSDT'
  AND (
    entry_paths IS NULL
    OR (entry_paths->'ma50_5m'->>'enabled')::boolean IS NOT TRUE
    OR entry_paths->>'pathCooldownHours' IS NULL
  );

-- Demais moedas: copia entry_paths de ATMUSDT (ou JSON padrão se ATM ainda não existir)
UPDATE five_min_bot_state AS t
SET entry_paths = COALESCE(
  (SELECT entry_paths FROM five_min_bot_state WHERE symbol = 'ATMUSDT' LIMIT 1),
  '{
    "rsi": { "enabled": true },
    "combine": "any",
    "ma50_5m": { "enabled": true, "trigger": "touch" },
    "pathCooldownHours": 2.2,
    "pathCooldownSource": "ma"
  }'::jsonb
)
WHERE t.symbol <> 'ATMUSDT';

-- Novos registros sem entry_paths explícito herdam o mesmo padrão
ALTER TABLE five_min_bot_state
  ALTER COLUMN entry_paths SET DEFAULT '{
    "rsi": { "enabled": true },
    "combine": "any",
    "ma50_5m": { "enabled": true, "trigger": "touch" },
    "pathCooldownHours": 2.2,
    "pathCooldownSource": "ma"
  }'::jsonb;

NOTIFY pgrst, 'reload schema';
