-- ── hourly_bot_state ─────────────────────────────────────────────────────────
-- Estado e capital por símbolo para o bot RSI 1h dedicado
-- Atualizado por id a cada trade
CREATE TABLE IF NOT EXISTS hourly_bot_state (
  id              BIGSERIAL       PRIMARY KEY,
  symbol          TEXT            NOT NULL UNIQUE,
  exchange        TEXT            NOT NULL DEFAULT 'binance',
  initial_capital NUMERIC(12,4)   NOT NULL DEFAULT 40,
  capital         NUMERIC(12,4)   NOT NULL DEFAULT 40,
  phase           TEXT            NOT NULL DEFAULT 'WATCHING',
  buy_price       NUMERIC(20,8),
  buy_qty         NUMERIC(20,8),
  buy_usdt        NUMERIC(12,4),
  buy_time        TIMESTAMPTZ,
  rsi_entry       NUMERIC(8,2),
  ema200_entry    NUMERIC(20,8),
  updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

-- ── Moedas iniciais ───────────────────────────────────────────────────────────
INSERT INTO hourly_bot_state (symbol, exchange, initial_capital, capital)
VALUES
  ('LINKUSDT',  'binance', 40, 40),
  ('TONUSDT',   'binance', 40, 40),
  ('NIGHTUSDT', 'binance', 40, 40),
  ('STGUSDT',   'binance', 40, 40)
ON CONFLICT (symbol) DO NOTHING;

-- ── hourly_bot_trades ─────────────────────────────────────────────────────────
-- Histórico de trades (inserção apenas, nunca atualizado)
CREATE TABLE IF NOT EXISTS hourly_bot_trades (
  id             BIGSERIAL     PRIMARY KEY,
  symbol         TEXT          NOT NULL,
  exchange       TEXT,
  entry_time     TIMESTAMPTZ,
  exit_time      TIMESTAMPTZ,
  entry_price    NUMERIC(20,8),
  exit_price     NUMERIC(20,8),
  qty            NUMERIC(20,8),
  usdt_in        NUMERIC(12,4),
  usdt_out       NUMERIC(12,4),
  pnl_usdt       NUMERIC(12,4),
  pnl_pct        NUMERIC(8,4),
  capital_before NUMERIC(12,4),
  capital_after  NUMERIC(12,4),
  rsi_entry      NUMERIC(8,2),
  rsi_exit       NUMERIC(8,2),
  ema200         NUMERIC(20,8),
  trend_bullish  BOOLEAN,
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);
