-- Valor padrão (global, vale para toda moeda) do limiar mínimo (%) da inclinação média da
-- linha mediana da Bollinger Band exigido pelo medianTrendFilter (ver checkMedianTrendFilter
-- em backend/bot/bollinger-bands/strategyEngine.js) para liberar a compra. Editável no painel
-- em Configurações → Filtro de tendência da Bollinger.
--
-- Antes desta migration o valor era fixo em código (0.4%); o novo padrão é 0.2%. O bot
-- (backend/bot/bollinger-bands/bollinger-bands-bot.js) relê esta tabela a cada 5 minutos.
--
-- Uma linha por usuário (mesmo padrão single-user do resto do projeto).

-- RLS fica desligado neste projeto (ver migration-simplify.sql) — acesso via
-- SUPABASE_SERVICE_ROLE_KEY no backend, sem auth de usuário no frontend.
CREATE TABLE IF NOT EXISTS bollinger_median_trend_config (
  user_id           TEXT PRIMARY KEY REFERENCES profiles(id),
  min_avg_diff_pct  NUMERIC NOT NULL DEFAULT 0.2,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garante que o usuário padrão já tenha uma linha com o novo padrão (0.2), pra ficar
-- vigente imediatamente sem precisar abrir o painel e salvar uma vez antes (diferente do
-- screener do ma-cross, aqui o filtro já roda hoje, então não faz sentido ficar sem linha).
INSERT INTO bollinger_median_trend_config (user_id, min_avg_diff_pct)
SELECT id, 0.2 FROM profiles
ON CONFLICT (user_id) DO NOTHING;
