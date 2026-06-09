-- Patch: corrige recursão infinita na policy de admin em profiles
-- Cole no SQL Editor do Supabase e execute.

-- 1. Remove a policy recursiva
drop policy if exists "profiles: admin lê todos" on public.profiles;

-- 2. Cria função auxiliar (security definer = executa fora do contexto RLS)
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 3. Recria a policy usando a função
create policy "profiles: admin lê todos"
  on public.profiles for select
  using (public.is_admin());
