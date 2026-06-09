-- ============================================================
--  lets-trade — Schema Supabase / PostgreSQL
--  Cole este arquivo no SQL Editor do Supabase e execute.
-- ============================================================

-- ── Extensões ────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ============================================================
--  1. PROFILES  (estende auth.users do Supabase)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  is_admin    boolean      not null default false,

  -- Preferências de interface
  theme       text         not null default 'dark',   -- 'dark' | 'light'
  language    text         not null default 'pt-BR',  -- 'pt-BR' | 'en-US'

  -- Preferências do screener (espelho de user-prefs.json)
  intervals       text[]   not null default '{"30m","4h","8h","1m"}',
  chart_interval  text     not null default '1m',

  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

-- Trigger: cria profile automaticamente quando um usuário se registra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trigger: atualiza updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ============================================================
--  2. FAVORITES BINANCE
-- ============================================================
create table if not exists public.favorites_binance (
  id         bigserial    primary key,
  user_id    uuid         not null references public.profiles(id) on delete cascade,
  symbol     text         not null,
  position   integer      not null default 0,  -- ordem exibida na tela
  created_at timestamptz  not null default now(),
  unique (user_id, symbol)
);

-- ============================================================
--  3. FAVORITES GATE
-- ============================================================
create table if not exists public.favorites_gate (
  id         bigserial    primary key,
  user_id    uuid         not null references public.profiles(id) on delete cascade,
  symbol     text         not null,
  position   integer      not null default 0,
  created_at timestamptz  not null default now(),
  unique (user_id, symbol)
);

-- ============================================================
--  4. FAVORITES TRADE  (configuração do bot por símbolo)
-- ============================================================
create table if not exists public.favorites_trade (
  id              bigserial    primary key,
  user_id         uuid         not null references public.profiles(id) on delete cascade,
  symbol          text         not null,
  exchange        text         not null default 'gate',  -- 'gate' | 'binance'
  interval        text         not null default '30m',
  rsi_buy         numeric(5,2) not null default 30,
  rsi_sell        numeric(5,2) not null default 70,
  variation_min   numeric(5,2),                          -- null = padrão automático por intervalo
  position        integer      not null default 0,
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now(),
  unique (user_id, symbol)
);

create trigger favorites_trade_updated_at
  before update on public.favorites_trade
  for each row execute procedure public.set_updated_at();

-- ============================================================
--  5. RECENT INDICATORS  (histórico de buscas do screener)
-- ============================================================
create table if not exists public.recent_indicators (
  id          bigserial    primary key,
  user_id     uuid         not null references public.profiles(id) on delete cascade,
  key         text         not null,   -- JSON stringificado da config (usado como chave de dedup)
  config      jsonb        not null,   -- objeto completo da configuração
  use_count   integer      not null default 1,
  last_used   timestamptz  not null default now(),
  unique (user_id, key)
);

-- ============================================================
--  6. ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.profiles          enable row level security;
alter table public.favorites_binance enable row level security;
alter table public.favorites_gate    enable row level security;
alter table public.favorites_trade   enable row level security;
alter table public.recent_indicators enable row level security;

-- Função auxiliar para checar admin sem recursão (security definer sai do contexto RLS)
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- profiles: usuário vê e edita apenas o próprio perfil; admin vê todos
create policy "profiles: próprio usuário"
  on public.profiles for all
  using (auth.uid() = id);

create policy "profiles: admin lê todos"
  on public.profiles for select
  using (public.is_admin());

-- favorites_binance
create policy "favorites_binance: próprio usuário"
  on public.favorites_binance for all
  using (auth.uid() = user_id);

-- favorites_gate
create policy "favorites_gate: próprio usuário"
  on public.favorites_gate for all
  using (auth.uid() = user_id);

-- favorites_trade
create policy "favorites_trade: próprio usuário"
  on public.favorites_trade for all
  using (auth.uid() = user_id);

-- recent_indicators
create policy "recent_indicators: próprio usuário"
  on public.recent_indicators for all
  using (auth.uid() = user_id);

-- ============================================================
--  7. ÍNDICES  (performance em queries comuns)
-- ============================================================
create index if not exists idx_favorites_binance_user on public.favorites_binance(user_id);
create index if not exists idx_favorites_gate_user    on public.favorites_gate(user_id);
create index if not exists idx_favorites_trade_user   on public.favorites_trade(user_id);
create index if not exists idx_recent_indicators_user on public.recent_indicators(user_id, last_used desc);

-- ============================================================
--  8. FUNÇÕES RPC
-- ============================================================

-- Incrementa o contador de uso de um indicador recente
create or replace function public.increment_indicator_count(p_user_id uuid, p_key text)
returns void language sql security definer as $$
  update public.recent_indicators
  set use_count = use_count + 1,
      last_used = now()
  where user_id = p_user_id
    and key     = p_key;
$$;
