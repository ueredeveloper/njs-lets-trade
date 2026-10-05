-- Rodar no SQL Editor do Supabase (1×).
--
-- "Sinal sem entrada" do RSI Momentum: sinal CONFIRMADO (todos os filtros passaram) que não
-- virou compra. Diferente de rsi_momentum_near_misses (RSI cruzou mas um filtro barrou).
--   PULLBACK_EXPIRED  limite GTC (preço do sinal − pullback.belowPct%) expirou sem fill
--   LIMIT_CLOSED      a limite sumiu da corretora sem fill (cancelada por fora / rejeitada)
--   SIGNAL_LOST       scanner sinalizou, mas a sessão não confirmou o sinal no 1º tick
--   ENTRY_FAILED      corretora recusou a compra (saldo etc.) — moeda fica FAILED
--
-- Motivação: ao expirar o pullback o bot apaga a linha de rsi_multi_bot_state (e o
-- entry_signal_time junto) — o único rastro ficava nas ordens canceladas da Binance.
--
-- Gravado por backend/bot/rsi-momentum/missedSignalLogger.js. Lido por
-- GET /services/rsi-momentum-missed-signals (backend/services/fetchRsiMomentumMissedSignals.js),
-- que alimenta o favorito "SSE" (Sinais sem entrada) da tabela de moedas — clicar abre o
-- gráfico com a seta amarela no candle do sinal (signal_time = openTime do candle de `interval`).

CREATE TABLE IF NOT EXISTS public.rsi_momentum_missed_signals (
  id               BIGSERIAL      PRIMARY KEY,
  symbol           TEXT           NOT NULL,
  exchange         TEXT           NOT NULL DEFAULT 'binance',
  interval         TEXT,
  reason           TEXT           NOT NULL,
  signal_time      TIMESTAMPTZ    NOT NULL,
  signal_price     NUMERIC,
  limit_price      NUMERIC,
  order_placed_at  TIMESTAMPTZ,
  min_low          NUMERIC,
  miss_pct         NUMERIC(10,3),
  rsi              NUMERIC(8,2),
  threshold        NUMERIC(8,2),
  detail           JSONB          NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Evita duplicar o mesmo sinal (backfill rodado 2×, retry de rede).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rsi_momentum_missed_signals_symbol_signal
  ON public.rsi_momentum_missed_signals (symbol, signal_time, reason);

CREATE INDEX IF NOT EXISTS idx_rsi_momentum_missed_signals_signal_time
  ON public.rsi_momentum_missed_signals (signal_time DESC);
