-- Config GLOBAL (não por moeda) do bot RSI Momentum, editável em Configurações → RSI Momentum
-- no painel. O scanner de mercado (backend/bot/rsi-momentum/marketScanner.js) e a criação de
-- favorito automático (rsi-momentum-bot.js#createAutoFavorite) releem esta tabela a cada ciclo
-- — mudanças salvas no painel valem sem precisar reiniciar o bot (ver
-- backend/bot/rsi-momentum/strategyPresets.js#loadGlobalConfigBody).
--
-- trade_config guarda o mesmo shape "normalizado" de backend/bot/rsi-momentum/tradeConfigSchema.js
-- (normalizeRsiMomentumConfig) — um JSONB só, em vez de explodir cada campo em coluna, porque o
-- schema já é validado/normalizado no backend antes de gravar (ver PUT /services/sb/rsi-momentum-config).
--
-- Uma linha por usuário (mesmo padrão single-user do resto do projeto). Sem linha salva ainda
-- (usuário nunca abriu o formulário) o bot cai no preset estático de strategyPresets.js.

-- RLS fica desligado neste projeto (ver migration-simplify.sql) — acesso via
-- SUPABASE_SERVICE_ROLE_KEY no backend, sem auth de usuário no frontend.
CREATE TABLE IF NOT EXISTS rsi_momentum_global_config (
  user_id       TEXT PRIMARY KEY REFERENCES profiles(id),
  trade_config  JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
