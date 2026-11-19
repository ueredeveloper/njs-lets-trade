-- Config do bot "Price action" (Explosão de Alta automática — backend/bot/breakout-auto/), editável
-- em Configurações → Price action no painel. O bot relê a cada varredura (15 min): mudança salva vale
-- sem reiniciar. Sem linha salva → padrão de backend/bot/breakout-auto/priceActionConfig.js#DEFAULTS
-- (alvo +15% / stop −30%, BTC 4h > EMA50, moeda > EMA20 1d, MACD 4h > 0, EMA20 1d do BTC subindo,
-- moeda entre as 40 maiores altas 24h).
--
-- `config` guarda o shape normalizado (normalizePriceActionConfig) num JSONB só.
-- RLS desligado neste projeto (ver migration-simplify.sql) — acesso via service role no backend.
CREATE TABLE IF NOT EXISTS price_action_bot_config (
  user_id     TEXT PRIMARY KEY REFERENCES profiles(id),
  config      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
