-- ============================================================
--  Ignição de volume — histórico de eventos + heartbeat do bot
--  Cole no SQL Editor do Supabase e execute.
--
--  O bot (backend/bot/volume-ignition/volume-ignition-bot.js) roda no Termux,
--  separado do painel (PC) — não dá pra compartilhar estado em memória entre os
--  dois processos, então o bot grava aqui e o painel lê daqui
--  (GET /services/volume-ignition).
-- ============================================================

-- 1. Histórico de disparos (1 linha por símbolo que ficou "novo" na ignição —
--    ver isNew em volumeIgnitionMonitor.js, não grava a cada tick).
create table if not exists public.volume_ignition_events (
  id                bigserial    primary key,
  symbol            text         not null,
  exchange          text         not null default 'binance',
  ratio             numeric      not null,
  price_change_pct  numeric      not null,
  price             numeric      not null,
  fired_at          timestamptz  not null,
  created_at        timestamptz  not null default now()
);

create index if not exists volume_ignition_events_fired_at_idx
  on public.volume_ignition_events (fired_at desc);

-- 2. Heartbeat — 1 linha só (id fixo = 1), o bot atualiza a cada ~30s pra o
--    painel saber que o processo no Termux está de fato vivo.
create table if not exists public.volume_ignition_status (
  id               smallint     primary key default 1,
  monitored_pairs  integer      not null default 0,
  started_at       timestamptz,
  last_tick_at     timestamptz,
  updated_at       timestamptz  not null default now(),
  constraint volume_ignition_status_singleton check (id = 1)
);

insert into public.volume_ignition_status (id) values (1)
  on conflict (id) do nothing;

-- Sem RLS: acesso só via SUPABASE_SERVICE_ROLE_KEY (bot no Termux + painel no
-- Express), nunca exposto direto pro browser — mesmo padrão de rsi_multi_bot_state.
