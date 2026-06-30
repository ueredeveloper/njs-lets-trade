-- Habilita entrada MA50 5m em todas as moedas do 5m Trade, exceto ATMUSDT (já configurada).
-- Preserva rsi_buy, ma_filters, etc. — altera só entry_paths.
-- Rode uma vez no SQL Editor do Supabase.

UPDATE five_min_bot_state
SET entry_paths = COALESCE(entry_paths, '{}'::jsonb)
  || '{
    "rsi": { "enabled": true },
    "combine": "any",
    "ma50_5m": { "enabled": true, "trigger": "touch" },
    "pathCooldownHours": 2.2,
    "pathCooldownSource": "ma"
  }'::jsonb
WHERE symbol <> 'ATMUSDT';

NOTIFY pgrst, 'reload schema';
