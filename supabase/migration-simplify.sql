-- Migration: simplifica o schema para uso single-user sem Supabase Auth
-- Cole no SQL Editor do Supabase e execute.

-- ── 1. Remove todas as policies (necessário antes de alterar tipos) ───────────
DROP POLICY IF EXISTS "profiles: próprio usuário"      ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin lê todos"       ON public.profiles;
DROP POLICY IF EXISTS "favorites_binance: próprio usuário" ON public.favorites_binance;
DROP POLICY IF EXISTS "favorites_gate: próprio usuário"    ON public.favorites_gate;
DROP POLICY IF EXISTS "favorites_trade: próprio usuário"   ON public.favorites_trade;
DROP POLICY IF EXISTS "recent_indicators: próprio usuário" ON public.recent_indicators;

-- ── 2. Desativa RLS em todas as tabelas ──────────────────────────────────────
ALTER TABLE public.profiles          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites_binance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites_gate    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites_trade   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recent_indicators DISABLE ROW LEVEL SECURITY;

-- ── 3. Remove FK constraints (filhas → profiles, profiles → auth.users) ──────
ALTER TABLE public.favorites_binance DROP CONSTRAINT IF EXISTS favorites_binance_user_id_fkey;
ALTER TABLE public.favorites_gate    DROP CONSTRAINT IF EXISTS favorites_gate_user_id_fkey;
ALTER TABLE public.favorites_trade   DROP CONSTRAINT IF EXISTS favorites_trade_user_id_fkey;
ALTER TABLE public.recent_indicators DROP CONSTRAINT IF EXISTS recent_indicators_user_id_fkey;
ALTER TABLE public.profiles          DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- ── 4. Converte colunas de UUID para TEXT ────────────────────────────────────
ALTER TABLE public.profiles          ALTER COLUMN id      TYPE text USING id::text;
ALTER TABLE public.favorites_binance ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE public.favorites_gate    ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE public.favorites_trade   ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE public.recent_indicators ALTER COLUMN user_id TYPE text USING user_id::text;

-- ── 5. Cria o perfil padrão ──────────────────────────────────────────────────
INSERT INTO public.profiles (id, email, theme, language, intervals, chart_interval)
VALUES ('ueredeveloper', 'ueredeveloper@gmail.com', 'dark', 'pt-BR', '{"30m","4h","8h","1m"}', '1m')
ON CONFLICT (id) DO NOTHING;
