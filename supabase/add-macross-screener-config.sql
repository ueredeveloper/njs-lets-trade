-- Configuração do screener automático de exaustão BB+VWAP (4h) do ma-cross.
-- Roda dentro de backend/bot/ma-cross/ma-cross-bot.js a cada 4h (ver exhaustionScreener.js):
-- varre BB "perto do fundo" + VWAP "exaustão fundo" em 4h, filtra por volume 24h mínimo e
-- lista negra, e adiciona automaticamente as moedas que sobram em multitrade_favorites
-- (strategy_id='ma-cross', entrada EMA9x21 1h) — já armadas, o bot compra assim que
-- o cruzamento acontecer.
--
-- Uma linha por usuário (mesmo padrão single-user do resto do projeto).

-- RLS fica desligado neste projeto (ver migration-simplify.sql) — acesso via
-- SUPABASE_SERVICE_ROLE_KEY no backend, sem auth de usuário no frontend.
CREATE TABLE IF NOT EXISTS ma_cross_screener_config (
  user_id             TEXT PRIMARY KEY REFERENCES profiles(id),
  enabled             BOOLEAN NOT NULL DEFAULT true,
  min_volume_24h      NUMERIC NOT NULL DEFAULT 5000000,
  blacklist           TEXT[] NOT NULL DEFAULT '{}',
  max_new_per_cycle   INTEGER NOT NULL DEFAULT 5,
  capital_per_symbol  NUMERIC NOT NULL DEFAULT 40,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
