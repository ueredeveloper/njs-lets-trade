-- Migration: múltiplas estratégias por moeda (amap-15m + amap-1h)
-- Execute TUDO no SQL Editor do Supabase, nesta ordem, de uma vez.

-- ── PASSO 1: coluna enabled (obrigatório antes de INSERT com enabled) ─────────
ALTER TABLE public.multitrade_favorites
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ── PASSO 2: migrar strategy_id legado ─────────────────────────────────────
UPDATE public.multitrade_favorites
SET strategy_id = 'amap-15m'
WHERE strategy_id IS NULL OR strategy_id = '' OR strategy_id = 'flex';

UPDATE public.rsi_multi_bot_state
SET strategy_id = 'amap-15m'
WHERE strategy_id IS NULL OR strategy_id = '' OR strategy_id = 'flex';

-- ── PASSO 3: UNIQUE (user_id, symbol) → (user_id, symbol, strategy_id) ─────
ALTER TABLE public.multitrade_favorites
  DROP CONSTRAINT IF EXISTS multitrade_favorites_user_id_symbol_key;

ALTER TABLE public.multitrade_favorites
  DROP CONSTRAINT IF EXISTS multitrade_favorites_user_symbol_strategy_key;

ALTER TABLE public.multitrade_favorites
  ADD CONSTRAINT multitrade_favorites_user_symbol_strategy_key
  UNIQUE (user_id, symbol, strategy_id);

-- ── PASSO 4: verificar ───────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'multitrade_favorites'
  AND column_name = 'enabled';

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.multitrade_favorites'::regclass
  AND contype = 'u';
