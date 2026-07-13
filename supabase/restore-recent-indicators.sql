-- Recria a tabela recent_indicators (deletada por engano), já no schema
-- simplificado single-user (ver migration-simplify.sql): user_id é text,
-- sem RLS, sem policy. Idempotente: seguro rodar novamente.

create table if not exists public.recent_indicators (
  id          bigserial    primary key,
  user_id     text         not null,
  key         text         not null,   -- JSON stringificado da config (usado como chave de dedup)
  config      jsonb        not null,   -- objeto completo da configuração
  use_count   integer      not null default 1,
  last_used   timestamptz  not null default now(),
  unique (user_id, key)
);

create index if not exists idx_recent_indicators_user on public.recent_indicators(user_id, last_used desc);

-- Incrementa o contador de uso de um indicador recente
create or replace function public.increment_indicator_count(p_user_id text, p_key text)
returns void language sql security definer as $$
  update public.recent_indicators
  set use_count = use_count + 1,
      last_used = now()
  where user_id = p_user_id
    and key     = p_key;
$$;
